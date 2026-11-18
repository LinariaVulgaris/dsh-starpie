/**
 * Host half of the radial right-click menu: four loopback-only HTTP routes.
 * `POST /dsh-starpie/open-dir` opens a session workspace in the system
 * file manager after validating the path; `GET/PUT /dsh-starpie/config`
 * reads and persists the user's ring configuration beside the profile;
 * `POST /dsh-starpie/restart` relaunches the harness through a detached
 * watchdog once this process has exited; `POST /dsh-starpie/open-url`
 * opens this project's repository page in the machine's default browser.
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { open as fsOpen, stat as fsStat, mkdir, readFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'

export const name = 'dsh-starpie'
export const inject = ['webServer']

const OPEN_DIR_ROUTE = '/dsh-starpie/open-dir'
const CONFIG_ROUTE = '/dsh-starpie/config'
const RESTART_ROUTE = '/dsh-starpie/restart'
const OPEN_URL_ROUTE = '/dsh-starpie/open-url'
/** This project's page, the only address the open-url route will launch. */
const REPOSITORY_URL = 'https://github.com/LinariaVulgaris/dsh-starpie'
/** Ring configuration, stored beside the profile. */
const CONFIG_FILE = 'dsh-starpie.json'
/** What the pre-1.0.0 package wrote to. Read only when CONFIG_FILE is absent,
 *  never written and never removed, so upgrading keeps the user's ring instead
 *  of resetting it and the first Save creates the new file beside the old. */
const LEGACY_CONFIG_FILE = 'dsh-radial-menu.json'
const MAX_BODY_BYTES = 64 * 1024
const MAX_CONFIG_BYTES = 32 * 1024
/** Windows paths this plugin will open: a drive letter and a separator. UNC
 *  counts as absolute to path.win32 but points at somebody else's machine. */
const DRIVE_ROOTED_RE = /^[a-zA-Z]:[\\/]/
/** A settings-section sector id. Bounded length alone let any charset through
 *  and persisted it, so restrict to the characters a section id can have. */
const SECTION_ID_RE = /^section:[A-Za-z0-9][A-Za-z0-9._:@/-]{0,63}$/
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
/** Coerce a saved number. `Number()` alone is not enough: `Number(null)`,
 *  `Number([])` and `Number('')` are all 0, which is finite and would clamp
 *  to the bottom of the range rather than falling back to the default. Only
 *  a real number, or a non-blank numeric string, counts as supplied. */
function numericValue(raw) {
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string' && raw.trim() !== '') return Number(raw)
  return NaN
}

function liquidValue(raw, param) {
  const n = numericValue(raw)
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
      /* Returning out of `for await` already destroys the request stream,
         so there is nothing left to drain here. */
      return null
    }
    chunks.push(buf)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}

/** Environment for a process we hand to the operating system. Mirrors what
 *  DSH's own external launcher does: the child needs enough of the
 *  environment to work and none of the harness's credentials. Only used for
 *  the file-manager and browser launches — the restart watchdog is DSH
 *  relaunching itself and must inherit everything, API keys included. */
const ENV_BLOCKLIST = /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH/i
function scrubbedEnv() {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (ENV_BLOCKLIST.test(key)) continue
    if (key.startsWith('DSH_')) continue
    env[key] = value
  }
  return env
}

/** Spawn a detached child and resolve only once it has actually started.
 *  `spawn()` throws synchronously for very little; ENOENT, EACCES, EMFILE and
 *  an unusable stdio combination all arrive later as an `'error'` event, and
 *  an EventEmitter `'error'` with no listener becomes an uncaughtException —
 *  which DSH's fail-loud handler turns into a whole-host `exit(1)`. So the
 *  outcome is awaited on `'spawn'` versus `'error'`, and a swallowing listener
 *  stays attached for the child's remaining life. */
function spawnDetached(command, args, options) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(command, args, options)
    } catch (error) {
      reject(error)
      return
    }
    const onError = (error) => {
      child.removeListener('spawn', onSpawn)
      reject(error)
    }
    const onSpawn = () => {
      child.removeListener('error', onError)
      child.on('error', () => {})
      resolve(child)
    }
    child.once('error', onError)
    child.once('spawn', onSpawn)
    child.unref()
  })
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

