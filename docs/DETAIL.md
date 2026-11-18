# StarPie

Right-clicking inside a DeepSeek Harness conversation pops a ring menu at the pointer, putting the actions you use most one click away.

> **Credits** — this plugin is inspired by [StarPie](https://github.com/Star-Pie/StarPie), a modern mouse-wheel gesture system for Windows.

## Usage

- Right-click anywhere in the conversation area; the ring unfolds centred on the pointer.
- Hover a sector to read what it does, click to run it, click the centre disc or press Esc to close, or use the arrow keys to select and Enter to run. While the ring is open it shows those key hints on a line beneath itself, replaced by the hovered sector's description.
- Everything is configured in the **StarPie section of the settings panel**: pick which actions appear, reorder them with the arrows, choose the right-click trigger area (conversation only / whole page), and set the ring size, pop-in duration, liquid-glass finish (below), motion strength, and theme color. Saving applies immediately and persists to the current profile. The ring no longer carries a "customize menu" sector of its own — every slot is left for real actions.
- The menu appears with a bloom animation: the disc scales up from the pointer with a springy overshoot while the sector icons fade in one after another; closing collapses the disc back to its centre (there is no ripple). The panel's **Motion** setting has three tiers: Springy (default, always plays the full animation), Gentle (scale and fade only, no overshoot), and Follow system (drops to Gentle automatically when the OS asks for reduced motion).
- Moving between sectors no longer snaps the highlight: the selection is a single wedge-shaped glow that slides around the ring from one item to the next (last to first takes the short way across 0°), fading in and out on enter and leave, and the press flash cross-fades the same way. A radial mask confines the glow to the sector band (18% to 47% of the disc), so it can never bleed over the rim or into the centre hole. Under Gentle motion (or reduced motion) only the fade remains, without the slide. The panel's live preview reproduces this exactly.
- The disc is fixed to the **liquid glass** finish (there is no style picker any more): a heavy blur with moderate saturation, a neutral milky veil that is denser at the top and thinner at the bottom to read as top lighting, and a restrained specular rim instead of a hard bevel. The disc, the centre lens, and the sector hover state share one structure; dark and light themes differ only in a set of `--lq-*` recipe variables.
- The panel has a **Liquid glass tuning** group with seven sliders: blur, saturation, brightness, tint opacity, specular rim, dividers, and fog sheen. Each one is a multiplier on the tuned default recipe (100% reproduces it exactly), applies as soon as you save, and persists with the configuration; **Reset to defaults** restores every setting at once — the actions and their order, the trigger area, ring size, pop-in duration, all seven sliders, the motion tier, and the theme color.
- Above that group is the **Live preview**: a sample rendered with the real disc's structure, recipe, and size over a simulated page backdrop. Dragging any slider, or changing the ring size, pop-in duration, motion, theme color, or which actions are checked and in which order, shows up in the preview immediately; clicking the preview (or **Replay animation**) replays the entrance at the current duration and motion tier, and hovering its sectors lights them up. The preview reflects the panel's draft state only — it reaches the real right-click menu after you press **Save**.
- The panel footer holds three buttons: **Reset to defaults** on the far left, then **Star on GitHub**, then **Save**. **Star on GitHub** opens this project's repository page in your machine's default browser through the plugin's own local route; if the harness runs somewhere you cannot reach a browser (an SSH session, for example) it falls back to opening the page in a new tab of the browser you are already using.

## Built-in actions

| Action | Behavior |
| --- | --- |
| Plugin market | Opens the settings panel and lands on its **Plugin market** section |
| Settings sections (dynamic) | The panel automatically lists every section row in the settings panel — built-in ones and those contributed by installed plugins, such as account, general, models, plugins, agent presets, the cost meter, and StarPie itself, plus whatever your other plugins add. Check one and it becomes a sector that jumps straight to that section. When a plugin is removed or disabled its section sector disappears from both the ring and the panel list; re-enabling the plugin brings the sector back, and a stale entry is only written away permanently when you press **Save**. The one section that the fixed **Plugin market** action already opens is left out of the list, so it cannot be added twice. Section glyphs are hand-authored by this plugin (the settings navigation exposes no icon data to read); unrecognised sections draw a gear outline |
| New session | Starts a new session in the current workspace |
| Open folder | Opens the session's workspace directory in the system file manager |
| Copy path | Writes the full workspace directory path to the clipboard |
| Restart DSH | Exits DeepSeek Harness and relaunches it the way it was started. This is the only action with a confirmation dialog: it warns that every running task and in-flight AI output is interrupted immediately, adds a red warning when this session is currently generating, and spells out how the restart behaves on Desktop versus Web. Web: the Host spawns a detached watchdog that waits for the exit and relaunches the original command, so the new instance keeps listening on the original terminal's address. Desktop: the watchdog terminates the Electron shell after the Host exits (releasing the single-instance lock) and then relaunches the app as an ordinary GUI. Under SSH the action reports that it is unavailable |

Hovering any sector also shows that sector's icon in the centre of the disc, resolved through the same icon lookup the sector itself uses (dynamic section sectors included); with nothing hovered the centre shows a close cross.

## Sector icons

Every icon in the ring is hand-authored and **hard-coded** in `client.js`. Nothing is fetched at runtime, and the plugin ships no icon font and no image assets:

- `ICON_PATHS` maps a glyph name to one SVG path string, drawn in a 24×24 viewBox. The glyphs are stroke-only; the two centre-disc state badges (success, failure) add a filled circle behind the mark. The five built-in actions each use a glyph of the same name; the rest serve the settings sections and the centre-disc states (close, loading, success, failure).
- `SECTION_ICONS` maps a settings-section id to one of those glyph names. A section that is not listed falls back to the gear outline.
- The settings navigation exposes no icon data to read (`settings.section.icon` has no occupants, and the shell draws its own navigation glyph), so this table cannot be generated automatically — a newly installed plugin's section stays a gear until someone adds a mapping for it.

Adding or replacing an icon is therefore a small, self-contained edit, which makes it a good task to hand to an agent: say which section you want a glyph for, and have it append a 24×24 stroke path to `ICON_PATHS` and point `SECTION_ICONS` at it. An unknown glyph name falls back to the close cross, so a typo shows up immediately instead of breaking the ring.

## Limitations

- The **Plugin market** sector opens the settings panel by simulating a click on the avatar menu in the lower-left corner, the same path a user takes. When that menu cannot be found it falls back to synthesizing the **Open settings** keyboard shortcut (available in Web only; on Desktop shortcuts go through a native channel).
- **Plugin market** first opens the settings panel and then clicks the section row by its label; if the panel has not rendered that row within roughly 2.5 seconds the action reports a failure.
- The configuration lives in `dsh-starpie.json` inside the profile directory. In an environment with no profile (a purely headless one, for example) saving reports a failure and the ring keeps working from its defaults.
- The ring opens only while a session is present in the main view; with no session open a right-click does nothing.
- **Restart DSH** interrupts every session and task in the current process, and the page has to be reopened afterwards. A configuration saved before this action existed gains it once, appended at the end of the ring, while the Host reads the pre-1.0.0 file. On Desktop the restart force-terminates the Electron shell, so unsaved window state is not kept; the app reopens on its own a few seconds later.
