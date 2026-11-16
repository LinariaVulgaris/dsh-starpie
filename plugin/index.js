/**
 * Host half of the radial right-click menu: two loopback-only HTTP routes.
 * `POST /dsh-radial-menu/open-dir` opens a session workspace in the system
 * file manager after validating the path; `GET/PUT /dsh-radial-menu/config`
 * reads and persists the user's ring configuration beside the profile.
 */
import { spawn } from 'node:child_process'
import { stat as fsStat, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const name = 'dsh-radial-menu'
export const inject = ['webServer']

const OPEN_DIR_ROUTE = '/dsh-radial-menu/open-dir'
const CONFIG_ROUTE = '/dsh-radial-menu/config'
const MAX_BODY_BYTES = 64 * 1024
const MAX_CONFIG_BYTES = 32 * 1024
/** Only plain #rrggbb accents are accepted; anything else falls back. */
const ACCENT_RE = /^#[0-9a-fA-F]{6}$/
const DEFAULT_ACCENT = '#67dce7'
/** Disc style used when no valid saved choice exists; leads the picker. */
const DEFAULT_STYLE = 'liquid'
const ALL_ITEMS = [
  'plugin-market', 'new-session',
  'open-dir', 'copy-cwd',
]
const DEFAULT_CONFIG = {
  version: 1,
  enabled: true,
  scope: 'conversation',
  size: 200,
  duration: 380,
  style: DEFAULT_STYLE,
  motion: 'full',
  accent: DEFAULT_ACCENT,
  items: ALL_ITEMS.slice(),
}
/** Disc visual styles the client can render. */
const DISC_STYLES = [DEFAULT_STYLE, 'glass', 'solid', 'neon', 'mist']
/** Motion tiers: full bounce, gentle grow, or follow the system preference. */
const MOTION_MODES = ['full', 'soft', 'auto']

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

async function readBoundedBody(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    size += buf.byteLength
    if (size > limit) {
      req.resume()
      return null
    }
    chunks.push(buf)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}

function isAbsolutePath(filePath, platform) {
  return platform === 'win32' ? path.win32.isAbsolute(filePath) : path.posix.isAbsolute(filePath)
}

function fileManagerCommand(platform, absDir) {
  switch (platform) {
    case 'win32': return { command: 'explorer.exe', args: [absDir] }
    case 'darwin': return { command: 'open', args: [absDir] }
    case 'linux': return { command: 'xdg-open', args: [absDir] }
    default: throw new Error(`unsupported platform: ${platform}`)
  }
}

async function checkOpenableDirectory(filePath, platform, statFn = fsStat) {
  if (typeof filePath !== 'string' || filePath === '') return { ok: false, reason: 'empty' }
  if (!isAbsolutePath(filePath, platform)) return { ok: false, reason: 'not-absolute' }
  try {
    const info = await statFn(filePath)
    if (!info.isDirectory()) return { ok: false, reason: 'not-directory' }
  } catch {
    return { ok: false, reason: 'missing' }
  }
  return { ok: true, path: filePath }
}

function launchedThroughSsh(env = process.env) {
  return Boolean((env.SSH_CONNECTION && env.SSH_CONNECTION !== '') || (env.SSH_TTY && env.SSH_TTY !== ''))
}

/** Validate one incoming ring configuration, filling defaults for absent fields. */
function sanitizeConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const scope = source.scope === 'everywhere' ? 'everywhere' : 'conversation'
  const size = Number(source.size)
  const duration = Number(source.duration)
  const accent = typeof source.accent === 'string' && ACCENT_RE.test(source.accent)
    ? source.accent.toLowerCase()
    : DEFAULT_ACCENT
  const allowed = (id) => typeof id === 'string'
    && (ALL_ITEMS.includes(id) || (id.startsWith('section:') && id.length > 8 && id.length <= 72))
  const items = Array.isArray(source.items) ? source.items.filter(allowed) : DEFAULT_CONFIG.items.slice()
  const unique = [...new Set(items)]
  /* v1 shipped glass as its default, so a v1 file cannot tell an explicit
     glass choice from the untouched default: ride those onto the new liquid
     default once. Saves written by v2 clients carry version 2 and skip this. */
  const legacy = (Number(source.version) || 1) < 2
  let style = DISC_STYLES.includes(source.style) ? source.style : DEFAULT_CONFIG.style
  if (legacy && style === 'glass') style = DEFAULT_STYLE
  return {
    version: 2,
    enabled: source.enabled !== false,
    scope,
    size: Number.isFinite(size) ? Math.min(320, Math.max(140, Math.round(size))) : DEFAULT_CONFIG.size,
    duration: Number.isFinite(duration) ? Math.min(900, Math.max(120, Math.round(duration))) : DEFAULT_CONFIG.duration,
    style,
    motion: MOTION_MODES.includes(source.motion) ? source.motion : DEFAULT_CONFIG.motion,
    accent,
    items: unique.length > 0 ? unique : DEFAULT_CONFIG.items.slice(),
  }
}

