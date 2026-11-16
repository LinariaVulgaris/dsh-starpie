/**
 * Host half of the radial right-click menu: three loopback-only HTTP routes.
 * `POST /dsh-radial-menu/open-dir` opens a session workspace in the system
 * file manager after validating the path; `GET/PUT /dsh-radial-menu/config`
 * reads and persists the user's ring configuration beside the profile;
 * `POST /dsh-radial-menu/restart` relaunches the harness through a detached
 * watchdog once this process has exited.
 */
import { spawn } from 'node:child_process'
import { stat as fsStat, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const name = 'dsh-radial-menu'
export const inject = ['webServer']

const OPEN_DIR_ROUTE = '/dsh-radial-menu/open-dir'
const CONFIG_ROUTE = '/dsh-radial-menu/config'
const RESTART_ROUTE = '/dsh-radial-menu/restart'
const MAX_BODY_BYTES = 64 * 1024
const MAX_CONFIG_BYTES = 32 * 1024
/** Only plain #rrggbb accents are accepted; anything else falls back. */
const ACCENT_RE = /^#[0-9a-fA-F]{6}$/
const DEFAULT_ACCENT = '#67dce7'
const ALL_ITEMS = [
  'plugin-market', 'new-session',
  'open-dir', 'copy-cwd',
  'restart-dsh',
]
const DEFAULT_CONFIG = {
  version: 2,
  enabled: true,
  scope: 'conversation',
  size: 200,
  duration: 380,
  blur: 1,
  saturation: 1,
  brightness: 1,
  tint: 1,
  specular: 1,
  divider: 1,
  fog: 1,
  motion: 'full',
  accent: DEFAULT_ACCENT,
  items: ALL_ITEMS.slice(),
}
/** Liquid-glass tuning knobs (unitless scales, 1 = default), shared with the
    client so saved values are clamped to the same slider ranges. */
const LIQUID_PARAMS = [
  { key: 'blur', min: 0, max: 3 },
  { key: 'saturation', min: 0, max: 3 },
  { key: 'brightness', min: 0.5, max: 2 },
  { key: 'tint', min: 0, max: 2.5 },
  { key: 'specular', min: 0, max: 2.5 },
  { key: 'divider', min: 0, max: 2.5 },
  { key: 'fog', min: 0, max: 3 },
]
function liquidValue(raw, param) {
  const n = Number(raw)
  return Number.isFinite(n) ? Math.min(param.max, Math.max(param.min, n)) : 1
}
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

/** Watchdog source, two modes:
 *  - `web`: wait for this process to exit, then relaunch the original node
 *    command line inheriting the spawning terminal's stdio, so a `dsh web`
 *    style launch prints its new listening address like any foreground run;
 *  - `desktop`: the Host runs as an Electron-as-Node child of the GUI shell,
 *    which holds the single-instance lock and shows a crash dialog (never a
 *    relaunch) when the Host exits, and exposes no restart IPC channel. So
 *    after the Host is gone the watchdog terminates the shell pid, waits for
 *    the lock to free, and launches the executable as a plain GUI run — the
 *    Electron node-mode marker is stripped from the child environment or the
 *    "new instance" would boot headless.
 *  Either mode exits on its own when its waits time out. */
const RESTART_WATCHDOG_SOURCE = `
const mode = process.argv[1] === 'desktop' ? 'desktop' : 'web'
const target = Number(process.argv[2] || 0)
const shell = Number(process.argv[3] || 0)
const command = process.argv[4] || ''
const args = process.argv.slice(5)
if (!target || !command) process.exit(1)
const gone = (pid) => {
  try { process.kill(pid, 0); return false } catch { return true }
}
const poll = (pid, timeoutMs, step) => {
  const deadline = Date.now() + timeoutMs
  const timer = setInterval(() => {
    if (gone(pid) || Date.now() > deadline) {
      clearInterval(timer)
      step()
    }
  }, 120)
}
const launch = () => {
  const { spawn } = require('node:child_process')
  const options = mode === 'desktop'
    ? (() => {
        const env = Object.assign({}, process.env)
        delete env.ELECTRON_RUN_AS_NODE
        delete env.DSH_DESKTOP_NODE_EXECUTABLE
        return { detached: true, stdio: 'ignore', windowsHide: false, env }
      })()
    : { detached: true, stdio: 'inherit', windowsHide: false }
  let child
  try {
    child = spawn(command, args, options)
  } catch {
    try {
      child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
    } catch {
      process.exit(1)
    }
  }
  child.unref()
  setTimeout(() => process.exit(0), 1000).unref()
}
poll(target, 20000, () => {
  if (!gone(target)) process.exit(1)
  if (mode === 'desktop' && shell) {
    try { process.kill(shell, 'SIGKILL') } catch {}
    poll(shell, 10000, launch)
  } else {
    launch()
  }
})
`

/** Spawn the detached watchdog for one restart request; returns false when
 *  the platform offers no usable executable to relaunch with. */
function spawnRestartWatchdog() {
  const command = process.execPath
  if (typeof command !== 'string' || command === '') return false
  const desktop = process.versions.electron !== undefined
  const args = desktop
    ? ['-e', RESTART_WATCHDOG_SOURCE, 'desktop', String(process.pid), String(process.ppid), command]
    : ['-e', RESTART_WATCHDOG_SOURCE, 'web', String(process.pid), '0', command, ...process.argv.slice(1)]
  let child
  try {
    child = spawn(command, args, {
      detached: true,
      stdio: desktop ? 'ignore' : 'inherit',
      windowsHide: false,
    })
  } catch {
    child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
  }
  child.unref()
  return true
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
  const liquid = {}
  for (const param of LIQUID_PARAMS) liquid[param.key] = liquidValue(source[param.key], param)
  return {
    version: 2,
    enabled: source.enabled !== false,
    scope,
    size: Number.isFinite(size) ? Math.min(320, Math.max(140, Math.round(size))) : DEFAULT_CONFIG.size,
    duration: Number.isFinite(duration) ? Math.min(900, Math.max(120, Math.round(duration))) : DEFAULT_CONFIG.duration,
    ...liquid,
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

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: RESTART_ROUTE,
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
      try {
        JSON.parse(text)
      } catch {
        sendJson(res, 400, { code: 'bad-request' })
        return
      }
      if (!spawnRestartWatchdog()) {
        sendJson(res, 503, { code: 'restart-unavailable' })
        return
      }
      sendJson(res, 200, { ok: true })
      /* Let the response flush, then leave; the watchdog relaunches us once
         this pid is gone. */
      setTimeout(() => process.exit(0), 400)
    },
  }), 'dsh-radial-menu: POST restart')
}