/** Default-browser launch for an already allow-listed URL. `windowsHide` is
 *  part of the result because only the Windows branch goes through a console
 *  host that would otherwise flash on screen. */
function browserCommand(platform, url) {
  switch (platform) {
    /* `start` is a cmd.exe builtin; the empty argument is its window title,
       without which the first quoted argument would be swallowed as a title
       instead of being treated as the thing to launch. */
    case 'win32': return { command: 'cmd.exe', args: ['/c', 'start', '', url], windowsHide: true }
    case 'darwin': return { command: 'open', args: [url], windowsHide: false }
    case 'linux': return { command: 'xdg-open', args: [url], windowsHide: false }
    default: throw new Error(`unsupported platform: ${platform}`)
  }
}

async function checkOpenableDirectory(filePath, platform, statFn = fsStat) {
  if (typeof filePath !== 'string' || filePath === '') return { ok: false, reason: 'empty' }
  if (!isAbsolutePath(filePath, platform)) return { ok: false, reason: 'not-absolute' }
  /* path.win32.isAbsolute() also accepts UNC (\\host\share). Statting one
     sends the current user's NTLMv2 challenge/response to whoever owns that
     host and stalls this handler for the length of the SMB timeout, and the
     file manager would then browse it. A session workspace is always
     drive-rooted, so require that shape explicitly. */
  if (platform === 'win32' && !DRIVE_ROOTED_RE.test(filePath)) return { ok: false, reason: 'not-absolute' }
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
  if (mode === 'desktop' && shell > 1) {
    /* pid 1 is never the GUI shell: on POSIX a reparented host reports ppid 1,
       and signalling that is EPERM for a normal user and fatal to everything
       else in the namespace for a root/container host. If the shell was
       reparented it is already gone, so launch straight away. */
    try { process.kill(shell, 'SIGKILL') } catch {}
    /* poll() runs its step on the deadline as well, so re-check before
       relaunching: a new instance started while the old shell still holds
       Electron's single-instance lock just quits again, and the user is left
       with no DSH at all. */
    poll(shell, 10000, () => {
      if (!gone(shell)) process.exit(1)
      launch()
    })
  } else {
    launch()
  }
})
`

/** Spawn the detached watchdog for one restart request. Resolves false when
 *  the platform offers no usable executable, or when the watchdog itself
 *  failed to start — the caller must not exit the host on a false, because
 *  nothing would ever bring it back. */
async function spawnRestartWatchdog() {
  const command = process.execPath
  if (typeof command !== 'string' || command === '') return false
  const desktop = process.versions.electron !== undefined
  const args = desktop
    ? ['-e', RESTART_WATCHDOG_SOURCE, 'desktop', String(process.pid), String(process.ppid), command]
    : ['-e', RESTART_WATCHDOG_SOURCE, 'web', String(process.pid), '0', command, ...process.argv.slice(1)]
  /* Under the desktop shell `process.execPath` is the Electron binary, which
     only honours `-e` while ELECTRON_RUN_AS_NODE is set. Inheriting that
     marker by accident is what made this work; set it explicitly, or the
     spawn starts a second GUI instance that ignores the script entirely. */
  const env = { ...process.env }
  if (desktop) env.ELECTRON_RUN_AS_NODE = '1'
  try {
    await spawnDetached(command, args, {
      detached: true,
      stdio: desktop ? 'ignore' : 'inherit',
      windowsHide: false,
      env,
    })
    return true
  } catch {
    /* stdio:'inherit' needs something to inherit and fails without it. */
  }
  try {
    await spawnDetached(command, args, { detached: true, stdio: 'ignore', windowsHide: true, env })
    return true
  } catch {
    return false
  }
}

/** Validate one incoming ring configuration, filling defaults for absent fields. */
function sanitizeConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const scope = source.scope === 'everywhere' ? 'everywhere' : 'conversation'
  const size = numericValue(source.size)
  const duration = numericValue(source.duration)
  const accent = typeof source.accent === 'string' && ACCENT_RE.test(source.accent)
    ? source.accent.toLowerCase()
    : DEFAULT_ACCENT
  const allowed = (id) => typeof id === 'string'
    && (ALL_ITEMS.includes(id) || SECTION_ID_RE.test(id))
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
  return path.join(profileDir, CONFIG_FILE)
}

function legacyConfigFileFor(profileDir) {
  if (typeof profileDir !== 'string' || profileDir === '') return undefined
  return path.join(profileDir, LEGACY_CONFIG_FILE)
}

/** The launched profile directory: the boot service first, the shell env as fallback. */
function profileDirOf(ctx) {
  return ctx.get?.('profileContext')?.dir ?? process.env.DSH_PROFILE_DIR
}

/** A config file that exists but cannot be used. Carries the response code so
 *  the route can say which of the two failures happened. */
class ConfigError extends Error {
  constructor(code, cause) {
    super(code, { cause })
    this.name = 'ConfigError'
    this.code = code
  }
}

/**
 * Saved ring configuration, falling back to the file the previous package name
 * wrote so an upgrade does not silently reset the user's menu.
 * Only a genuinely ABSENT current file falls through: a corrupt or unreadable
 * one is reported, because falling through on any error quietly served the
 * pre-1.0.0 values behind a 200 and the next Save then wrote those over the
 * file that was still on disk.
 * @param file - Current config path, or undefined without a profile directory.
 * @param legacyFile - Pre-1.0.0 config path, or undefined without a profile.
 */
async function readConfig(file, legacyFile) {
  const defaults = () => ({ ...DEFAULT_CONFIG, items: DEFAULT_CONFIG.items.slice() })
  for (const [candidate, legacy] of [[file, false], [legacyFile, true]]) {
    if (candidate === undefined) continue
    let text
    try {
      text = await readFile(candidate, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw new ConfigError('config-unreadable', error)
    }
    let config
    try {
      config = sanitizeConfig(JSON.parse(text))
    } catch (error) {
      throw new ConfigError('config-invalid', error)
    }
    /* Configs written before 1.0.0 predate the restart action, so they gain
       the sector here — once, on the legacy read only. Doing it on every read
       instead made unchecking "Restart DSH" impossible to save. */
    if (legacy && !config.items.includes('restart-dsh')) config.items.push('restart-dsh')
    return config
  }
  return defaults()
}

let tempCounter = 0
/** Writes run one at a time. On Windows `rename()` over an existing target
 *  fails with EPERM while another rename is in flight, and two browser tabs
 *  saving at once is ordinary usage; the loser used to answer a bare 400 and
 *  leave its temp file behind. A promise chain makes the last save win. */
let writeQueue = Promise.resolve()

function writeConfig(file, config) {
  const run = writeQueue.then(() => writeConfigNow(file, config), () => writeConfigNow(file, config))
  writeQueue = run.then(() => {}, () => {})
  return run
}

async function writeConfigNow(file, config) {
  if (file === undefined) return false
  const dir = path.dirname(file)
  await mkdir(dir, { recursive: true })
  /* Unique per call. A pid-stable name meant two overlapping saves wrote to
     the same temp file and interleaved into invalid JSON, after which the
     second rename threw ENOENT over a file the first had already moved. */
  const temp = `${file}.tmp-${process.pid}-${++tempCounter}-${randomUUID()}`
  let handle
  try {
    handle = await fsOpen(temp, 'w')
    await handle.writeFile(`${JSON.stringify(config, null, 2)}\n`, 'utf8')
    /* fsync before the rename: the rename swaps the directory entry
       atomically, but without this the data behind it can still be short or
       empty after a crash, and readConfig would then serve something else. */
    await handle.sync()
  } finally {
    await handle?.close().catch(() => {})
  }
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(temp, file)
      return true
    } catch (error) {
      /* Something outside this process — a search indexer, an antivirus
         scanner — can still be holding the target. That EPERM is transient. */
      const transient = error?.code === 'EPERM' || error?.code === 'EBUSY' || error?.code === 'EEXIST'
      if (!transient || attempt >= 5) {
        await unlink(temp).catch(() => {})
        throw error
      }
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)))
    }
  }
}

/**
 * Register all four routes; the connection fence rejects unauthenticated peers
 * and disposal removes the routes with the plugin.
 * @param ctx - Host plugin context carrying the web server service.
 */
export function apply(ctx) {
  /* Set as soon as a restart is accepted. Without it, two POSTs inside the
     400 ms flush window each spawned a watchdog, and the loser then hit
     EADDRINUSE (web) or lost Electron's single-instance lock (desktop). */
  let restartInFlight = false

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
      let launch
      try {
        launch = fileManagerCommand(process.platform, check.path)
      } catch {
        sendJson(res, 501, { code: 'unsupported-platform' })
        return
      }
      /* Awaited, and reported: a missing xdg-open on a container host used to
         answer 200 here and then take the whole harness down with it. */
      try {
        await spawnDetached(launch.command, launch.args, {
          detached: true, stdio: 'ignore', windowsHide: false, env: scrubbedEnv(),
        })
      } catch {
        sendJson(res, 502, { code: 'launch-failed' })
        return
      }
      sendJson(res, 200, { ok: true })
    },
  }), 'dsh-starpie: POST open-dir')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: OPEN_URL_ROUTE,
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
      /* A browser opened on an SSH host belongs to that host, not to the user;
         refuse so the caller can fall back to opening the page in the tab the
         user is actually looking at. */
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
      /* Exact-match allow-list, so this stays "open our own repository page"
         rather than becoming a general open-any-URL primitive on the host. */
      if (typeof body?.url !== 'string' || body.url !== REPOSITORY_URL) {
        sendJson(res, 400, { code: 'not-allowed' })
        return
      }
      let launch
      try {
        launch = browserCommand(process.platform, body.url)
      } catch {
        sendJson(res, 501, { code: 'unsupported-platform' })
        return
      }
      try {
        await spawnDetached(launch.command, launch.args, {
          detached: true, stdio: 'ignore', windowsHide: launch.windowsHide, env: scrubbedEnv(),
        })
      } catch {
        sendJson(res, 502, { code: 'launch-failed' })
        return
      }
      sendJson(res, 200, { ok: true })
    },
  }), 'dsh-starpie: POST open-url')

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
      const profileDir = profileDirOf(ctx)
      const file = configFileFor(profileDir)
      if (req.method === 'GET' || req.method === 'HEAD') {
        let config
        try {
          config = await readConfig(file, legacyConfigFileFor(profileDir))
        } catch (error) {
          sendJson(res, 500, { code: error instanceof ConfigError ? error.code : 'config-unreadable' })
          return
        }
        sendJson(res, 200, config)
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
      let written
      try {
        written = await writeConfig(file, config)
      } catch {
        sendJson(res, 500, { code: 'write-failed' })
        return
      }
      if (!written) {
        sendJson(res, 503, { code: 'profile-unavailable' })
        return
      }
      sendJson(res, 200, config)
    },
  }), 'dsh-starpie: GET/PUT config')

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
      if (restartInFlight) {
        sendJson(res, 409, { code: 'restart-in-flight' })
        return
      }
      restartInFlight = true
      /* Awaited: exiting the host is irreversible, so the watchdog has to be
         confirmed running first. The old code trusted an unconditional
         `return true`, which meant any asynchronous spawn failure killed DSH
         with nothing left to bring it back. */
      const started = await spawnRestartWatchdog()
      if (!started) {
        restartInFlight = false
        sendJson(res, 503, { code: 'restart-unavailable' })
        return
      }
      sendJson(res, 200, { ok: true })
      /* Let the response flush, then leave; the watchdog relaunches us once
         this pid is gone. */
      setTimeout(() => process.exit(0), 400)
    },
  }), 'dsh-starpie: POST restart')
}