function configFileFor(profileDir) {
  if (typeof profileDir !== 'string' || profileDir === '') return undefined
  return path.join(profileDir, 'dsh-radial-menu.json')
}

/** The launched profile directory: the boot service first, the shell env as fallback. */
function profileDirOf(ctx) {
  return ctx.get?.('profileContext')?.dir ?? process.env.DSH_PROFILE_DIR
}

async function readConfig(file) {
  if (file === undefined) return { ...DEFAULT_CONFIG, items: DEFAULT_CONFIG.items.slice() }
  try {
    const text = await readFile(file, 'utf8')
    return sanitizeConfig(JSON.parse(text))
  } catch {
    return { ...DEFAULT_CONFIG, items: DEFAULT_CONFIG.items.slice() }
  }
}

async function writeConfig(file, config) {
  if (file === undefined) return false
  const dir = path.dirname(file)
  await mkdir(dir, { recursive: true })
  const temp = `${file}.tmp-${process.pid}`
  await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  await rename(temp, file)
  return true
}

/**
 * Register both routes; the connection fence rejects unauthenticated peers and
 * disposal removes the routes with the plugin.
 * @param ctx - Host plugin context carrying the web server service.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: OPEN_DIR_ROUTE,
    handler: async (req, res) => {
      const connection = ctx.get?.('connection')
      const rejection = connection?.requestRejection?.(req)
      if (rejection !== undefined) {
        res.statusCode = rejection
        res.end()
        return
      }
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('allow', 'POST')
        res.end()
        return
      }
      const essence = String(req.headers['content-type']).split(';', 1)[0]?.trim().toLowerCase()
      if (essence !== 'application/json') {
        sendJson(res, 415, { code: 'unsupported-media-type' })
        return
      }
      if (launchedThroughSsh()) {
        sendJson(res, 403, { code: 'ssh' })
        return
      }
      let text
      try {
        text = await readBoundedBody(req, MAX_BODY_BYTES)
      } catch {
        sendJson(res, 400, { code: 'bad-request' })
        return
      }
      if (text === null) {
        sendJson(res, 413, { code: 'payload-too-large' })
        return
      }
      let body
      try {
        body = JSON.parse(text)
      } catch {
        sendJson(res, 400, { code: 'bad-request' })
        return
      }
      const check = await checkOpenableDirectory(body?.path, process.platform)
      if (!check.ok) {
        sendJson(res, 400, { code: check.reason })
        return
      }
      const { command, args } = fileManagerCommand(process.platform, check.path)
      const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: false })
      child.unref()
      sendJson(res, 200, { ok: true })
    },
  }), 'dsh-radial-menu: POST open-dir')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: CONFIG_ROUTE,
    handler: async (req, res) => {
      const connection = ctx.get?.('connection')
      const rejection = connection?.requestRejection?.(req)
      if (rejection !== undefined) {
        res.statusCode = rejection
        res.end()
        return
      }
      const file = configFileFor(profileDirOf(ctx))
      if (req.method === 'GET' || req.method === 'HEAD') {
        sendJson(res, 200, await readConfig(file))
        return
      }
      if (req.method !== 'PUT') {
        res.statusCode = 405
        res.setHeader('allow', 'GET, HEAD, PUT')
        res.end()
        return
      }
      const essence = String(req.headers['content-type']).split(';', 1)[0]?.trim().toLowerCase()
      if (essence !== 'application/json') {
        sendJson(res, 415, { code: 'unsupported-media-type' })
        return
      }
      let text
      try {
        text = await readBoundedBody(req, MAX_CONFIG_BYTES)
      } catch {
        sendJson(res, 400, { code: 'bad-request' })
        return
      }
      if (text === null) {
        sendJson(res, 413, { code: 'payload-too-large' })
        return
      }
      let raw
      try {
        raw = JSON.parse(text)
      } catch {
        sendJson(res, 400, { code: 'bad-request' })
        return
      }
      const config = sanitizeConfig(raw)
      const written = await writeConfig(file, config)
      if (!written) {
        sendJson(res, 503, { code: 'profile-unavailable' })
        return
      }
      sendJson(res, 200, config)
    },
  }), 'dsh-radial-menu: GET/PUT config')
}
