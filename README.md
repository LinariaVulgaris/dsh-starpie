# StarPie

English | [简体中文](README.zh-CN.md)

> **Credits** — this plugin is inspired by [StarPie](https://github.com/Star-Pie/StarPie), a modern mouse-wheel gesture system for Windows. It is an independent implementation for the DeepSeek Harness Web GUI.

A right-click radial menu for the DeepSeek Harness (DSH) Web GUI.

Right-click inside a conversation and a liquid-glass ring unfolds at the pointer, one click away from the things you actually reach for: the plugin market, a new session, the workspace folder, its path, a restart of DSH itself — plus any settings section you want, including ones contributed by other plugins.

Everything about the ring is configured from a settings section the plugin adds, called **StarPie**: which actions appear, their order, the trigger area, ring size, pop-in duration, seven liquid-glass tuning sliders with a live preview, motion strength, and theme color.

## Requirements

- DeepSeek Harness with a Web GUI, either in a browser or in the Desktop app. Developed and tested against **DSH 0.2.2-rc.3**. No `engines.dsh` range is declared, so installation is not version-gated; if a future DSH release changes the settings-panel or slot APIs this plugin hooks into, the affected actions may need adjusting.
- A managed profile. The configuration is stored per profile. In an environment with no profile, saving reports a failure and the ring keeps running on its defaults.
- No dependencies and no build step. The bundle is plain ES modules plus one injected CSS string; React comes from the DSH client module loader.

## Install

Open the **Plugins** page in the DSH sidebar and choose **Add plugin** (or the arrow beside it, then **Install a third-party plugin**). The field accepts a package name, a Git address, a tarball, or an absolute local path:

| Source | What to enter |
| --- | --- |
| GitHub | `github:LinariaVulgaris/dsh-starpie` or `https://github.com/LinariaVulgaris/dsh-starpie.git` |
| A local clone | the absolute path to the cloned directory, for example `D:\code\dsh-starpie` or `/home/you/code/dsh-starpie` |

From a terminal instead:

```bash
git clone https://github.com/LinariaVulgaris/dsh-starpie.git
dsh plugin --profile <name> add /absolute/path/to/dsh-starpie
```

An agent can install it too, with the `plugin_manager` tool: `install_bundle` with the target `github:LinariaVulgaris/dsh-starpie`. Every `plugin_manager` action needs `danger-full-access` or approval for that call.

The bundle is enabled by default after installation. It appears under **Installed plugins** as *StarPie* (星盘) and adds a **StarPie** section to the settings panel. With HMR enabled the bundle activates immediately; without it, the running composition is kept until you restart DSH.

### Updating

A bundle installed from Git shows no **Versions** section. If the spec pinned a full 40-character commit, the Plugins page offers a Git update; a spec naming a branch or a tag is not updatable, so remove the plugin and install the new revision. Configuration lives in your profile and survives both. Coming from a build installed under the earlier name `@local/dsh-radial-menu`? Remove that entry first — see [Notes and limitations](#notes-and-limitations).

## Usage

- Right-click in the conversation area (or anywhere on the page, if you widen the trigger area). The ring opens centred on the pointer, sized to stay on screen.
- Hover a sector to read what it does — its label sits on the ring and its icon moves to the centre of the disc. Click to run it.
- Keyboard: arrow keys move the selection, Enter runs it, Esc closes the ring. Clicking the centre disc closes it too. While the ring is open it shows these hints on a line beneath itself, replaced by the hovered sector's description.
- The ring closes on window resize or blur, and on a scroll that follows a deliberate scroll gesture within 300 ms.
- The ring opens only while a session is present in the main view; with no session open, a right-click does nothing.

## Configuration

Open **Settings → StarPie**. Nothing changes on the real ring until you press **Save**; saving applies immediately and persists to the current profile.

| Control | What it does |
| --- | --- |
| Right-click trigger area | *Conversation only* (default), or *Whole page (except inputs)* — which also keeps out of editable areas, the composer, existing context menus, and the ring's own layer |
| Ring size | 140–320 px, default 200 |
| Pop-in duration | 120–900 ms, default 380 |
| Live preview | A sample disc rendered with the real structure, recipe, and size over a simulated page backdrop. Sliders apply to it instantly; click it, or **Replay animation**, to replay the entrance at the current duration and motion. It follows the panel's unsaved draft |
| Liquid glass tuning | Seven multipliers on the tuned default recipe — blur, saturation, brightness, tint opacity, specular rim, dividers, fog sheen. Each one is a scale where 100% reproduces the default exactly |
| Motion | *Springy* (always the full bounce), *Gentle* (grow and fade only, no overshoot), *Follow system* (drops to Gentle when the OS asks for reduced motion) |
| Theme color | Ten presets (cyan by default) plus a custom `#rrggbb` picker |
| Actions and order | Checked actions on top with ↑ / ↓ to reorder; unchecked ones below, ready to add. Checking one appends it at the end |
| Reset to defaults | Footer button, far left. Restores every setting above at once, not just the sliders |
| Star on GitHub | Footer button, left of **Save**. Opens this repository's page in your machine's default browser; when no local browser can be reached (an SSH session, for example) it falls back to a new tab in the browser you are already using. If both are refused, the footer says so |

The action list is not limited to the five built-ins. Every section registered in the settings panel — built-in ones and those contributed by installed plugins — appears as an extra checkable row, so it can become a sector that jumps straight there. The one section that **Plugin market** already opens is left out of the list, so it cannot be added twice. When a plugin is removed or disabled its section row disappears from both the ring and the list; re-enabling the plugin brings it back, and a stale entry is only written away permanently when you press **Save**.

## Built-in actions

| Action | Behavior |
| --- | --- |
| Plugin market | Opens the settings panel and lands on its **Plugin market** section |
| Settings sections (dynamic) | One sector per checked settings section; jumps straight to it |
| New session | Starts a new session in the current workspace |
| Open folder | Opens the session's workspace directory in the system file manager (`explorer`, `open`, or `xdg-open`) |
| Copy path | Writes the full workspace directory path to the clipboard |
| Restart DSH | Exits DeepSeek Harness and relaunches it the way it was started. The only action with a confirmation dialog |

**Restart DSH** deserves the detail. It warns that every running task and in-flight AI output is interrupted immediately, adds a red warning when the current session is generating, and spells out the difference between the two hosts:

- **Web** — the Host spawns a detached watchdog that waits for the exit and relaunches the original command, so the new instance keeps listening on the address the old terminal was serving.
- **Desktop** — the watchdog terminates the Electron shell after the Host exits, which releases the single-instance lock, and then relaunches the app as an ordinary GUI. Unsaved window state is not kept.

Under SSH the action reports that it is unavailable instead of restarting.

## Sector icons are hard-coded

Every icon in the ring is hand-authored and **hard-coded** in `client.js`. Nothing is fetched at runtime, and the plugin ships no icon font and no image assets:

- `ICON_PATHS` maps a glyph name to one SVG path string, drawn in a 24×24 viewBox. The glyphs are stroke-only; the two centre-disc state badges (success, failure) add a filled circle behind the mark. The five built-in actions each use a glyph of the same name; the rest serve the settings sections and the centre-disc states (close, loading, success, failure).
- `SECTION_ICONS` maps a settings-section id to one of those glyph names. A section that is not listed falls back to the gear outline.
- The settings navigation exposes no icon data to read (`settings.section.icon` has no occupants, and the shell draws its own navigation glyph), so this table cannot be generated automatically — a newly installed plugin's section stays a gear until someone adds a mapping for it.

That makes an icon a good task to hand to an agent. Describe the section you want a glyph for and let the agent append a 24×24 stroke path to `ICON_PATHS` and point `SECTION_ICONS` at it; a prompt along the lines of *"draw a 24×24 stroke-only icon for the `cost-meter` settings section and wire it into `ICON_PATHS` and `SECTION_ICONS` in `client.js`"* is enough. An unknown glyph name falls back to the close cross, so a typo shows up immediately instead of breaking the ring.

## Notes and limitations

- The **Plugin market** sector opens the settings panel by simulating a click on the avatar menu in the lower-left corner, the same path a user takes. When that menu cannot be found it falls back to synthesizing the **Open settings** keyboard shortcut, which is available in Web only; on Desktop, shortcuts go through a native channel.
- **Plugin market** then clicks the section row by its label. If the panel has not rendered that row within roughly 2.5 seconds, the action reports a failure.
- The liquid-glass finish is the only one; there is no style picker. Dark and light themes share one structure and differ only in a set of CSS recipe variables.
- Upgrading from a build installed under the earlier name `@local/dsh-radial-menu`: remove that entry from **Plugins** first, then install this one. Two copies loaded at once would register two overlays, two settings sections, and two sets of Host routes. Your saved ring carries over on its own — the Host reads the old `dsh-radial-menu.json` whenever `dsh-starpie.json` does not exist yet, and the client retargets a saved `section:astrolabe` sector to the renamed section id. The old file is left untouched and never written to; the first **Save** creates the new one beside it.

## Security

The Host half registers four routes, and each one asks the connection whether the request should be rejected before doing any work:

- `POST /dsh-starpie/open-dir` — requires an absolute path to a directory that exists, and refuses outright when DSH was launched over SSH. On Windows the path must also be drive-rooted: `path.win32.isAbsolute()` counts `\\host\share` as absolute, and statting one would hand your NTLMv2 challenge/response to whoever owns that host. It only ever spawns the platform's file manager.
- `GET` / `HEAD` / `PUT /dsh-starpie/config` — reads and writes one JSON file inside the profile directory, atomically (unique temp file, `fsync`, then rename, with concurrent saves serialised). Every value is clamped or validated on the way in: sizes, durations, and slider ranges are bounded, the accent must match `#rrggbb`, and action ids must be a known built-in or a `section:<id>` slug of bounded length and charset — an unrecognised section is simply one whose sector fails to open.
- `POST /dsh-starpie/restart` — terminates the process. Hence the confirmation dialog.
- `POST /dsh-starpie/open-url` — opens one address in the machine's default browser. The requested URL is matched exactly against a single allow-listed value, this repository's page, so the route cannot be turned into a general "open any URL" primitive; it refuses under SSH, and the client then falls back to a browser tab.

There is no telemetry and no analytics. The plugin itself makes no outbound request: the four routes above are served by your own DSH Host over loopback, and the only traffic they can cause is a browser window your own machine opens — a file-manager window, or this repository's page after you press **Star on GitHub**. Conversation content is never read beyond the current session's workspace directory path.

## Configuration file

Settings are stored as JSON in the active profile directory:

```
<DSH profile directory>/dsh-starpie.json
```

typically `~/.dsh/profiles/<profile>/dsh-starpie.json`. The file holds `version`, `enabled`, `scope`, `size`, `accent`, `duration`, the seven liquid multipliers, `motion`, and the ordered `items` list.

Hand-editing is supported but rarely needed. One thing only the file can do: set `"enabled": false` to pause the ring without uninstalling the plugin. Pressing **Save** in the panel writes `enabled: true` again.

## Uninstall

**Plugins → StarPie → Remove**, and confirm. Your `dsh-starpie.json` stays in the profile, so reinstalling brings your configuration back.

## How it works

```
package.json        bundle manifest: exports, files, dsh.bundle.patch, dsh.client
cordis.patch.yml    inserts the bundle's plugin row into the profile composition
index.js            Host half — a Cordis plugin injecting `webServer`, registering the four routes
client.js           browser half — loaded through window.__ModuleLoader__, registers the ring and the settings section
locale/en.json      display metadata for the Plugins page (English), incl. meta.detail
locale/zh.json      the same in Chinese, pointing at docs/DETAIL.zh.md
docs/DETAIL.md      the long description shown on the plugin's page (English)
docs/DETAIL.zh.md   the same in Chinese
icon.svg            the plugin icon, hand-drawn
README.md           this file
README.zh-CN.md     the Chinese README
CHANGELOG.md        release notes
LICENSE             MIT
.gitignore          node_modules, dist, logs, OS droppings
```

`client.js` injects `slots`, `locale`, `layout`, `shortcuts`, and `sessions`. It registers a `shell.overlay` slot that renders the ring, and a `settings.section` slot that renders the StarPie panel. All markup is built with the React instance DSH provides; the stylesheet is a single injected `<style>` tag that removes its own superseded versions on load.

`docs/DETAIL.md` and `docs/DETAIL.zh.md` are what the **Plugins** page shows as the bundle's detail document. The Plugin Manager picks the file named by `meta.detail` in the matching `locale/<language>.json`, and falls back through the language chain to English.

## License

[MIT](LICENSE) © 2026 LinariaVulgaris
