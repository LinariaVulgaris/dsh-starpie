# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.0 - 2026-11-17

First public release. The ring behaves as it did in the 0.6.x line; this release
renames it for publication, adds one panel button, and makes it installable by
anyone else.

### Added

- A **Star on GitHub** button in the settings-panel footer, immediately left of
  **Save**. It opens this repository's page in the machine's default browser
  through a new Host route, `POST /dsh-starpie/open-url`, which accepts
  exactly one allow-listed URL and refuses under SSH; the client then falls back
  to opening a tab in the browser already in use.
- An attribution note crediting [StarPie](https://github.com/Star-Pie/StarPie)
  as the inspiration, at the top of both READMEs and both detail docs.
- A "sector icons are hard-coded" section in both READMEs and both detail docs,
  covering `ICON_PATHS` / `SECTION_ICONS` and how to have an agent draw a new
  24×24 stroke glyph for a section that currently shows the gear fallback.
- English `docs/DETAIL.md`, translated from the existing Chinese document.
- `README.md` (English) and `README.zh-CN.md` (Chinese).
- `LICENSE` (MIT) and this changelog.

### Changed

- Renamed the English display name from *Astrolabe* to **StarPie**; the Chinese
  name stays 星盘. Touched `locale/en.json` `meta.title`, the settings-section
  label and panel title, the `package.json` description and keywords, both
  READMEs, and both detail docs.
- Renamed the package from `@local/dsh-radial-menu` to `@local/dsh-starpie`, and
  with it the Cordis plugin id, the four Host route paths, the overlay and locale
  namespaces, the settings-section id, the internal CSS/DOM prefix (`drm-` is now
  `sp-`), and the configuration filename (now `dsh-starpie.json`). Two migrations
  keep an existing install working: the Host reads `dsh-radial-menu.json`
  whenever `dsh-starpie.json` is absent, and `migrateItems` retargets a stored
  `section:astrolabe` sector to the renamed id. The stylesheet moved to a fresh
  `dsh-starpie/styles/v1` tag and all sixteen old `dsh-radial-menu/styles` ids
  joined `STALE_STYLE_TAGS`, so an upgraded profile cannot end up carrying two
  sheets. Remove the old package from **Plugins** before installing this one —
  both loaded at once would register two overlays, two settings sections, and two
  sets of routes.
- Moved the bundle from `plugin/` to the repository root, so it can be installed
  straight from a Git URL or by pointing **Add plugin** at a fresh clone.
- Rewrote `locale/en.json` and `locale/zh.json` `meta.description`, and the
  vestigial inline `zh` copy of it inside `client.js`: all three still advertised
  session actions (fork, interrupt, copy) and a ripple animation that were
  removed long before 1.0.0.
- Pointed `locale/zh.json` `meta.detail` at `docs/DETAIL.zh.md`; it previously
  shared the English path.
- Added repository, homepage, bugs, keywords and author metadata to
  `package.json`.
- Corrected two inaccurate statements in the detail docs: **Reset to defaults**
  restores every setting, not just the sliders, and the ring is opened by a plain
  document-level `contextmenu` listener, so the "gestures other than Shift+F10"
  parenthetical in `docs/DETAIL.zh.md` was dropped.
- Documented a limitation that was missing from both detail docs: the ring only
  opens while a session is present in the main view.

### Fixed

A whole-project code review before release. None of this changes how the ring
looks or behaves in the happy path; it is the failure paths.

- **Restart could leave DSH dead.** The handler exited the process on the
  strength of an unconditional `return true` from the watchdog spawn. Node
  reports a bad `execPath`, an unusable `stdio` combination and `EMFILE`
  asynchronously, so the harness could exit with nothing left to relaunch it.
  The spawn is now awaited on its `spawn` versus `error` event, and a second
  request while one is in flight answers `409` instead of spawning a second
  watchdog.
- **The desktop watchdog only worked by accident.** Under the Electron shell
  `process.execPath` is the Electron binary, which honours `-e` only while
  `ELECTRON_RUN_AS_NODE` is set; until now it was merely inherited. It is set
  explicitly.
- **The watchdog could relaunch into a lock it had not released.** Its inner
  poll ran its step on the deadline without re-checking that the shell had
  died, so the new instance could lose Electron's single-instance lock and
  quit. It re-checks now, and no longer signals pid 1 on POSIX.
- **Concurrent saves corrupted the configuration.** A PID-stable temp filename
  let two overlapping writes interleave into invalid JSON; separately, Windows
  `rename()` fails `EPERM` while another rename is in flight. Writes are
  serialised, the temp name is unique, the data is `fsync`ed before the rename,
  the rename retries, and a failure answers `500 write-failed` instead of
  escaping to the dispatcher's bare 400.
- **A broken config file silently served somebody else's values.** The
  fallback to the pre-1.0.0 file fired on any read error, not just absence, so
  a corrupt `dsh-starpie.json` resurrected the old values behind a `200` and
  the next **Save** wrote them over the file. It now falls back only on
  `ENOENT` and reports `config-invalid` / `config-unreadable` otherwise.
- **A failed launch took the whole harness down.** `spawn()` with no `error`
  listener turns an `ENOENT` — a Linux host without `xdg-open`, say — into an
  uncaught exception, which DSH's fail-loud handler turns into a host
  `exit(1)`. The file-manager and browser launches are awaited and answer
  `502 launch-failed`; an unsupported platform answers `501`.
- `open-dir` no longer accepts Windows UNC paths. `path.win32.isAbsolute()`
  counts `\\host\share` as absolute, so a caller on the loopback could make
  the host stat an attacker's share — disclosing an NTLMv2
  challenge/response and stalling the handler — and then browse it.
- Processes handed to the operating system (file manager, browser) no longer
  inherit the harness environment; credential-shaped variables and `DSH_*`
  internals are stripped first. The restart watchdog still inherits
  everything, because it is DSH relaunching itself.
- Persisted sector ids are restricted to a slug charset. A length bound alone
  let control characters, quotes and markup into the config file for every
  later consumer to inherit.
- `Number(null)` is `0`, which is finite: a `null` size, duration or slider
  value clamped to the bottom of its range instead of falling back to the
  default.
- **Unchecking "Restart DSH" could not be saved.** `migrateItems` appended it
  on every load rather than only while migrating, so the next read put the
  sector back. The Host now adds it once, while reading a pre-1.0.0 file.
- `enabled` is no longer overwritten. `saveConfig` hard-coded `enabled: true`,
  so the file-only kill switch was reverted by the first **Save**; the value
  read from disk is now carried through, along with the schema `version`.
- The key-hint line under the ring was computed but permanently hidden: its
  visibility attribute was keyed on a hovered sector rather than on the text.
  It shows now, which is what the 52 px the ring reserves below itself was
  for.
- A right-click while an action was in flight suppressed the browser's own
  menu and opened nothing, for as long as the settings panel took to open (up
  to ~4 s). The busy check runs first now and leaves the native menu alone.
- `isDuplicateOfFixed` matched any section id containing "market", so a
  third-party section named `marketing-tools` was hidden from the list while
  the real market section could still be added twice. It compares against the
  resolved market section id now.
- The restart confirmation dialog took focus and never returned it, so the
  composer caret was lost after Cancel, Esc or Confirm, and Tab walked out of
  the modal. It restores focus on close and traps Tab between its two buttons.
- **Settings failures reported the wrong thing.** Every "the settings panel
  did not open" path threw a plain `Error` carrying an English string, which
  the ring flattened into a generic "Action failed. Please retry" — the
  purpose-built `settings-unavailable` message was unreachable. Those paths
  throw a dedicated error the ring can translate. `synthesizeSettingsOpen`
  also reported success without checking that anything opened, and a binding
  whose key was literally `+` was split into empty tokens; both are handled.
- The Russian alternative in the settings-menu text matcher was a
  Latin/Cyrillic mix (`naстройки`) that could never match, so a Russian host
  fell through to a positional guess. It is real Cyrillic now.
- `labelWidthPercent(1)` returned 0, collapsing a single-sector ring's label
  to one character per line.
- The injected stylesheet was never removed, so disabling the plugin at
  runtime left its CSS in `<head>`. A disposal effect removes it.
- The settings panel could double-submit (the `saving` guard read a stale
  closure value), the "saved" notice never cleared, and a failed **Star on
  GitHub** was silent. All three are handled.
- Sector-icon lookups are guarded with `Object.hasOwn`, so a hand-edited
  config naming `section:constructor` can no longer resolve to an
  `Object.prototype` member instead of the gear fallback.
- Removed four dead locale keys (`export.pending`, `export.success`, and the
  inline `zh` copies of `meta.title` / `meta.description`, which had already
  drifted out of date once) and two dead lines of component state.

### Removed

- `client.js.bak-v048` and `client.js.bak-v050`, stale local development backups
  that were never referenced by `package.json` `files`.

## 0.6.5 - 2026-11-17

- The sector highlight glides smoothly between menu items instead of snapping;
  the wedge-shaped glow travels the short way across 0° and is masked to the
  sector band.

## 0.6.4 - 2026-11-17

- Faded the fog veil at the disc edge to remove the white halo around the rim.

## 0.6.1 - 2026-11-17

- Added a live liquid-glass preview to the settings panel, with a close fade
  synced to the real ring.

## 0.6.0 and earlier

- Replaced the disc-style picker with liquid-glass tuning sliders; liquid glass
  became the only finish.
- Added the **Restart DSH** action with a detached watchdog relaunch, Desktop
  support by terminating the Electron shell, and a confirmation dialog exclusive
  to that sector.
- Made the stylesheet self-heal on load and on every render.
- Migrated the settings panel to expose dynamic settings-section sectors.
