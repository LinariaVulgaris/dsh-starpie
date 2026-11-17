/**
 * Browser half of the radial right-click menu: a frame-wide overlay that
 * opens a pie of user-configurable actions at the pointer, plus the panel
 * that edits which actions appear and in which order.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-radial-menu',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useId, useRef, useState } = React

    /** Plugin locale namespace. */
    const NS = 'dshRadialMenu'
    /** Overlay registration id in shell.overlay. */
    const OVERLAY_ID = 'dsh-radial-menu'
    /** Settings-panel section id where the ring is configured. */
    const SETTINGS_SECTION_ID = 'astrolabe'
    /** Host routes served by this bundle's Host half. */
    const OPEN_DIR_ROUTE = '/dsh-radial-menu/open-dir'
    const CONFIG_ROUTE = '/dsh-radial-menu/config'
    const RESTART_ROUTE = '/dsh-radial-menu/restart'

    /** Every action the pie can show, in the order the panel lists them. */
    const ALL_ITEMS = [
      'plugin-market', 'new-session',
      'open-dir', 'copy-cwd',
      'restart-dsh',
    ]
    const DEFAULT_ITEMS = [
      'plugin-market', 'new-session',
      'open-dir', 'copy-cwd',
      'restart-dsh',
    ]
    /** Only plain #rrggbb accents are accepted; anything else falls back. */
    const ACCENT_RE = /^#[0-9a-fA-F]{6}$/
    const DEFAULT_ACCENT = '#67dce7'
    /** The disc is always liquid glass now; this is the hard-coded data-style. */
    const DEFAULT_STYLE = 'liquid'
    const DEFAULT_CONFIG = { version: 2, enabled: true, scope: 'conversation', size: 200, accent: DEFAULT_ACCENT, duration: 380, blur: 1, saturation: 1, brightness: 1, tint: 1, specular: 1, divider: 1, fog: 1, motion: 'full', items: DEFAULT_ITEMS }
    /** Liquid-glass tuning knobs. Each is a unitless scale where 1 reproduces
        the tuned default exactly, so untouched sliders never shift the look.
        Ranges keep alpha-bearing values within a sane clamp and never let the
        material collapse to nothing at the low end. */
    const LIQUID_PARAMS = [
      { key: 'blur', css: '--lq-blur', min: 0, max: 3, step: 0.05 },
      { key: 'saturation', css: '--lq-sat', min: 0, max: 3, step: 0.05 },
      { key: 'brightness', css: '--lq-bright', min: 0.5, max: 2, step: 0.05 },
      { key: 'tint', css: '--lq-tint', min: 0, max: 2.5, step: 0.05 },
      { key: 'specular', css: '--lq-spec-hl', min: 0, max: 2.5, step: 0.05 },
      { key: 'divider', css: '--lq-divider', min: 0, max: 2.5, step: 0.05 },
      { key: 'fog', css: '--lq-fog', min: 0, max: 3, step: 0.05 },
    ]
    const LIQUID_BY_KEY = Object.fromEntries(LIQUID_PARAMS.map(param => [param.key, param]))
    /** Clamp a saved liquid value into its slider range, defaulting to 1. */
    function liquidValue(raw, key) {
      const param = LIQUID_BY_KEY[key]
      const n = Number(raw)
      return Number.isFinite(n) ? Math.min(param.max, Math.max(param.min, n)) : 1
    }
    /** Inline custom properties driving the liquid-glass recipe from config. */
    function liquidVars(config) {
      const vars = {}
      for (const param of LIQUID_PARAMS) vars[param.css] = String(liquidValue(config[param.key], param.key))
      return vars
    }
    /** Motion tiers: full bounce, gentle grow, or follow the system preference. */
    const MOTION_MODES = ['full', 'soft', 'auto']
    /** Prefix for dynamic ring items that open one settings section. */
    const SECTION_PREFIX = 'section:'
    const FIXED_ITEMS = new Set(ALL_ITEMS)
    /** Glyph per settings-section id. Sections not listed here draw the gear. */
    const SECTION_ICONS = {
      account: 'user',
      general: 'gear',
      pocket: 'phone',
      models: 'model',
      plugins: 'plugin',
      'agent-presets': 'agent',
      'dsh-session-manager.archive-cleanup': 'archive',
      'cost-meter': 'wallet',
      'our-free-model': 'spark',
      market: 'plugin-market',
      bili: 'video',
      astrolabe: 'astrolabe',
      'wallpaper-engine': 'image',
    }
    /** Window in ms after a user input in which a scroll event still counts as
     *  user-driven; scrolls arriving later are the chat's streaming tail-follow
     *  writing scrollTop and must not dismiss the pie. */
    const SCROLL_INTENT_WINDOW_MS = 300

    /* ---------- theme accent ---------- */
    /** Preset swatches shown in the settings section, first is the default. */
    const ACCENT_PRESETS = [
      { color: '#67dce7', name: 'accent.cyan' },
      { color: '#6ea8fe', name: 'accent.blue' },
      { color: '#8b5cf6', name: 'accent.violet' },
      { color: '#f472b6', name: 'accent.pink' },
      { color: '#fb7185', name: 'accent.rose' },
      { color: '#fb923c', name: 'accent.orange' },
      { color: '#facc15', name: 'accent.yellow' },
      { color: '#4ade80', name: 'accent.green' },
      { color: '#34d399', name: 'accent.emerald' },
      { color: '#94a3b8', name: 'accent.silver' },
    ]
    const PRESET_COLORS = ACCENT_PRESETS.map(row => row.color)
    /** Parse #rrggbb into "r g b" for rgb(var / alpha) usage; null when invalid. */
    function accentRgb(hex) {
      if (typeof hex !== 'string' || !ACCENT_RE.test(hex)) return null
      const value = parseInt(hex.slice(1), 16)
      return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`
    }
    /** Relative luminance of #rrggbb, 0 (black) .. 1 (white). */
    function accentLuminance(hex) {
      const value = parseInt(hex.slice(1), 16)
      const channel = (shift) => {
        const c = ((value >> shift) & 255) / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
    }
    /** Lighten/darken #rrggbb by a signed ratio toward white or black. */
    function accentShade(hex, ratio) {
      const value = parseInt(hex.slice(1), 16)
      const target = ratio >= 0 ? 255 : 0
      const amount = Math.abs(ratio)
      const mix = (shift) => {
        const c = (value >> shift) & 255
        return Math.round(c + (target - c) * amount)
      }
      return `#${((mix(16) << 16) | (mix(8) << 8) | mix(0)).toString(16).padStart(6, '0')}`
    }
    /** WCAG contrast ratio of two #rrggbb colors, 1 .. 21. */
    function contrastRatio(a, b) {
      const la = accentLuminance(a)
      const lb = accentLuminance(b)
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
    }
    /**
     * Build the layer CSS variables for one accent color:
     * - `--drm-accent-strong` lifts dark accents so ring feedback stays visible;
     * - `--drm-accent-solid`/`-fg` guarantee an AA-contrast filled button pair;
     * - the foreground is hue-matched to the accent instead of a fixed teal.
     */
    function accentVars(hex) {
      const accent = ACCENT_RE.test(hex) ? hex.toLowerCase() : DEFAULT_ACCENT
      const luminance = accentLuminance(accent)
      const strong = luminance < 0.25 ? accentShade(accent, 0.45) : accent
      const darkFg = accentShade(accent, -0.85)
      const whiteContrast = contrastRatio(accent, '#ffffff')
      const darkContrast = contrastRatio(accent, darkFg)
      let solid = accent
      let solidFg = whiteContrast >= darkContrast ? '#ffffff' : darkFg
      if (Math.max(whiteContrast, darkContrast) < 4.5) {
        /* Mid-dark accents like violet pass with neither candidate: darken the
           fill itself until white text clears AA. */
        solid = accentShade(accent, -0.4)
        solidFg = '#ffffff'
      }
      return {
        '--drm-accent': accent,
        '--drm-accent-rgb': accentRgb(accent),
        '--drm-accent-strong': strong,
        '--drm-accent-strong-rgb': accentRgb(strong),
        '--drm-accent-solid': solid,
        '--drm-accent-solid-fg': solidFg,
        '--drm-accent-solid-hover': accentShade(solid, accentLuminance(solid) > 0.4 ? -0.12 : 0.2),
        '--drm-accent-fg': solidFg,
      }
    }

    const zh = {
      'plugin-market': '插件市场', 'new-session': '新会话',
      'open-dir': '打开目录',
      'copy-cwd': '复制路径',
      'plugin-market.description': '打开设置面板中的插件市场分区',
      'new-session.description': '在当前工作区开始一个新会话',
      'open-dir.description': '在系统文件管理器中打开此会话的工作目录',
      'copy-cwd.description': '复制此会话工作目录的完整路径',
      'restart-dsh': '重启 DSH',
      'restart-dsh.description': '退出当前 DeepSeek Harness 进程,并以原启动命令重新拉起',
      'restart-dsh.pending': '正在重启 DSH…',
      'restart-dsh.success': 'DSH 正在重启',
      'restart-dsh.confirm.title': '重启 DSH',
      'restart-dsh.confirm.body': '将退出当前 DeepSeek Harness 进程,并以原启动方式重新拉起。',
      'restart-dsh.confirm.interrupt': '所有正在运行的任务与进行中的 AI 输出会被立即中断。',
      'restart-dsh.confirm.running': '检测到当前会话的 AI 正在思考或输出,重启会丢失这一轮的内容。',
      'restart-dsh.confirm.hint': '桌面版:窗口将关闭并在数秒后自动重新打开;\nWeb 版:重启后请用新地址重新打开页面。',
      'restart-dsh.confirm.cancel': '取消',
      'restart-dsh.confirm.ok': '确认重启',
      'open-dir.success': '已请求打开工作目录', 'copy-cwd.success': '工作目录路径已复制',
      'export.success': '已开始下载会话日志', 'plugin-market.success': '已打开插件市场',
      'new-session.success': '已开始新会话',
      'open-dir.pending': '正在打开工作目录…', 'copy-cwd.pending': '正在复制路径…',
      'export.pending': '正在准备会话日志…', 'plugin-market.pending': '正在打开插件市场…',
      'new-session.pending': '正在创建新会话…',
      menu: '环形快捷菜单', choose: '选择操作', cancel: '关闭菜单',
      keys: '方向键选择 · Enter 执行 · Esc 关闭',
      'no-directory': '此会话未设置工作目录',
      busy: '正在处理上一项操作,请稍候', failed: '操作未完成,请重试',
      'clipboard-denied': '无法写入剪贴板,请允许浏览器访问剪贴板后重试',
      'network-error': '无法连接本地服务,请检查连接后重试',
      'settings-unavailable': '未能打开设置:请通过左下角头像菜单进入,或在快捷键设置中为“打开设置”绑定按键',
      dismiss: '关闭提示',
      'panel.title': '星盘设置',
      'section.label': '星盘',
      'panel.scope': '右键触发范围',
      'panel.scope.conversation': '仅对话区域',
      'panel.scope.everywhere': '整个页面(输入框除外)',
      'panel.size': '圆盘大小',
      'panel.duration': '弹出时长',
      'panel.liquid': '液态玻璃微调',
      'panel.preview': '实时预览',
      'panel.preview.hint': '滑钮即时生效 · 点击圆盘重播动画',
      'panel.preview.replay': '重播动画',
      'panel.blur': '模糊强度', 'panel.saturation': '饱和度', 'panel.brightness': '亮度',
      'panel.tint': '底色浓度', 'panel.specular': '镜面高光', 'panel.divider': '分割线', 'panel.fog': '雾面光泽',
      'panel.motion': '动效强度',
      'motion.full': 'Q 弹(始终完整动画)', 'motion.soft': '轻柔(仅缩放淡入)', 'motion.auto': '跟随系统',
      'panel.accent': '主题颜色',
      'panel.accent.custom': '自定义颜色',
      'panel.accent.default': '默认',
      'accent.cyan': '青色', 'accent.blue': '蓝色', 'accent.violet': '紫罗兰',
      'accent.pink': '粉色', 'accent.rose': '玫红', 'accent.orange': '橙色',
      'accent.yellow': '黄色', 'accent.green': '绿色', 'accent.emerald': '翡翠绿', 'accent.silver': '银白',
      'panel.items': '菜单功能与顺序',
      'panel.save': '保存', 'panel.reset': '恢复默认',
      'panel.saved': '菜单配置已保存', 'panel.saveFailed': '保存失败,请重试',
      'panel.up': '上移', 'panel.down': '下移',
      'section.description': '打开设置面板中的「{label}」分区',
      'section.pending': '正在打开「{label}」…', 'section.success': '已打开「{label}」',
      'meta.title': '星盘',
      'meta.description': '在会话界面右键弹出可自定义的环形菜单:直达插件市场、设置、新会话,以及打断、打开目录、复制路径等操作;功能、顺序、圆盘大小、风格、动效与主题颜色在设置面板的「星盘」分区中自定义,菜单以涟漪晕开动效从指针中心展开。',
    }
    const en = {
      'plugin-market': 'Plugin market', 'new-session': 'New session',
      'open-dir': 'Open folder',
      'copy-cwd': 'Copy path',
      'plugin-market.description': 'Open the plugin market section inside the settings panel',
      'new-session.description': 'Start a new session in the current workspace',
      'open-dir.description': 'Open this session’s workspace in your file manager',
      'copy-cwd.description': 'Copy the full workspace directory path',
      'restart-dsh': 'Restart DSH',
      'restart-dsh.description': 'Exit the DeepSeek Harness process and relaunch it with the original command line',
      'restart-dsh.pending': 'Restarting DSH…',
      'restart-dsh.success': 'DSH is restarting',
      'restart-dsh.confirm.title': 'Restart DSH',
      'restart-dsh.confirm.body': 'This exits the current DeepSeek Harness process and relaunches it the way it was started.',
      'restart-dsh.confirm.interrupt': 'Every running task and in-flight AI output is interrupted immediately.',
      'restart-dsh.confirm.running': 'The AI in this session is thinking or streaming right now; restarting loses this turn’s output.',
      'restart-dsh.confirm.hint': 'Desktop: the window closes and reopens automatically after a few seconds;\nWeb: reopen the page at the new address afterwards.',
      'restart-dsh.confirm.cancel': 'Cancel',
      'restart-dsh.confirm.ok': 'Restart now',
      'open-dir.success': 'Requested to open the workspace', 'copy-cwd.success': 'Workspace path copied',
      'export.success': 'Session log download started', 'plugin-market.success': 'Plugin market opened',
      'new-session.success': 'New session started',
      'open-dir.pending': 'Opening workspace…', 'copy-cwd.pending': 'Copying path…',
      'export.pending': 'Preparing session log…', 'plugin-market.pending': 'Opening plugin market…',
      'new-session.pending': 'Starting a new session…',
      menu: 'Radial shortcuts', choose: 'Choose action', cancel: 'Close menu',
      keys: 'Arrows to select · Enter to run · Esc to close',
      'no-directory': 'This session has no workspace directory',
      busy: 'An action is already in progress', failed: 'Action failed. Please retry',
      'clipboard-denied': 'Clipboard access failed. Allow clipboard access and retry',
      'network-error': 'Cannot reach the local service. Check the connection and retry',
      'settings-unavailable': 'Could not open settings: use the avatar menu, or bind a key to “Open settings”',
      dismiss: 'Dismiss notification',
      'panel.title': 'Astrolabe settings',
      'section.label': 'Astrolabe',
      'panel.scope': 'Right-click trigger area',
      'panel.scope.conversation': 'Conversation only',
      'panel.scope.everywhere': 'Whole page (except inputs)',
      'panel.size': 'Ring size',
      'panel.duration': 'Pop-in duration',
      'panel.liquid': 'Liquid glass tuning',
      'panel.preview': 'Live preview',
      'panel.preview.hint': 'Sliders apply instantly · Click the disc to replay',
      'panel.preview.replay': 'Replay animation',
      'panel.blur': 'Blur', 'panel.saturation': 'Saturation', 'panel.brightness': 'Brightness',
      'panel.tint': 'Tint opacity', 'panel.specular': 'Specular rim', 'panel.divider': 'Dividers', 'panel.fog': 'Fog sheen',
      'panel.motion': 'Motion',
      'motion.full': 'Springy (always full)', 'motion.soft': 'Gentle (grow + fade)', 'motion.auto': 'Follow system',
      'panel.accent': 'Theme color',
      'panel.accent.custom': 'Custom color',
      'panel.accent.default': 'default',
      'accent.cyan': 'Cyan', 'accent.blue': 'Blue', 'accent.violet': 'Violet',
      'accent.pink': 'Pink', 'accent.rose': 'Rose', 'accent.orange': 'Orange',
      'accent.yellow': 'Yellow', 'accent.green': 'Green', 'accent.emerald': 'Emerald', 'accent.silver': 'Silver',
      'panel.items': 'Actions and order',
      'panel.save': 'Save', 'panel.reset': 'Reset to defaults',
      'panel.saved': 'Menu configuration saved', 'panel.saveFailed': 'Save failed. Please retry',
      'panel.up': 'Move up', 'panel.down': 'Move down',
      'section.description': 'Open the “{label}” section in the settings panel',
      'section.pending': 'Opening “{label}”…', 'section.success': 'Opened “{label}”',
    }

    const ICON_PATHS = {
      'plugin-market': 'M4 10v10h16V10 M4 10l2-6h12l2 6 M4 10h16 M9 20v-5h6v5',
      'new-session': 'M12 8v8 M8 12h8 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
      'open-dir': 'M3 8V5a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v2 M3 9h18l-3 11H3Z',
      'copy-cwd': 'M9 9h11v11H9Z M15 6V3H3v12h3',
      'restart-dsh': 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8 M21 3v5h-5',
      /* Section glyphs are hand-authored to match each plugin's subject; the
         settings nav exposes no icon data to read, so nothing here is scanned. */
      user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M4.5 20a7.5 7.5 0 0 1 15 0',
      /* A real toothed gear outline, NOT the ring-plus-8-rays shape that reads
         as a sun. The fallback must never look like the old star placeholder. */
      gear: 'M14.2 2.6h-4.4l-.6 2.3a7.4 7.4 0 0 0-1.7 1l-2.2-.8-2.2 3.8 1.7 1.6a7.5 7.5 0 0 0 0 2l-1.7 1.6 2.2 3.8 2.2-.8a7.4 7.4 0 0 0 1.7 1l.6 2.3h4.4l.6-2.3a7.4 7.4 0 0 0 1.7-1l2.2.8 2.2-3.8-1.7-1.6a7.5 7.5 0 0 0 0-2l1.7-1.6-2.2-3.8-2.2.8a7.4 7.4 0 0 0-1.7-1Z M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4',
      phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1 M11 18h2',
      /* Isometric cube: a square-bodied chip still reads as a ray burst at
         48px, so the Models sector uses a box glyph instead. */
      model: 'M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4Z M4 7.4l8 4.6 8-4.6 M12 12v9.2',
      plugin: 'M9 3v3 M15 3v3 M6 6h12v7a6 6 0 0 1-12 0Z M12 19v2',
      agent: 'M12 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M6 13a2.6 2.6 0 1 0 0 5.2A2.6 2.6 0 0 0 6 13 M18 13a2.6 2.6 0 1 0 0 5.2A2.6 2.6 0 0 0 18 13 M12 9v5 M12 14l-6 1.5 M12 14l6 1.5',
      archive: 'M3 5h18v4H3Z M5 9v11h14V9 M9 13h6',
      wallet: 'M3 7h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z M3 7V5a2 2 0 0 1 2-2h11 M17 13h.01',
      spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9Z',
      video: 'M3 6h11v12H3Z M14 10l7-4v12l-7-4',
      /* Compass with a needle: the ring alone would read as a sun glyph. */
      astrolabe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M15.6 8.4l-2.3 5.5-5.5 2.3 2.3-5.5Z',
      image: 'M3 5h18v14H3Z M3 16l5-5 4 4 3-3 6 6 M15.5 9h.01',
      close: 'M6 6l12 12 M18 6 6 18',
      loading: 'M21 12a9 9 0 1 1-9-9',
      'check-circle': 'm7.5 12 3 3 6-6',
      'error-circle': 'M12 7v6 M12 17h.01',
    }

    function MenuIcon({ name, size = 22 }) {
      const circular = name === 'check-circle' || name === 'error-circle'
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.65, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, focusable: 'false', 'data-drm-icon': name,
      }, circular ? h('circle', { cx: 12, cy: 12, r: 10, fill: 'currentColor', stroke: 'none' }) : null,
      h('path', { d: ICON_PATHS[name] ?? ICON_PATHS.close, stroke: circular ? '#fff' : undefined, strokeWidth: circular ? 2 : undefined }))
    }

    const STYLE_TAG = 'dsh-radial-menu/styles/v11'
    /** Earlier sheets this bundle supersedes; removed before the new one loads. */
    const STALE_STYLE_TAGS = ['dsh-radial-menu/styles', 'dsh-radial-menu/styles/v2', 'dsh-radial-menu/styles/v3', 'dsh-radial-menu/styles/v4', 'dsh-radial-menu/styles/v5', 'dsh-radial-menu/styles/v6', 'dsh-radial-menu/styles/v7', 'dsh-radial-menu/styles/v8', 'dsh-radial-menu/styles/v9', 'dsh-radial-menu/styles/v10']
    const CSS = `
[data-drm-layer], [data-drm-settings] { --drm-accent: #67dce7; --drm-accent-rgb: 103 220 231; --drm-accent-strong: #67dce7; --drm-accent-strong-rgb: 103 220 231; --drm-accent-solid: #67dce7; --drm-accent-solid-fg: #06333a; --drm-accent-solid-hover: #8fe9f1; --drm-accent-fg: #06333a; --drm-tint-pie: 8%; --drm-tint-hole: 14%; --drm-tint-active-1: 6%; --drm-tint-active-2: 15%; --drm-tint-active-3: 32%; --drm-elev: 0 16px 44px rgb(0 0 0 / .42); --drm-text-shadow: 0 1px 3px rgb(0 0 0 / .35); --drm-dur: 380ms; }
[data-drm-layer] { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; font-family: var(--dsw-font-family, system-ui, sans-serif); }
body:not([data-ds-dark-theme]) [data-drm-layer], body:not([data-ds-dark-theme]) [data-drm-settings] { --drm-tint-pie: 14%; --drm-tint-hole: 20%; --drm-tint-active-1: 9%; --drm-tint-active-2: 22%; --drm-tint-active-3: 46%; --drm-elev: 0 16px 40px rgb(15 23 42 / .22); --drm-text-shadow: 0 1px 2px rgb(255 255 255 / .6); }
/* Liquid glass, light theme. Only the recipe variables change here; every
   element rule further down reads them, so dark and light share one structure. */
body:not([data-ds-dark-theme]) [data-style="liquid"] { --lq-spec: calc(.95 * var(--lq-spec-hl, 1)); --lq-spec-mid: calc(.5 * var(--lq-spec-hl, 1)); --lq-spec-lo: calc(.12 * var(--lq-spec-hl, 1)); --lq-fog-top: .62; --lq-fog-bottom: .3; --lq-fog-wash: .22; --pie-bg: radial-gradient(circle closest-side, transparent 92.5%, rgb(255 255 255 / .5) 94%, transparent 95.6%), radial-gradient(circle closest-side, transparent 70%, rgb(255 255 255 / .28) 100%), radial-gradient(circle at 50% 112%, rgb(var(--drm-accent-rgb) / .14), transparent 58%), linear-gradient(155deg, rgb(255 255 255 / .55), rgb(255 255 255 / .12) 42%, rgb(255 255 255 / .04) 64%, rgb(255 255 255 / .28)), rgb(238 242 248 / calc(.44 * var(--lq-tint, 1))); --pie-shadow: 0 0 0 .5px rgb(15 23 42 / .16), 0 28px 56px -12px rgb(15 23 42 / .32), 0 8px 18px -6px rgb(15 23 42 / .14), inset 0 0 0 1px rgb(255 255 255 / .35), inset 2px 3px 5px -2px rgb(255 255 255 / .95), inset -2px -3px 5px -2px rgb(255 255 255 / .6), inset 0 0 40px rgb(255 255 255 / .22); --pie-blur: blur(calc(20px * var(--lq-blur, 1))) saturate(calc(1.8 * var(--lq-sat, 1))) brightness(calc(1.04 * var(--lq-bright, 1))); --pie-rim: rgb(255 255 255 / .85); --pie-divider: rgb(15 23 42 / calc(.16 * var(--lq-divider, 1))); --pie-hole-bg: radial-gradient(circle at 32% 22%, rgb(255 255 255 / .85), transparent 58%), radial-gradient(circle at 50% 120%, rgb(var(--drm-accent-rgb) / .2), transparent 62%), linear-gradient(160deg, rgb(255 255 255 / .5), rgb(255 255 255 / .12)), rgb(240 244 250 / .5); --lq-hole-border: rgb(15 23 42 / .1); --lq-hole-shadow: 0 8px 18px -4px rgb(15 23 42 / .28), 0 1px 3px rgb(15 23 42 / .14), inset 1.5px 2px 3px -1px rgb(255 255 255 / .95), inset -1.5px -2px 3px -1px rgb(255 255 255 / .6), inset 0 0 14px rgb(255 255 255 / .35); --lq-hole-hover-shadow: 0 0 0 1px rgb(var(--drm-accent-strong-rgb) / .5), 0 0 20px rgb(var(--drm-accent-strong-rgb) / .35), 0 8px 18px -4px rgb(15 23 42 / .26), inset 1.5px 2px 3px -1px rgb(255 255 255 / .95), inset -1.5px -2px 3px -1px rgb(255 255 255 / .6); --lq-active-bg: radial-gradient(circle closest-side, transparent 30%, rgb(var(--drm-accent-strong-rgb) / .12) 52%, rgb(var(--drm-accent-strong-rgb) / .26) 78%, rgb(var(--drm-accent-strong-rgb) / .1) 94%), radial-gradient(circle closest-side, transparent 30%, rgb(255 255 255 / .3) 52%, rgb(255 255 255 / .6) 78%, rgb(255 255 255 / .3) 94%); --lq-press-bg: radial-gradient(circle closest-side, transparent 30%, rgb(var(--drm-accent-strong-rgb) / .2) 52%, rgb(var(--drm-accent-strong-rgb) / .38) 78%, rgb(var(--drm-accent-strong-rgb) / .16) 94%), radial-gradient(circle closest-side, transparent 30%, rgb(255 255 255 / .45) 52%, rgb(255 255 255 / .8) 78%, rgb(255 255 255 / .45) 94%); }
[data-drm-settings] { display: flex; flex-direction: column; max-width: 560px; color: var(--dsw-alias-label-primary, #e8edf4); }
[data-drm-settings] h2 { margin: 0 0 4px; font-size: 15px; font-weight: 600; }
[data-drm-settings] p { margin: 0 0 14px; font-size: 12px; color: var(--dsw-alias-label-secondary, #a8b4c2); }
/* Invisible press surface that dismisses the pie on outside clicks. It used to
   paint a faint accent glow around the pointer, which read as a pale halo
   ringing the disc; the disc's own glass already carries its accent tint, so
   the catcher now draws nothing at all. */
[data-drm-catcher] { position: fixed; inset: 0; pointer-events: auto; }
[data-drm-pie], [data-drm-pie]::before, [data-drm-pie]::after, [data-drm-frost], [data-drm-hole], [data-drm-action] { corner-shape: round; }
/* The pie element itself carries no fill and no backdrop-filter: keeping
   will-change and a forwards fill off it lets Chromium drop the bloom
   animation's raster scale the moment the animation ends, so the settled disc
   re-rasterizes at scale 1 instead of staying on a cached enlarged raster. */
[data-drm-pie] { position: fixed; width: var(--drm-size); height: var(--drm-size); transform: translate(-50%, -50%); pointer-events: auto; border-radius: 50%; color: var(--dsw-alias-label-primary, #dce4ed); z-index: 1; box-shadow: var(--pie-shadow); animation: drm-bloom var(--drm-dur) cubic-bezier(.34, 1.56, .64, 1) backwards; }
/* Frosted pane as a SIBLING of the pie, in its own childless layer, and with
   no ENTRANCE animation or transition of its own — not even opacity (the
   close-only fade at [data-drm-frost][data-closing] below is the single
   exception, taken while the pane is already on its way out). Any animation on
   a backdrop-filter element promotes it to a composited layer whose backdrop
   snapshot Chromium can mis-place and stretch (it painted a displaced ellipse
   and left the disc unfilled), and any transformed ancestor defers the blur
   until the ancestor's animation ends (the sharp-then-frosted pop). A static
   childless pane samples the backdrop correctly from the first paint; the
   entrance motion lives in the pie layer above (icons, labels, centre hole),
   which carries no backdrop-filter of its own. The pane keeps only the blur
   and the fill: Chromium's backdrop blur bleeds a faint bright halo about one
   blur radius beyond a border-radius clip, so the pane is hard-clipped with
   clip-path (applied after the filter) to cut that bleed; the disc's outer
   depth shadow lives on the pie above, which has no backdrop-filter and thus
   paints a clean shadow ring. */
[data-drm-frost] { position: fixed; width: var(--drm-size); height: var(--drm-size); transform: translate(-50%, -50%); border-radius: 50%; pointer-events: none; z-index: 0; clip-path: circle(50% at 50% 50%); backdrop-filter: var(--pie-blur, none); background: var(--pie-bg); }
/* Diffused veil over the disc. It carries no backdrop-filter of its own: a
   second nested blur forced Chromium to re-sample the whole disc surface. It
   is pure gradient: a broad specular sheen from the upper left and a faint
   bounce light from the lower right, strengths set by --lq-fog-* per theme. */
[data-drm-fog] { position: absolute; inset: 0; border-radius: 50%; pointer-events: none; z-index: 1; background: radial-gradient(120% 72% at 28% 0%, rgb(255 255 255 / calc(var(--lq-fog-top, .2) * var(--lq-fog, 1))), transparent 56%), radial-gradient(90% 60% at 82% 108%, rgb(255 255 255 / calc(var(--lq-fog-bottom, .1) * var(--lq-fog, 1))), transparent 62%), linear-gradient(180deg, rgb(255 255 255 / calc(var(--lq-fog-wash, .04) * var(--lq-fog, 1))), transparent 34%); }
/* ---- disc styles: each one only swaps the fill / rim / divider / hole palette ---- */
/* Liquid glass (iOS-style). The surface is a clear, lightly tinted pane over a
   strong blur with boosted saturation and brightness, so what is behind it
   stays colorful instead of going grey. What sells the material is the edge:
   a specular rim that is brightest at the upper left and again, softer, at
   the lower right, a bevel from inset shadows, and a luminous band near the
   border that fakes the lens thickness. Dark values here; the light theme
   overrides only the variables (see the body:not(...) rule above). */
[data-style="liquid"] { --lq-spec: calc(.85 * var(--lq-spec-hl, 1)); --lq-spec-mid: calc(.3 * var(--lq-spec-hl, 1)); --lq-spec-lo: calc(.05 * var(--lq-spec-hl, 1)); --lq-fog-top: .2; --lq-fog-bottom: .1; --lq-fog-wash: .04; --pie-bg: radial-gradient(circle closest-side, transparent 92.5%, rgb(255 255 255 / .1) 94%, transparent 95.6%), radial-gradient(circle closest-side, transparent 72%, rgb(255 255 255 / .07) 100%), radial-gradient(circle at 50% 112%, rgb(var(--drm-accent-rgb) / .12), transparent 58%), linear-gradient(155deg, rgb(255 255 255 / .12), rgb(255 255 255 / .02) 40%, rgb(255 255 255 / .01) 62%, rgb(255 255 255 / .06)), rgb(24 26 32 / calc(.38 * var(--lq-tint, 1))); --pie-shadow: 0 0 0 .5px rgb(0 0 0 / .3), 0 30px 60px -14px rgb(0 0 0 / .55), 0 10px 22px -6px rgb(0 0 0 / .28), inset 0 0 0 1px rgb(255 255 255 / .06), inset 2px 3px 5px -2px rgb(255 255 255 / .55), inset -2px -3px 5px -2px rgb(255 255 255 / .3), inset 0 0 36px rgb(255 255 255 / .06); --pie-blur: blur(calc(18px * var(--lq-blur, 1))) saturate(calc(1.8 * var(--lq-sat, 1))) brightness(calc(1.1 * var(--lq-bright, 1))); --pie-rim: rgb(255 255 255 / .22); --pie-divider: rgb(255 255 255 / calc(.3 * var(--lq-divider, 1))); --pie-hole-bg: radial-gradient(circle at 32% 22%, rgb(255 255 255 / .3), transparent 58%), radial-gradient(circle at 50% 120%, rgb(var(--drm-accent-rgb) / .16), transparent 62%), linear-gradient(160deg, rgb(255 255 255 / .1), rgb(255 255 255 / .02)), rgb(30 32 38 / .3); --lq-hole-border: rgb(255 255 255 / .16); --lq-hole-shadow: 0 8px 20px -4px rgb(0 0 0 / .45), 0 1px 3px rgb(0 0 0 / .25), inset 1.5px 2px 3px -1px rgb(255 255 255 / .6), inset -1.5px -2px 3px -1px rgb(255 255 255 / .3), inset 0 0 14px rgb(255 255 255 / .08); --lq-hole-hover-shadow: 0 0 0 1px rgb(var(--drm-accent-strong-rgb) / .55), 0 0 20px rgb(var(--drm-accent-strong-rgb) / .35), 0 8px 20px -4px rgb(0 0 0 / .4), inset 1.5px 2px 3px -1px rgb(255 255 255 / .6), inset -1.5px -2px 3px -1px rgb(255 255 255 / .3); --lq-active-bg: radial-gradient(circle closest-side, transparent 30%, rgb(var(--drm-accent-strong-rgb) / .08) 52%, rgb(var(--drm-accent-strong-rgb) / .16) 78%, rgb(var(--drm-accent-strong-rgb) / .06) 94%), radial-gradient(circle closest-side, transparent 30%, rgb(255 255 255 / .08) 52%, rgb(255 255 255 / .17) 78%, rgb(255 255 255 / .07) 94%); --lq-press-bg: radial-gradient(circle closest-side, transparent 30%, rgb(var(--drm-accent-strong-rgb) / .16) 52%, rgb(var(--drm-accent-strong-rgb) / .3) 78%, rgb(var(--drm-accent-strong-rgb) / .12) 94%), radial-gradient(circle closest-side, transparent 30%, rgb(255 255 255 / .14) 52%, rgb(255 255 255 / .28) 78%, rgb(255 255 255 / .12) 94%); }
/* Specular rim: a 1.5px ring cut out of a conic gradient with a mask. The
   highlight sits at the upper left (315deg) and, weaker, at the opposite side. */
[data-drm-pie][data-style="liquid"]::before { inset: 0; border: 0; padding: 1.5px; background: conic-gradient(from 315deg, rgb(255 255 255 / var(--lq-spec)) 0deg, rgb(255 255 255 / var(--lq-spec-mid)) 28deg, rgb(255 255 255 / var(--lq-spec-lo)) 78deg, rgb(255 255 255 / var(--lq-spec-lo)) 112deg, rgb(255 255 255 / var(--lq-spec-mid)) 152deg, rgb(255 255 255 / calc(var(--lq-spec) * .7)) 180deg, rgb(255 255 255 / var(--lq-spec-mid)) 208deg, rgb(255 255 255 / var(--lq-spec-lo)) 258deg, rgb(255 255 255 / var(--lq-spec-lo)) 292deg, rgb(255 255 255 / var(--lq-spec-mid)) 332deg, rgb(255 255 255 / var(--lq-spec)) 360deg); mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; -webkit-mask-composite: xor; }
/* Dividers: soft one-pixel lines centred on each sector edge that fade out
   toward the centre disc and toward the rim instead of cutting the glass. */
[data-drm-pie][data-style="liquid"]::after { inset: 0; background: repeating-conic-gradient(from calc(0deg - var(--drm-step) / 2 - .4deg), transparent 0deg, var(--pie-divider) .4deg, transparent .8deg, transparent var(--drm-step)); mask: radial-gradient(circle closest-side, transparent calc(var(--drm-hole) + 2px), #000 calc(var(--drm-hole) + 18px), #000 78%, transparent 94%); }
/* Centre lens: its own small pane with a bevel. No nested backdrop-filter here;
   the disc already blurs what is behind it. */
[data-drm-pie][data-style="liquid"] [data-drm-hole] { border: 1px solid var(--lq-hole-border); box-shadow: var(--lq-hole-shadow); }
[data-drm-pie][data-style="liquid"] [data-drm-hole]:hover { border-color: rgb(var(--drm-accent-strong-rgb) / .5); box-shadow: var(--lq-hole-hover-shadow); }
/* Hovered / focused sector: a brighter pane of glass with a touch of accent. */
[data-style="liquid"] [data-drm-action][data-active]:not([data-disabled]), [data-style="liquid"] [data-drm-action]:focus-visible:not([data-disabled]) { background: var(--lq-active-bg); }
[data-style="liquid"] [data-drm-action]:active:not([data-disabled]) { background: var(--lq-press-bg); }
[data-style="glass"] { --pie-bg: radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--drm-accent-strong) var(--drm-tint-pie), transparent), transparent 64%), var(--dsw-alias-bg-overlay, radial-gradient(circle at 40% 25%, #292e34, #181b20 75%)); --pie-shadow: 0 0 0 1px rgb(var(--drm-accent-rgb) / .24), 0 0 30px rgb(var(--drm-accent-rgb) / .14), var(--drm-elev); --pie-blur: blur(10px) saturate(1.25); --pie-rim: var(--dsw-alias-border-l2, rgb(200 219 237 / .15)); --pie-divider: var(--dsw-alias-border-l3, rgb(209 224 236 / .14)); --pie-hole-bg: radial-gradient(circle at 50% 32%, color-mix(in srgb, var(--drm-accent-strong) var(--drm-tint-hole), transparent), transparent 72%), var(--dsw-alias-bg-layer-2, #2a3038); }
[data-style="solid"] { --pie-bg: radial-gradient(circle at 50% 38%, color-mix(in srgb, var(--drm-accent-strong) 6%, transparent), transparent 70%), var(--dsw-alias-bg-layer-1, #1d222a); --pie-shadow: 0 0 0 1px var(--dsw-alias-border-l2, #3a4250), 0 18px 48px rgb(0 0 0 / .5); --pie-rim: var(--dsw-alias-border-l1, #2c3440); --pie-divider: var(--dsw-alias-border-l2, #3a4250); --pie-hole-bg: var(--dsw-alias-bg-layer-2, #232932); }
[data-style="neon"] { --pie-bg: radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--drm-accent-strong) 10%, transparent), transparent 68%), rgb(9 11 16 / .9); --pie-shadow: 0 0 0 1.5px var(--drm-accent-strong), 0 0 26px color-mix(in srgb, var(--drm-accent-strong) 40%, transparent), inset 0 0 24px color-mix(in srgb, var(--drm-accent-strong) 12%, transparent), var(--drm-elev); --pie-rim: color-mix(in srgb, var(--drm-accent-strong) 40%, transparent); --pie-divider: color-mix(in srgb, var(--drm-accent-strong) 30%, transparent); --pie-hole-bg: radial-gradient(circle at 50% 32%, color-mix(in srgb, var(--drm-accent-strong) 18%, transparent), transparent 74%), rgb(9 11 16 / .92); }
[data-style="mist"] { --pie-bg: radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--drm-accent-strong) var(--drm-tint-pie), transparent), transparent 70%); --pie-shadow: 0 0 0 1px color-mix(in srgb, var(--drm-accent-strong) 30%, transparent); --pie-blur: blur(16px) saturate(1.3); --pie-rim: color-mix(in srgb, var(--drm-accent-strong) 26%, transparent); --pie-divider: color-mix(in srgb, var(--drm-accent-strong) 22%, transparent); --pie-hole-bg: color-mix(in srgb, var(--drm-accent-strong) 10%, transparent); }
/* Style picker: rounded pill buttons that follow the live theme accent.
   The accent is not hard-coded here; every color resolves from the
   --drm-accent-* variables that accentVars() recomputes per selection. */
[data-drm-style-row] { display: flex; align-items: center; gap: 6px; flex: 1; flex-wrap: wrap; }
[data-drm-style-option] { appearance: none; -webkit-appearance: none; margin: 0; padding: 6px 13px; border: 1px solid var(--dsw-alias-border-l2, #3a4250); border-radius: 999px; background: color-mix(in srgb, var(--drm-accent-strong) 7%, transparent); color: var(--dsw-alias-label-secondary, #a8b4c2); font: inherit; font-size: 12px; line-height: 1.35; cursor: pointer; transition: border-color .16s, background .16s, color .16s, box-shadow .16s, transform .12s; }
[data-drm-style-option]:hover { border-color: color-mix(in srgb, var(--drm-accent-strong) 60%, transparent); background: color-mix(in srgb, var(--drm-accent-strong) 16%, transparent); color: var(--drm-accent-strong); }
/* Selected: solid accent fill with contrast-checked foreground, a soft accent
   halo, and an inset hairline so it reads as picked even without hover. */
[data-drm-style-option][data-selected] { border-color: transparent; background: var(--drm-accent-solid); color: var(--drm-accent-solid-fg); font-weight: 600; box-shadow: 0 0 0 1px color-mix(in srgb, var(--drm-accent-strong) 55%, transparent), 0 3px 14px rgb(var(--drm-accent-rgb) / .42), inset 0 1px 0 rgb(255 255 255 / .28); }
[data-drm-style-option][data-selected]:hover { background: var(--drm-accent-solid-hover); color: var(--drm-accent-solid-fg); transform: translateY(-1px); }
[data-drm-style-option]:active { transform: scale(.97); }
[data-drm-style-option]:focus-visible { outline: 2px solid var(--drm-accent-strong); outline-offset: 2px; }
[data-drm-pie][data-closing] { animation: drm-close .15s ease-in forwards; pointer-events: none; }
[data-drm-pie][data-closing] [data-drm-label], [data-drm-pie][data-closing] [data-drm-hole] { animation: none; }
/* The pane dissolves in lockstep with the pie above it: identical .15s
   ease-in curve, opacity ONLY — a transform here would re-trigger the
   mis-placed backdrop snapshot the entrance experiments documented above.
   Without this fade the glass disc holds at full strength while the ring
   collapses, then pops out a beat late; if Chromium still drops the blur
   mid-fade the pane is vanishing anyway, so the worst case is a transient
   flat tint instead of an always-visible desync. */
[data-drm-frost][data-closing] { animation: drm-frost-out .15s ease-in forwards; }
[data-drm-pie]::before { content: ''; position: absolute; inset: 3%; border-radius: 50%; border: 1px solid var(--pie-rim, var(--dsw-alias-border-l2, rgb(200 219 237 / .15))); pointer-events: none; z-index: 3; }
[data-drm-pie]::after { content: ''; position: absolute; inset: 3%; border-radius: 50%; background: repeating-conic-gradient(from calc(0deg - var(--drm-step) / 2), var(--pie-divider, var(--dsw-alias-border-l3, rgb(209 224 236 / .14))) 0deg .45deg, transparent .45deg var(--drm-step)); mask: radial-gradient(circle, transparent 0 calc(var(--drm-hole) + 1px), #000 calc(var(--drm-hole) + 2px)); pointer-events: none; z-index: 3; }
[data-drm-hole] { appearance: none; box-sizing: border-box; position: absolute; left: 50%; top: 50%; width: calc(var(--drm-hole) * 2); height: calc(var(--drm-hole) * 2); margin: 0; padding: 8px; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; font: inherit; color: var(--dsw-alias-label-secondary, #c3d1df); border-radius: 50%; background: var(--pie-hole-bg, var(--dsw-alias-bg-layer-2, #2a3038)); border: 1px solid rgb(var(--drm-accent-rgb) / .3); box-shadow: 0 2px 12px rgb(0 0 0 / .28), inset 0 0 0 1px rgb(255 255 255 / .04); z-index: 4; cursor: pointer; transition: border-color .15s, box-shadow .15s, transform .15s; animation: drm-hole-in calc(var(--drm-dur) * .84) cubic-bezier(.34, 1.56, .64, 1) calc(var(--drm-dur) * .13) backwards; }
[data-drm-hole] strong { font-size: clamp(10px, calc(var(--drm-size) * .046), 11px); font-weight: 550; }
[data-drm-hole] span { font: 10px/1 system-ui, sans-serif; color: var(--dsw-alias-label-tertiary, #8997a7); letter-spacing: .08em; }
[data-drm-hole]:hover { border-color: var(--drm-accent-strong); box-shadow: 0 0 16px rgb(var(--drm-accent-strong-rgb) / .38), 0 2px 12px rgb(0 0 0 / .28); transform: translate(-50%, -50%) scale(1.05); }
[data-drm-hole]:focus-visible { outline: 2px solid var(--drm-accent-strong); outline-offset: 3px; }
[data-drm-action] { appearance: none; position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; padding: 0; border: 0; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; z-index: 2; transition: background .16s, color .16s; }
[data-drm-action][data-active]:not([data-disabled]), [data-drm-action]:focus-visible:not([data-disabled]) { background: radial-gradient(circle, color-mix(in srgb, var(--drm-accent-strong) var(--drm-tint-active-1), transparent) 12%, color-mix(in srgb, var(--drm-accent-strong) var(--drm-tint-active-2), transparent) 55%, color-mix(in srgb, var(--drm-accent-strong) var(--drm-tint-active-3), transparent)); color: var(--dsw-alias-label-primary, #fff); outline: none; }
[data-drm-action][data-active]:not([data-disabled]) [data-drm-icon] { color: var(--drm-accent-strong); filter: drop-shadow(0 0 8px rgb(var(--drm-accent-strong-rgb) / .5)); transform: scale(1.14); }
[data-drm-action][data-disabled] { color: var(--dsw-alias-label-tertiary, #78818e); cursor: not-allowed; }
[data-drm-action]:active:not([data-disabled]) [data-drm-icon], [data-drm-action]:active:not([data-disabled]) [data-drm-text] { transform: scale(.94); }
[data-drm-label] { position: absolute; width: var(--drm-label-width, 30%); transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 5px; color: inherit; font: 500 clamp(10px, calc(var(--drm-size) * .046), 11px)/1.3 system-ui, sans-serif; text-align: center; text-shadow: var(--drm-text-shadow); user-select: none; pointer-events: none; animation: drm-label-in calc(var(--drm-dur) * .9) cubic-bezier(.34, 1.56, .64, 1) backwards; animation-delay: calc(var(--drm-dur) * .18 + var(--drm-index, 0) * 26ms); }
[data-drm-icon] { display: block; flex: none; width: calc(var(--drm-size, 200px) * .083); height: calc(var(--drm-size, 200px) * .083); transition: transform .14s cubic-bezier(.3, 1.2, .6, 1), color .16s, filter .16s; }
[data-drm-text] { width: 100%; max-width: 100%; white-space: pre-line; overflow-wrap: anywhere; }
[data-drm-detail] { position: absolute; left: 50%; top: calc(100% + 10px); width: max-content; max-width: min(var(--drm-size), calc(100vw - 24px)); box-sizing: border-box; transform: translateX(-50%); padding: 5px 9px; border: 1px solid var(--dsw-alias-border-l2, #434d5c); border-radius: 8px; color: var(--dsw-alias-label-secondary, #b5c3d3); background: var(--dsw-alias-tooltip-bg, rgb(23 27 33 / .96)); box-shadow: 0 4px 12px rgb(0 0 0 / .2); font: 11px/1.4 system-ui, sans-serif; text-align: center; pointer-events: none; z-index: 5; visibility: hidden; }
[data-drm-detail][data-visible] { visibility: visible; }
[data-drm-toast] { position: fixed; left: 50%; top: 16px; z-index: 2; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; width: max-content; max-width: min(480px, calc(100vw - 32px)); box-sizing: border-box; padding: 10px 14px; border: 1px solid rgb(var(--drm-accent-rgb) / .28); border-radius: 14px; color: var(--dsw-alias-toast-label, #f6f8fb); background: var(--dsw-alias-toast-bg, rgb(22 27 35 / .96)); box-shadow: 0 8px 30px rgb(0 0 0 / .34), 0 0 0 1px rgb(255 255 255 / .04) inset; font-size: 13px; line-height: 20px; font-weight: 500; pointer-events: auto; animation: drm-toast-in .24s cubic-bezier(.3, 1.3, .6, 1); }
[data-drm-toast][data-kind="success"] > [data-drm-icon] { color: var(--dsw-alias-state-success-primary, #42bd7b); }
[data-drm-toast][data-kind="error"] > [data-drm-icon] { color: var(--dsw-alias-state-error-primary, #f16b73); }
[data-drm-toast][data-kind="pending"] > [data-drm-icon] { color: var(--drm-accent); animation: drm-spin .8s linear infinite; }
[data-drm-toast] button { appearance: none; flex: none; display: grid; place-items: center; width: 22px; height: 22px; margin: 0; padding: 3px; border: 0; border-radius: 5px; color: var(--dsw-alias-label-secondary, #aeb9c8); background: transparent; cursor: pointer; }
[data-drm-toast] button:hover { color: var(--dsw-alias-label-primary, #fff); background: var(--dsw-alias-interactive-bg-hover, rgb(255 255 255 / .08)); }
[data-drm-panel-list] { overflow-y: auto; overflow-x: hidden; margin: 0 0 12px; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; max-height: 300px; }
[data-drm-panel-list] li { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border: 1px solid var(--dsw-alias-border-l1, #2c3440); border-radius: 10px; background: var(--dsw-alias-bg-layer-2, #232932); transition: border-color .15s, background .15s; }
[data-drm-panel-list] li:hover { border-color: rgb(var(--drm-accent-rgb) / .45); background: var(--dsw-alias-bg-layer-2, #262d38); }
[data-drm-panel-list] li[data-off] { opacity: .62; }
[data-drm-panel-list] li[data-off]:hover { opacity: .9; }
[data-drm-panel-list] label { flex: 1; display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
[data-drm-panel-list] [data-drm-icon] { width: 16px; height: 16px; color: var(--dsw-alias-label-secondary, #9fb0c2); }
[data-drm-panel-list] button { appearance: none; display: grid; place-items: center; width: 24px; height: 24px; border: 0; border-radius: 6px; color: var(--dsw-alias-label-secondary, #aeb9c8); background: transparent; cursor: pointer; }
[data-drm-panel-list] button:hover:not(:disabled) { color: var(--drm-accent-strong); background: rgb(var(--drm-accent-strong-rgb) / .12); }
[data-drm-panel-list] button:disabled { opacity: .35; cursor: default; }
[data-drm-panel-field] { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; font-size: 13px; }
[data-drm-panel-field] select, [data-drm-panel-field] input[type="range"] { flex: 1; }
[data-drm-settings] input[type="checkbox"], [data-drm-settings] input[type="range"], [data-drm-settings] select { accent-color: var(--drm-accent); }
[data-drm-panel-field] select { background: var(--dsw-alias-bg-layer-2, #232932); color: inherit; border: 1px solid var(--dsw-alias-border-l2, #3a4250); border-radius: 8px; padding: 5px 8px; }
[data-drm-panel-field] input[type="range"] { height: 4px; border-radius: 2px; background: var(--dsw-alias-border-l2, #3a4250); cursor: pointer; }
[data-drm-panel-group] { display: flex; flex-direction: column; gap: 8px; margin: 2px 0 14px; padding: 12px 12px 6px; border: 1px solid var(--dsw-alias-border-l1, #2c3440); border-radius: 12px; background: var(--dsw-alias-bg-layer-2, rgb(255 255 255 / .02)); }
[data-drm-panel-group] h3 { margin: 0 0 4px; font-size: 12px; font-weight: 600; letter-spacing: .02em; color: var(--dsw-alias-label-secondary, #a8b4c2); }
[data-drm-panel-group] [data-drm-panel-field] { margin: 0; }
[data-drm-panel-group] [data-drm-panel-field] span { flex: none; min-width: 104px; color: var(--dsw-alias-label-secondary, #a8b4c2); font-variant-numeric: tabular-nums; }
/* ---- Live preview (settings panel) ---- */
/* The preview renders the production liquid-glass structure at the real ring
   size over a sample backdrop, so the sliders show their effect before saving.
   Only positioning is overridden (fixed -> absolute, centred in this clipped
   box); the recipe vars, entrance animations and hover states are the real
   thing. The frost pane keeps zero animation and never remounts, for the same
   Chromium backdrop-snapshot reasons documented on the production pane. */
[data-drm-preview-bar] { display: flex; align-items: center; gap: 8px; margin: 0 0 6px; font-size: 12px; color: var(--dsw-alias-label-secondary, #a8b4c2); }
[data-drm-preview-bar] > span:first-child { font-weight: 600; letter-spacing: .02em; }
[data-drm-preview-hint] { color: var(--dsw-alias-label-tertiary, #8997a7); }
[data-drm-preview-replay] { appearance: none; display: inline-flex; align-items: center; gap: 5px; margin: 0 0 0 auto; padding: 3px 10px; border: 1px solid var(--dsw-alias-border-l2, #3a4250); border-radius: 999px; background: transparent; color: inherit; font: inherit; font-size: 12px; cursor: pointer; transition: border-color .15s, color .15s; }
[data-drm-preview-replay]:hover { border-color: var(--drm-accent-strong); color: var(--drm-accent-strong); }
[data-drm-preview-replay]:focus-visible { outline: 2px solid var(--drm-accent-strong); outline-offset: 2px; }
[data-drm-preview-replay] [data-drm-icon] { width: 13px; height: 13px; }
[data-drm-preview] { position: relative; margin: 0 0 12px; height: calc(var(--drm-size, 200px) + 36px); border: 1px solid var(--dsw-alias-border-l1, #2c3440); border-radius: 14px; overflow: hidden; isolation: isolate; cursor: pointer; user-select: none; font-family: var(--dsw-font-family, system-ui, sans-serif); background-image: radial-gradient(150px 110px at 16% 24%, rgb(244 114 182 / .55), transparent 72%), radial-gradient(170px 120px at 84% 20%, rgb(96 165 250 / .5), transparent 70%), radial-gradient(160px 130px at 74% 82%, rgb(250 204 21 / .45), transparent 72%), radial-gradient(140px 110px at 24% 80%, rgb(52 211 153 / .45), transparent 70%), radial-gradient(130px 100px at 50% 46%, rgb(var(--drm-accent-rgb) / .4), transparent 70%), repeating-linear-gradient(0deg, transparent 0 15px, rgb(125 135 150 / .18) 15px 17px); background-color: var(--dsw-alias-bg-layer-1, #1d222a); }
[data-drm-preview] [data-drm-frost], [data-drm-preview] [data-drm-pie] { position: absolute; left: 50%; top: 50%; }
[data-drm-preview][data-motion="soft"] [data-drm-pie] { animation: drm-bloom-soft min(var(--drm-dur), 500ms) ease-out; }
[data-drm-preview][data-motion="soft"] [data-drm-hole] { animation: drm-fade-soft min(var(--drm-dur), 500ms) ease-out backwards; }
[data-drm-preview][data-motion="soft"] [data-drm-label] { animation: drm-fade-soft min(var(--drm-dur), 500ms) ease-out backwards; animation-delay: 0ms; }
[data-drm-preview][data-motion="soft"] [data-drm-hole], [data-drm-preview][data-motion="soft"] [data-drm-icon] { transition-duration: .01ms; }
[data-drm-accent-field] { margin: 0 0 12px; }
[data-drm-accent-field] > [data-drm-accent-caption] { display: flex; align-items: baseline; gap: 8px; margin: 0 0 8px; font-size: 13px; }
[data-drm-swatch-hex] { margin-left: auto; font: 500 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--drm-accent-strong); text-transform: uppercase; }
[data-drm-swatches] { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; }
[data-drm-swatch] { appearance: none; position: relative; width: 26px; height: 26px; margin: 0; padding: 0; border: 2px solid transparent; border-radius: 50%; background: var(--swatch); cursor: pointer; transition: transform .14s cubic-bezier(.3, 1.3, .6, 1), box-shadow .14s; box-shadow: 0 0 0 1px rgb(0 0 0 / .3); }
[data-drm-swatch]:hover { transform: scale(1.15); }
[data-drm-swatch][data-selected] { border-color: var(--dsw-alias-label-primary, #fff); transform: scale(1.12); box-shadow: 0 0 10px var(--swatch), 0 0 0 1px rgb(0 0 0 / .3); }
[data-drm-swatch][data-custom] { display: grid; place-items: center; overflow: hidden; background: conic-gradient(#f43f5e, #f59e0b, #22c55e, #06b6d4, #6366f1, #d946ef, #f43f5e); }
[data-drm-swatch][data-custom] input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; padding: 0; border: 0; opacity: 0; cursor: pointer; }
[data-drm-swatch]:focus-visible, [data-drm-swatch][data-custom]:has(input:focus-visible) { outline: 2px solid var(--drm-accent-strong); outline-offset: 2px; }
[data-drm-swatch][data-custom] svg { width: 13px; height: 13px; color: #fff; filter: drop-shadow(0 1px 2px rgb(0 0 0 / .5)); pointer-events: none; }
[data-drm-panel-list]::-webkit-scrollbar { width: 8px; }
[data-drm-panel-list]::-webkit-scrollbar-thumb { background: var(--dsw-alias-scrollbar-bg-l1, rgb(255 255 255 / .14)); border-radius: 4px; }
[data-drm-panel-list]::-webkit-scrollbar-track { background: transparent; }
/* Sticky footer: the action row stays reachable without scrolling past the
   whole section list, which grows with every installed plugin. */
[data-drm-panel-foot] { display: flex; justify-content: flex-end; align-items: center; gap: 8px; position: sticky; bottom: 0; z-index: 2; margin-top: 4px; padding: 10px 0 4px; background: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-overlay, #1d222a)); box-shadow: 0 -10px 20px -12px rgb(0 0 0 / .45); }
[data-drm-panel-foot] button { appearance: none; padding: 7px 16px; border-radius: 9px; border: 1px solid var(--dsw-alias-border-l2, #3a4250); background: var(--dsw-alias-button-ghost-active-fill, transparent); color: var(--dsw-alias-label-primary, #e8edf4); font-size: 13px; cursor: pointer; transition: border-color .15s, background .15s, transform .12s, box-shadow .15s; }
[data-drm-panel-foot] button[data-primary] { background: var(--drm-accent-solid, var(--drm-accent)); border-color: transparent; color: var(--drm-accent-solid-fg, var(--drm-accent-fg, #06333a)); font-weight: 600; box-shadow: 0 2px 12px rgb(var(--drm-accent-rgb) / .35); }
[data-drm-panel-foot] button[data-primary]:hover:not(:disabled) { background: var(--drm-accent-solid-hover, var(--drm-accent-solid, var(--drm-accent))); border-color: transparent; transform: translateY(-1px); box-shadow: 0 4px 16px rgb(var(--drm-accent-rgb) / .45); }
[data-drm-panel-foot] button[data-primary]:disabled { opacity: .45; cursor: default; box-shadow: none; }
[data-drm-panel-foot] button:hover:not([data-primary]) { border-color: var(--drm-accent-strong); color: var(--drm-accent-strong); }
[data-drm-save-note] { font-size: 12px; align-self: center; }
[data-drm-save-note][data-kind="success"] { color: var(--dsw-alias-state-success-primary, #42bd7b); }
[data-drm-save-note][data-kind="error"] { color: var(--dsw-alias-state-error-primary, #f16b73); }
[data-drm-reset] { margin-right: auto; }
/* Restart confirmation: a modal card over a dimmed page. Only the restart
   sector ever opens it; every other action runs on click as before. */
[data-drm-confirm] { position: fixed; inset: 0; z-index: 3; display: grid; place-items: center; pointer-events: auto; background: rgb(0 0 0 / .45); animation: drm-fade-soft .16s ease-out backwards; }
[data-drm-confirm-card] { width: min(420px, calc(100vw - 40px)); box-sizing: border-box; padding: 18px 20px 16px; border: 1px solid var(--dsw-alias-border-l2, #3a4250); border-radius: 14px; background: var(--dsw-alias-bg-layer-1, #1d222a); box-shadow: 0 24px 60px rgb(0 0 0 / .5); color: var(--dsw-alias-label-primary, #e8edf4); }
[data-drm-confirm-card] h3 { margin: 0 0 8px; font-size: 15px; font-weight: 600; }
[data-drm-confirm-card] p { margin: 0 0 8px; font-size: 13px; line-height: 1.55; color: var(--dsw-alias-label-secondary, #a8b4c2); }
[data-drm-confirm-card] p[data-drm-confirm-warn] { color: var(--dsw-alias-state-error-primary, #f16b73); font-weight: 700; }
[data-drm-confirm-hint] { font-size: 12px; color: var(--dsw-alias-label-tertiary, #8997a7); white-space: pre-line; margin-top: 10px; }
[data-drm-confirm-row] { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
[data-drm-confirm-row] button { appearance: none; padding: 7px 16px; border-radius: 9px; border: 1px solid var(--dsw-alias-border-l2, #3a4250); background: transparent; color: var(--dsw-alias-label-primary, #e8edf4); font-size: 13px; cursor: pointer; transition: border-color .15s, color .15s, filter .15s; }
[data-drm-confirm-row] button:hover { border-color: var(--drm-accent-strong); color: var(--drm-accent-strong); }
[data-drm-confirm-row] button:focus-visible { outline: 2px solid var(--drm-accent-strong); outline-offset: 2px; }
[data-drm-confirm-row] button[data-danger] { border-color: transparent; background: var(--dsw-alias-state-error-primary, #f16b73); color: #fff; font-weight: 600; }
[data-drm-confirm-row] button[data-danger]:hover { filter: brightness(1.12); color: #fff; }
@keyframes drm-toast-in { from { opacity: 0; transform: translate(-50%, -10px) scale(.96); } to { opacity: 1; transform: translate(-50%, 0) scale(1); } }
@keyframes drm-spin { to { transform: rotate(360deg); } }
@keyframes drm-bloom { from { opacity: 0; transform: translate(-50%, -50%) scale(.15); } 60% { opacity: 1; } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
@keyframes drm-bloom-soft { from { opacity: 0; transform: translate(-50%, -50%) scale(.7); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
@keyframes drm-fade-soft { from { opacity: 0; } to { opacity: 1; } }
@keyframes drm-close { from { opacity: 1; transform: translate(-50%, -50%) scale(1); } to { opacity: 0; transform: translate(-50%, -50%) scale(.25); } }
@keyframes drm-frost-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes drm-hole-in { from { opacity: 0; transform: translate(-50%, -50%) scale(.3); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
@keyframes drm-label-in { from { opacity: 0; transform: translate(-50%, -50%) scale(.4); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
[data-drm-layer][data-motion="soft"] [data-drm-pie] { animation: drm-bloom-soft min(var(--drm-dur), 500ms) ease-out; }
[data-drm-layer][data-motion="soft"] [data-drm-hole] { animation: drm-fade-soft min(var(--drm-dur), 500ms) ease-out backwards; }
[data-drm-layer][data-motion="soft"] [data-drm-label] { animation: drm-fade-soft min(var(--drm-dur), 500ms) ease-out backwards; animation-delay: 0ms; }
[data-drm-layer][data-motion="soft"] [data-drm-toast], [data-drm-layer][data-motion="soft"] [data-drm-toast][data-kind="pending"] > [data-drm-icon] { animation: none; }
[data-drm-layer][data-motion="soft"] [data-drm-hole], [data-drm-layer][data-motion="soft"] [data-drm-icon], [data-drm-layer][data-motion="soft"] [data-drm-swatch], [data-drm-layer][data-motion="soft"] [data-drm-panel-list] li, [data-drm-layer][data-motion="soft"] [data-drm-panel-list] button, [data-drm-layer][data-motion="soft"] [data-drm-panel-foot] button { transition-duration: .01ms; }
[data-drm-layer][data-motion="soft"] [data-drm-pie][data-closing], [data-drm-layer][data-motion="soft"] [data-drm-frost][data-closing] { display: none; }
`
    function ensureStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_TAG)}]`) !== null) return
      /* Drop every superseded sheet: a surviving older tag makes the guard
         above return early, which would silently keep stale rules in place. */
      for (const stale of STALE_STYLE_TAGS) {
        document.querySelector(`style[data-plugin-css=${JSON.stringify(stale)}]`)?.remove()
      }
      const tag = document.createElement('style')
      tag.dataset.pluginCss = STYLE_TAG
      tag.textContent = CSS
      document.head.appendChild(tag)
    }
    /* Assert the sheet as soon as this bundle evaluates: a hot module swap
       replaces the code without necessarily remounting the overlay, and the
       previous bundle's sheet would otherwise keep styling new markup. */
    ensureStyles()

    /* ---------- pie geometry (first slice points up) ---------- */
    const INNER_RATIO = 0.18
    const OUTER_RATIO = 0.47
    const LABEL_RATIO = 0.33
    function point(deg, radius) {
      const angle = deg * Math.PI / 180
      return [50 + Math.sin(angle) * radius, 50 - Math.cos(angle) * radius]
    }
    function sectorClip(index, count) {
      const span = 360 / count
      const start = index * span - span / 2
      const points = []
      for (const [radius, direction] of [[OUTER_RATIO * 100, 1], [INNER_RATIO * 100, -1]]) {
        for (let step = 0; step <= 20; step++) {
          const progress = direction === 1 ? step / 20 : 1 - step / 20
          const [x, y] = point(start + progress * span, radius)
          points.push(`${x.toFixed(3)}% ${y.toFixed(3)}%`)
        }
      }
      return `polygon(${points.join(',')})`
    }
    function labelPosition(index, count) {
      const [x, y] = point(index * 360 / count, LABEL_RATIO * 100)
      return { left: `${x}%`, top: `${y}%` }
    }
    function labelWidthPercent(count) {
      const spacing = 2 * Math.sin(Math.PI / count) * LABEL_RATIO * 100
      return Math.round(spacing * 0.9 * 10) / 10
    }
    function placeMenu(x, y, width, height) {
      const margin = 12
      const detailClearance = 52
      /* Integer geometry: an even diameter keeps the half-size translate on a
         whole pixel, and a whole-pixel centre stops every rim and glyph from
         sitting on a fractional pixel, which reads as a soft blur. */
      const size = 2 * Math.round(Math.max(120, Math.min(320, width - margin * 2, height - margin * 2 - detailClearance)) / 2)
      const radius = size / 2
      return {
        size,
        x: Math.round(Math.max(radius + margin, Math.min(x, width - radius - margin))),
        y: Math.round(Math.max(radius + margin, Math.min(y, height - radius - margin - detailClearance))),
      }
    }

    /* ---------- surface detection ---------- */
    const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
    const COMPOSER_SEAT = '[data-composer-seat]'
    const CONVERSATION_SURFACE = '[data-conversation-scroll], [data-phase], [data-chat-flow-key]'
    function isConversationSurface(target) {
      if (!(target instanceof Element)) return false
      if (target.closest(EDITABLE) !== null) return false
      if (target.closest(COMPOSER_SEAT) !== null) return false
      return target.closest(CONVERSATION_SURFACE) !== null
    }
    function isAllowedAnywhere(target) {
      if (!(target instanceof Element)) return false
      if (target.closest(EDITABLE) !== null) return false
      if (target.closest(COMPOSER_SEAT) !== null) return false
      if (target.closest('[data-context-menu-trigger]') !== null) return false
      if (target.closest('[role="menu"]') !== null) return false
      if (target.closest('[data-drm-layer]') !== null) return false
      return true
    }
    /* ---------- host base and small helpers ---------- */
    function hostBase() {
      const origin = globalThis.location?.origin
      return origin !== undefined && origin !== 'null' ? origin : 'http://dsh.internal'
    }
    function clipboardWrite(text) {
      const clipboard = globalThis.navigator?.clipboard
      if (clipboard === undefined) return Promise.reject(new Error('clipboard unavailable'))
      return clipboard.writeText(text)
    }

    const MAIN_VIEW_RETAIN_SOURCE = 'mainView'
    function mainViewSessionId(list) {
      for (const [id, row] of Object.entries(list.byId)) {
        if ((row?.retainedBy?.[MAIN_VIEW_RETAIN_SOURCE] ?? 0) > 0) return id
      }
      return undefined
    }
    function readState(list) {
      const sessionId = mainViewSessionId(list)
      const row = sessionId === undefined ? undefined : list.byId[sessionId]
      return { sessionId, cwd: row?.cwd ?? '', running: row?.running ?? false }
    }
    function equalState(a, b) {
      return a.sessionId === b.sessionId && a.cwd === b.cwd && a.running === b.running
    }

    function isActionEnabled(id, state) {
      switch (id) {
        case 'open-dir':
        case 'copy-cwd':
          return state.cwd !== ''
        default:
          return true
      }
    }
    function actionDescription(id, state, t) {
      if ((id === 'open-dir' || id === 'copy-cwd') && state.cwd === '') return t('no-directory')
      return t(`${id}.description`)
    }

    /* ---------- the pie ---------- */
    function RadialPie(props) {
      const { open, hover, setHover, actions, state, t, onClose, onExecute } = props
      const menuElement = useRef(null)
      const centerElement = useRef(null)
      const detailId = useId()
      /* The frosted pane paints from the very first frame, so the disc never
         shows an unblurred pass before the frost settles in. */
      useEffect(() => {
        if (open !== null && !open.closing) centerElement.current?.focus({ preventScroll: true })
      }, [open])
      useEffect(() => {
        const onKeyDown = (event) => {
          if (props.openRef.current === null || props.openRef.current.closing === true) return
          if (event.key === 'Escape' || event.key === 'Tab') {
            if (event.key === 'Escape') event.preventDefault()
            event.stopPropagation()
            onClose()
            return
          }
          if (['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
            event.preventDefault()
            event.stopPropagation()
            const items = Array.from(menuElement.current?.querySelectorAll('[role="menuitem"]') ?? [])
            if (items.length === 0) return
            const index = items.indexOf(document.activeElement)
            const direction = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
              : index < 0 ? (direction === 1 ? 0 : items.length - 1) : (index + direction + items.length) % items.length
            items[next]?.focus({ preventScroll: true })
          }
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => document.removeEventListener('keydown', onKeyDown, true)
      }, [onClose, props.openRef])
      if (open === null) return null
      const sectors = actions.map((id, index) => ({
        id, clip: sectorClip(index, actions.length), position: labelPosition(index, actions.length), index,
      }))
      const hovered = typeof hover === 'number' ? actions[hover] : undefined
      const description = hover === null ? t('keys')
        : hovered === undefined ? t('cancel')
          : props.describe(hovered, state)
      return h(React.Fragment, null,
        open.closing ? null : h('div', {
          'data-drm-catcher': '',
          onPointerDown: (event) => { event.preventDefault(); onClose() },
        }),
        /* Frosted pane: sibling of the pie so no transform-animated ancestor
           sits above its backdrop-filter, and childless so the glyphs in the
           pie layer above stay crisp (see the CSS note). */
        h('div', {
          'data-drm-frost': '', 'aria-hidden': true,
          key: `frost:${open.x}:${open.y}:${open.size}`,
          'data-style': DEFAULT_STYLE,
          /* Close-only marker: arms the pane's opacity fade so the disc
             dissolves in sync with the shrinking pie (see the CSS rule). */
          'data-closing': open.closing ? '' : undefined,
          style: {
            left: open.x, top: open.y,
            '--drm-size': `${open.size}px`,
          },
        }),
        h('div', {
          ref: menuElement, 'data-drm-pie': '', role: 'menu', 'aria-label': t('menu'),
          key: `${open.x}:${open.y}:${open.size}:${open.closing ? 'closing' : 'open'}`,
          'data-closing': open.closing ? '' : undefined,
          'data-style': DEFAULT_STYLE,
          onAnimationEnd: (event) => {
            if (event.target !== event.currentTarget) return
            if (open.closing) props.onClosed()
          },
          /* Hide the fading ghost from AT and Tab while it shrinks away. */
          'aria-hidden': open.closing ? true : undefined,
          onPointerDown: open.closing ? undefined : (event) => { event.stopPropagation() },
          style: {
            left: open.x, top: open.y,
            '--drm-size': `${open.size}px`,
            '--drm-hole': `${open.size * INNER_RATIO}px`,
            '--drm-step': `${360 / actions.length}deg`,
            '--drm-label-width': `${labelWidthPercent(actions.length)}%`,
            '--drm-dur': `${props.duration ?? 380}ms`,
          },
          onClick: (event) => {
            event.preventDefault()
            event.stopPropagation()
            if (event.target === event.currentTarget) onClose()
          },
        },
        /* Diffused haze pass, liquid style only, so the backdrop reads as
           light through frosted glass rather than sharp shapes. */
        h('div', { 'data-drm-fog': '', 'aria-hidden': true }),
        h('button', {
          ref: centerElement, 'data-drm-hole': '', type: 'button', 'aria-label': t('cancel'),
          tabIndex: open.closing ? -1 : undefined,
          onClick: onClose, onPointerEnter: () => setHover('cancel'), onFocus: () => setHover('cancel'),
        },
        /* Resolve through iconOf, the same face the sectors use: a section id
           such as 'section:astrolabe' is not a glyph name, so passing the raw
           id made every section hover fall back to the close "×". */
        h(MenuIcon, { name: hovered === undefined ? 'close' : props.iconOf(hovered), size: 20 }),
        h('strong', null, t('choose')),
        h('span', null, 'Esc')),
        h('div', { 'data-drm-detail': '', id: detailId, 'data-visible': typeof hover === 'number' ? '' : undefined },
          h('span', null, description)),
        sectors.map(({ id, clip, position, index }) => {
          const enabled = isActionEnabled(id, state)
          return h('button', {
            type: 'button', role: 'menuitem', tabIndex: -1, key: id,
            'data-drm-action': '', 'data-action': id,
            'data-active': hover === index ? '' : undefined,
            'data-disabled': enabled ? undefined : '',
            'aria-disabled': enabled ? undefined : true,
            title: props.labelOf(id), 'aria-label': props.labelOf(id), 'aria-describedby': detailId,
            style: { clipPath: clip },
            onPointerEnter: () => setHover(index),
            onPointerLeave: () => setHover(null),
            onFocus: () => setHover(index),
            onClick: (event) => { event.stopPropagation(); onExecute(id) },
          }, h('span', { 'data-drm-label': '', style: { ...position, '--drm-index': String(index) } },
            h(MenuIcon, { name: props.iconOf(id) }),
            h('span', { 'data-drm-text': '' }, props.labelOf(id))))
        })))
    }

    /* ---------- the settings section ---------- */
    function AccentSwatches({ accent, onPick, t }) {
      const groupRef = useRef(null)
      const isPreset = PRESET_COLORS.includes(accent)
      /* Roving tabindex: the group is one Tab stop, arrows move within it. */
      const focusIndex = ACCENT_PRESETS.findIndex(row => row.color === accent)
      const stopAt = (index) => {
        const wrapped = (index + ACCENT_PRESETS.length) % ACCENT_PRESETS.length
        onPick(ACCENT_PRESETS[wrapped].color)
        const node = groupRef.current?.querySelector(`[data-color=${JSON.stringify(ACCENT_PRESETS[wrapped].color)}]`)
        node?.focus()
      }
      const onKeyDown = (event) => {
        if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          const base = focusIndex < 0 ? 0 : focusIndex
          if (event.key === 'Home') stopAt(0)
          else if (event.key === 'End') stopAt(ACCENT_PRESETS.length - 1)
          else stopAt(base + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1))
        }
      }
      return h('div', { 'data-drm-accent-field': '' },
        h('div', { 'data-drm-accent-caption': '' },
          h('span', null, t('panel.accent')),
          h('span', { 'data-drm-swatch-hex': '' }, accent)),
        h('div', {
          ref: groupRef, 'data-drm-swatches': '', role: 'radiogroup', 'aria-label': t('panel.accent'), onKeyDown,
        },
        ACCENT_PRESETS.map(({ color, name }, index) => h('button', {
          type: 'button', key: color, 'data-drm-swatch': '', 'data-color': color,
          role: 'radio', 'aria-checked': accent === color,
          'aria-label': index === 0 ? `${t(name)} · ${t('panel.accent.default')}` : t(name),
          tabIndex: (focusIndex < 0 ? index === 0 : accent === color) ? 0 : -1,
          'data-selected': accent === color ? '' : undefined,
          style: { '--swatch': color },
          onClick: () => onPick(color),
        })),
        h('label', {
          'data-drm-swatch': '', 'data-custom': '',
          'data-selected': isPreset ? undefined : '',
          title: t('panel.accent.custom'),
          style: isPreset ? undefined : { '--swatch': accent, background: accent },
        },
        h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', 'aria-hidden': true },
          h('path', { d: 'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M18.4 5.6l-2.1 2.1 M7.7 16.3l-2.1 2.1' })),
        h('input', {
          type: 'color', value: accent, 'aria-label': t('panel.accent.custom'),
          title: t('panel.accent.custom'),
          onChange: (event) => onPick(event.target.value.toLowerCase()),
        }))))
    }

    /** Live preview of the disc: the real liquid-glass structure (frost pane +
        pie + hole + sectors) rendered at the configured size over a sample
        backdrop, so every control in this panel shows its effect before saving.
        It reads the panel's draft state only — the Save button remains the sole
        path into the live overlay. Clicking the box (or the replay button)
        remounts the pie layer to restart the entrance animation; the frost pane
        deliberately never remounts or animates, for the same Chromium
        backdrop-snapshot reasons documented on the production pane. */
    function LiquidPreview({ deps, size, duration, motion, liquid, items }) {
      const t = deps.t
      const [hover, setHover] = useState(null)
      const [replay, setReplay] = useState(0)
      /* Same tier resolution as the overlay root, so 'auto' previews what the
         ring would really play under the current system preference. */
      const systemReduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
      const tier = motion === 'auto' ? (systemReduce ? 'soft' : 'full') : motion
      const count = items.length
      const hovered = typeof hover === 'number' ? items[hover] : undefined
      const bump = () => setReplay(n => n + 1)
      return h(React.Fragment, null,
        h('div', { 'data-drm-preview-bar': '' },
          h('span', null, t('panel.preview')),
          h('span', { 'data-drm-preview-hint': '' }, t('panel.preview.hint')),
          h('button', {
            type: 'button', 'data-drm-preview-replay': '',
            title: t('panel.preview.replay'),
            onClick: bump,
          }, h(MenuIcon, { name: 'restart-dsh', size: 13 }), t('panel.preview.replay'))),
        h('div', {
          'data-drm-preview': '', 'data-motion': tier, 'aria-hidden': true,
          title: t('panel.preview.hint'),
          onClick: bump,
          style: { '--drm-size': `${size}px`, ...liquidVars(liquid) },
        },
          h('div', { 'data-drm-frost': '', 'data-style': DEFAULT_STYLE }),
          h('div', {
            key: replay, 'data-drm-pie': '', 'data-style': DEFAULT_STYLE,
            style: {
              '--drm-hole': `${size * INNER_RATIO}px`,
              '--drm-step': count > 0 ? `${360 / count}deg` : '360deg',
              '--drm-label-width': count > 0 ? `${labelWidthPercent(count)}%` : '30%',
              '--drm-dur': `${duration}ms`,
            },
          },
            h('div', { 'data-drm-fog': '', 'aria-hidden': true }),
            h('div', { 'data-drm-hole': '' },
              h(MenuIcon, { name: hovered === undefined ? 'close' : deps.itemIcon(hovered), size: 20 }),
              h('strong', null, t('choose')),
              h('span', null, 'Esc')),
            items.map((id, index) => h('button', {
              type: 'button', tabIndex: -1, key: id,
              'data-drm-action': '', 'data-active': hover === index ? '' : undefined,
              style: { clipPath: sectorClip(index, count) },
              onPointerEnter: () => setHover(index),
              onPointerLeave: () => setHover(null),
            }, h('span', { 'data-drm-label': '', style: { ...labelPosition(index, count), '--drm-index': String(index) } },
              h(MenuIcon, { name: deps.itemIcon(id) }),
              h('span', { 'data-drm-text': '' }, deps.itemLabel(id))))))))
    }

    /** The settings-panel section that edits the ring: scope, size, duration,
        liquid-glass tuning, motion tier, accent, and which actions it shows. */
    function AstrolabeSettings(props) {
      const { deps } = props
      const t = deps.t
      const [config, setConfig] = useState(deps.configSnapshot())
      useEffect(() => deps.subscribeConfig(setConfig), [deps])
      const [items, setItems] = useState(config.items.slice())
      const [checked, setChecked] = useState(() => new Set(config.items))
      const [scope, setScope] = useState(config.scope)
      const [size, setSize] = useState(config.size)
      const [duration, setDuration] = useState(Number.isFinite(config.duration) ? config.duration : 380)
      const [liquid, setLiquid] = useState(() => Object.fromEntries(LIQUID_PARAMS.map(param => [param.key, liquidValue(config[param.key], param.key)])))
      const [motion, setMotion] = useState(MOTION_MODES.includes(config.motion) ? config.motion : 'full')
      const [accent, setAccent] = useState(ACCENT_RE.test(config.accent) ? config.accent : DEFAULT_ACCENT)
      const [saving, setSaving] = useState(false)
      const [notice, setNotice] = useState(null)
      /* Adopt externally published config (initial load and post-save reload). */
      useEffect(() => {
        setItems(config.items.slice())
        setChecked(new Set(config.items))
        setScope(config.scope)
        setSize(config.size)
        setDuration(Number.isFinite(config.duration) ? config.duration : 380)
        setLiquid(Object.fromEntries(LIQUID_PARAMS.map(param => [param.key, liquidValue(config[param.key], param.key)])))
        setMotion(MOTION_MODES.includes(config.motion) ? config.motion : 'full')
        setAccent(ACCENT_RE.test(config.accent) ? config.accent : DEFAULT_ACCENT)
      }, [config])
      const available = [
        ...ALL_ITEMS,
        /* Every registered section can join the ring, including our own
           Astrolabe one, so the pie can open this very panel. The market
           section is skipped: the fixed 'plugin-market' action already opens
           exactly that panel, and offering both duplicated one feature twice
           with identical behavior (only the icon differed). */
        ...deps.sections()
          .filter(row => !deps.isDuplicateOfFixed(SECTION_PREFIX + row.id))
          .map(row => SECTION_PREFIX + row.id),
      ]
      const known = new Set(available)
      const rows = available.filter(id => checked.has(id))
      /* Saved items whose section vanished (plugin removed or disabled) drop
         out of the list and are not re-saved; reappearing sections come back
         because the saved config keeps them until an explicit save. */
      const ordered = items.filter(id => checked.has(id) && known.has(id))
      const listed = ordered.length > 0 ? ordered : rows
      const move = (index, delta) => {
        const next = listed.slice()
        const target = index + delta
        if (target < 0 || target >= next.length) return
        const [row] = next.splice(index, 1)
        next.splice(target, 0, row)
        setItems(next)
      }
      const toggle = (id, on) => {
        const nextChecked = new Set(checked)
        if (on) nextChecked.add(id)
        else nextChecked.delete(id)
        setChecked(nextChecked)
        if (on && !items.includes(id)) setItems([...items, id])
      }
      const submit = async () => {
        if (saving) return
        setSaving(true)
        const ok = await deps.saveConfig({ items: listed, scope, size, duration, motion, accent, ...liquid })
        setSaving(false)
        setNotice(ok ? 'saved' : 'failed')
      }
      return h('div', { 'data-drm-settings': '', style: accentVars(accent) },
      h('h2', null, t('panel.title')),
      h('div', { 'data-drm-panel-field': '' },
        h('span', null, t('panel.scope')),
        h('select', { value: scope, onChange: (event) => setScope(event.target.value) },
          h('option', { value: 'conversation' }, t('panel.scope.conversation')),
          h('option', { value: 'everywhere' }, t('panel.scope.everywhere')))),
      h('div', { 'data-drm-panel-field': '' },
        h('span', null, `${t('panel.size')} ${size}px`),
        h('input', {
          type: 'range', min: 140, max: 320, step: 10, value: size,
          onChange: (event) => setSize(Number(event.target.value)),
        })),
      h('div', { 'data-drm-panel-field': '' },
        h('span', null, `${t('panel.duration')} ${duration}ms`),
        h('input', {
          type: 'range', min: 120, max: 900, step: 20, value: duration,
          onChange: (event) => setDuration(Number(event.target.value)),
        })),
      h(LiquidPreview, { deps, size, duration, motion, liquid, items: listed }),
      h('div', { 'data-drm-panel-group': '', role: 'group', 'aria-label': t('panel.liquid') },
        h('h3', null, t('panel.liquid')),
        LIQUID_PARAMS.map(param => h('div', { 'data-drm-panel-field': '', key: param.key },
          h('span', null, `${t(`panel.${param.key}`)} ${Math.round(liquid[param.key] * 100)}%`),
          h('input', {
            type: 'range', min: param.min, max: param.max, step: param.step, value: liquid[param.key],
            'aria-label': t(`panel.${param.key}`),
            onChange: (event) => setLiquid(prev => ({ ...prev, [param.key]: Number(event.target.value) })),
          })))),
      h('div', { 'data-drm-panel-field': '' },
        h('span', null, t('panel.motion')),
        h('select', { value: motion, onChange: (event) => setMotion(event.target.value) },
          h('option', { value: 'full' }, t('motion.full')),
          h('option', { value: 'soft' }, t('motion.soft')),
          h('option', { value: 'auto' }, t('motion.auto')))),
      h(AccentSwatches, { accent, onPick: setAccent, t }),
      h('ul', { 'data-drm-panel-list': '' },
        listed.map((id, index) => h('li', { key: id },
          h('label', null,
            h('input', { type: 'checkbox', checked: true, onChange: () => toggle(id, false) }),
            h(MenuIcon, { name: deps.itemIcon(id), size: 16 }),
            h('span', null, deps.itemLabel(id))),
          h('button', {
            type: 'button', 'aria-label': t('panel.up'), disabled: index === 0,
            onClick: () => move(index, -1),
          }, '↑'),
          h('button', {
            type: 'button', 'aria-label': t('panel.down'), disabled: index === listed.length - 1,
            onClick: () => move(index, 1),
          }, '↓'))),
        available.filter(id => !checked.has(id)).map(id => h('li', { key: id, 'data-off': '' },
          h('label', null,
            h('input', { type: 'checkbox', checked: false, onChange: () => toggle(id, true) }),
            h(MenuIcon, { name: deps.itemIcon(id), size: 16 }),
            h('span', null, deps.itemLabel(id)))))),
      h('div', { 'data-drm-panel-foot': '' },
        h('button', {
          type: 'button', 'data-drm-reset': '',
          onClick: () => { setItems(DEFAULT_ITEMS.slice()); setChecked(new Set(DEFAULT_ITEMS)); setScope('conversation'); setSize(200); setDuration(380); setLiquid(Object.fromEntries(LIQUID_PARAMS.map(param => [param.key, 1]))); setMotion('full'); setAccent(DEFAULT_ACCENT) },
        }, t('panel.reset')),
        notice !== null ? h('span', { 'data-drm-save-note': '', 'data-kind': notice === 'saved' ? 'success' : 'error' },
          notice === 'saved' ? t('panel.saved') : t('panel.saveFailed')) : null,
        h('button', { type: 'button', 'data-primary': '', disabled: saving || listed.length === 0, onClick: () => { void submit() } }, t('panel.save'))))
    }

    /* ---------- restart confirmation ---------- */
    /** Modal card shown only by the restart sector: names the interruption
        cost, warns louder when the session is mid-generation, and says what
        the relaunch looks like per platform. Esc cancels; Cancel is focused. */
    function RestartConfirmDialog({ t, running, onCancel, onConfirm }) {
      const cancelRef = useRef(null)
      useEffect(() => { cancelRef.current?.focus({ preventScroll: true }) }, [])
      useEffect(() => {
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          onCancel()
        }
        document.addEventListener('keydown', onKey, true)
        return () => document.removeEventListener('keydown', onKey, true)
      }, [onCancel])
      return h('div', {
        'data-drm-confirm': '', role: 'alertdialog', 'aria-modal': true,
        'aria-label': t('restart-dsh.confirm.title'),
      },
      h('div', { 'data-drm-confirm-card': '' },
        h('h3', null, t('restart-dsh.confirm.title')),
        h('p', null, t('restart-dsh.confirm.body')),
        h('p', { 'data-drm-confirm-warn': '' }, t('restart-dsh.confirm.interrupt')),
        running ? h('p', { 'data-drm-confirm-warn': '' }, t('restart-dsh.confirm.running')) : null,
        h('p', { 'data-drm-confirm-hint': '' }, t('restart-dsh.confirm.hint')),
        h('div', { 'data-drm-confirm-row': '' },
          h('button', { ref: cancelRef, type: 'button', onClick: onCancel }, t('restart-dsh.confirm.cancel')),
          h('button', { type: 'button', 'data-danger': '', onClick: onConfirm }, t('restart-dsh.confirm.ok')))))
    }

    /* ---------- overlay root ---------- */
    function RadialMenu(props) {
      const state = props.useSessions(readState, equalState)
      const [config, setConfig] = useState(props.deps.configSnapshot())
      const [open, setOpen] = useState(null)
      const [hover, setHover] = useState(null)
      const [feedback, setFeedback] = useState(null)
      const busyRef = useRef(false)
      const aliveRef = useRef(true)
      const focusBeforeOpen = useRef(null)
      const openRef = useRef(open)
      const stateRef = useRef(state)
      const depsRef = useRef(props.deps)
      const configRef = useRef(config)
      /* Holds the menu snapshot captured when the restart dialog opens, so the
         confirmed run can proceed after the ring has closed (openRef is null). */
      const restartSnapshotRef = useRef(null)
      openRef.current = open
      stateRef.current = state
      depsRef.current = props.deps
      configRef.current = config

      useEffect(() => props.deps.subscribeConfig(setConfig), [props.deps])
      /* A hot module swap can leave the previous bundle's stylesheet in the
         head while this newer code renders (the mount effect below does not
         re-run for a preserved component), which shows new markup with old
         rules. Re-assert the sheet on every render: ensureStyles() is one
         querySelector when the current tag already exists. */
      useEffect(() => { ensureStyles() })
      useEffect(() => {
        if (feedback === null || feedback.kind === 'pending') return
        const timer = window.setTimeout(() => setFeedback(null), feedback.kind === 'error' ? 8000 : 4500)
        return () => window.clearTimeout(timer)
      }, [feedback])

      /** Close with a shrink-back animation; reduced motion closes at once.
          The pie's `animationend` ends it precisely; the timer is the fallback. */
      const CLOSE_FALLBACK_MS = 240
      const closeTimer = useRef(0)
      const finishClose = useCallback(() => {
        window.clearTimeout(closeTimer.current)
        closeTimer.current = 0
        openRef.current = null
        setOpen(null)
        setHover(null)
      }, [])
      const close = useCallback(() => {
        const current = openRef.current
        if (current === null || current.closing) return
        if (focusBeforeOpen.current?.isConnected) focusBeforeOpen.current.focus({ preventScroll: true })
        const mode = configRef.current.motion
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
        const tier = mode === 'auto' ? (reduce ? 'soft' : 'full') : mode
        if (tier === 'soft') {
          finishClose()
          return
        }
        const next = { ...current, closing: true }
        openRef.current = next
        setOpen(next)
        setHover(null)
        window.clearTimeout(closeTimer.current)
        closeTimer.current = window.setTimeout(finishClose, CLOSE_FALLBACK_MS)
      }, [finishClose])
      useEffect(() => () => window.clearTimeout(closeTimer.current), [])

      useEffect(() => {
        ensureStyles()
        aliveRef.current = true
        /* The chat keeps writing scrollTop to follow the streaming tail, so a
           bare scroll-close listener dismisses the pie the moment it opens
           during generation. Only close on scrolls the user actually caused:
           remember wheel/touch/press/scroll-key input and require the scroll
           event to arrive right after one. Programmatic tail-follow scrolls
           fall outside the window and leave the menu open. */
        let lastScrollIntent = 0
        const markScrollIntent = () => { lastScrollIntent = performance.now() }
        /* Arrows/Home/End/Tab/Escape are captured by the open pie itself, so
           only the remaining page-scroll keys count as intent. */
        const SCROLL_KEYS = new Set(['PageUp', 'PageDown', ' ', 'Spacebar'])
        const onIntentKeyDown = (event) => { if (SCROLL_KEYS.has(event.key)) markScrollIntent() }
        const onIntentPointerDown = (event) => { if (event.button === 0) markScrollIntent() }
        const onIntentPointerMove = (event) => { if ((event.buttons & 1) !== 0) markScrollIntent() }
        const onScroll = () => {
          if (openRef.current === null) return
          if (performance.now() - lastScrollIntent <= SCROLL_INTENT_WINDOW_MS) close()
        }
        const onContextMenu = (event) => {
          const mine = event.target instanceof Element ? event.target.closest('[data-drm-layer]') : null
          if (mine !== null) {
            event.preventDefault()
            return
          }
          const cfg = configRef.current
          if (!cfg.enabled) return
          const allowed = cfg.scope === 'everywhere'
            ? isAllowedAnywhere(event.target)
            : isConversationSurface(event.target)
          if (!allowed) return
          const current = stateRef.current
          if (current.sessionId === undefined || current.sessionId === '') return
          event.preventDefault()
          event.stopPropagation()
          if (busyRef.current) return
          const placed = placeMenu(event.clientX, event.clientY, window.innerWidth, window.innerHeight)
          placed.size = Math.min(placed.size, cfg.size)
          focusBeforeOpen.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
          const next = { ...placed, snapshot: { ...current } }
          window.clearTimeout(closeTimer.current)
          closeTimer.current = 0
          /* Input that happened before the pie existed (e.g. a left click
             right before the right-click) must not arm the scroll-close
             window for the freshly opened menu. */
          lastScrollIntent = 0
          openRef.current = next
          setOpen(next)
          setHover(null)
        }
        const onResize = () => close()
        document.addEventListener('contextmenu', onContextMenu, true)
        window.addEventListener('resize', onResize)
        window.addEventListener('blur', onResize)
        /* Scroll-intent sources: wheel and touch cover touchpad/mouse/touch
           scrolling, pointer press+drag covers the scrollbar, and the listed
           keys cover keyboard scrolling. A right-click press must not mark
           intent, or the tail-follow scroll right after opening would close
           the freshly opened pie again. */
        document.addEventListener('wheel', markScrollIntent, true)
        document.addEventListener('touchstart', markScrollIntent, true)
        document.addEventListener('touchmove', markScrollIntent, true)
        document.addEventListener('pointerdown', onIntentPointerDown, true)
        document.addEventListener('pointermove', onIntentPointerMove, true)
        document.addEventListener('keydown', onIntentKeyDown, true)
        document.addEventListener('scroll', onScroll, true)
        return () => {
          aliveRef.current = false
          document.removeEventListener('contextmenu', onContextMenu, true)
          window.removeEventListener('resize', onResize)
          window.removeEventListener('blur', onResize)
          document.removeEventListener('wheel', markScrollIntent, true)
          document.removeEventListener('touchstart', markScrollIntent, true)
          document.removeEventListener('touchmove', markScrollIntent, true)
          document.removeEventListener('pointerdown', onIntentPointerDown, true)
          document.removeEventListener('pointermove', onIntentPointerMove, true)
          document.removeEventListener('keydown', onIntentKeyDown, true)
          document.removeEventListener('scroll', onScroll, true)
        }
      }, [close])

      useEffect(() => {
        if (open !== null && open.snapshot.sessionId !== state.sessionId) close()
      }, [state.sessionId, open, close])

      const t = props.deps.t
      const [confirmRestart, setConfirmRestart] = useState(false)
      const execute = async (id, confirmed = false) => {
        if (busyRef.current) return
        /* The confirmed restart arrives after the ring has already closed, so
           openRef is null; reuse the snapshot captured when the dialog opened. */
        let snapshot
        if (confirmed && restartSnapshotRef.current !== null) {
          snapshot = restartSnapshotRef.current
        } else {
          const menu = openRef.current
          if (menu === null) return
          snapshot = { ...menu.snapshot, running: stateRef.current.running }
          if (!isActionEnabled(id, snapshot)) {
            setHover(null)
            return
          }
          /* The restart sector is the only destructive action: it interrupts
             every running task and the shell itself, so it asks first. */
          if (id === 'restart-dsh' && !confirmed) {
            restartSnapshotRef.current = snapshot
            close()
            setConfirmRestart(true)
            return
          }
        }
        busyRef.current = true
        setFeedback({ kind: 'pending', text: props.deps.itemPending(id) })
        close()
        try {
          await props.deps.run(id, snapshot)
          if (aliveRef.current) setFeedback({ kind: 'success', text: props.deps.itemSuccess(id) })
        } catch (error) {
          const message = id.startsWith('copy-') ? t('clipboard-denied')
            : error instanceof TypeError ? t('network-error')
              : `${props.deps.itemLabel(id)}:${t('failed')}`
          if (aliveRef.current) setFeedback({ kind: 'error', text: message })
        } finally {
          busyRef.current = false
          restartSnapshotRef.current = null
        }
      }

      const menuState = { ...(open?.snapshot ?? state), running: state.running }
      /* Hide section items whose plugin was removed or disabled this run;
         they return when the section is registered again. */
      const configured = config.items.filter(id => FIXED_ITEMS.has(id) || props.deps.isKnownSection(id))
      const actions = configured.length > 0 ? configured : ['plugin-market']
      const systemReduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
      const motionTier = config.motion === 'auto'
        ? (systemReduce ? 'soft' : 'full')
        : MOTION_MODES.includes(config.motion) ? config.motion : 'full'

      return h('div', { 'data-drm-layer': '', 'data-motion': motionTier, style: { ...accentVars(config.accent), ...liquidVars(config) } },
        h(RadialPie, {
          open, hover, setHover, actions, state: menuState, t, onClose: close, onClosed: finishClose,
          duration: config.duration,
          onExecute: (id) => { void execute(id) }, openRef,
          labelOf: props.deps.itemLabel, describe: props.deps.itemDescription, iconOf: props.deps.itemIcon,
        }),
        confirmRestart ? h(RestartConfirmDialog, {
          t, running: state.running,
          onCancel: () => setConfirmRestart(false),
          onConfirm: () => { setConfirmRestart(false); void execute('restart-dsh', true) },
        }) : null,
        h('div', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
          feedback !== null ? h('div', { 'data-drm-toast': '', 'data-kind': feedback.kind },
            h(MenuIcon, { name: feedback.kind === 'success' ? 'check-circle' : feedback.kind === 'error' ? 'error-circle' : 'loading', size: 20 }),
            h('span', null, feedback.text),
            feedback.kind !== 'pending' ? h('button', { type: 'button', 'aria-label': t('dismiss'), onClick: () => setFeedback(null) },
              h(MenuIcon, { name: 'close', size: 16 })) : null) : null))
    }

    /* ---------- action wiring ---------- */
    const CODE_BY_KEY = {
      ',': 'Comma', '.': 'Period', '/': 'Slash', ';': 'Semicolon', "'": 'Quote',
      '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', '-': 'Minus', '=': 'Equal', '`': 'Backquote',
    }
    function codeForToken(token) {
      if (CODE_BY_KEY[token] !== undefined) return CODE_BY_KEY[token]
      if (/^[A-Za-z]$/.test(token)) return `Key${token.toUpperCase()}`
      if (/^[0-9]$/.test(token)) return `Digit${token}`
      return token
    }
    function synthesizeSettingsOpen(ctx) {
      const row = ctx.shortcuts?.catalog?.getSnapshot?.().find(entry => entry.id === 'settings.open')
      const aria = row?.aria
      if (typeof aria !== 'string' || aria === '') return false
      const tokens = aria.split('+')
      const keyToken = tokens[tokens.length - 1]
      const init = { code: codeForToken(keyToken), key: keyToken === 'Space' ? ' ' : keyToken, bubbles: true, cancelable: true }
      for (const token of tokens.slice(0, -1)) {
        if (token === 'Control') init.ctrlKey = true
        else if (token === 'Alt') init.altKey = true
        else if (token === 'Shift') init.shiftKey = true
        else if (token === 'Meta') init.metaKey = true
      }
      window.dispatchEvent(new KeyboardEvent('keydown', init))
      return true
    }

    /** Configs saved before the restart action existed never list it; append
        it once so existing rings gain the sector without a manual save. */
    function migrateItems(items) {
      return items.includes('restart-dsh') ? items : [...items, 'restart-dsh']
    }

    function createDeps(ctx, t) {
      let current = { ...DEFAULT_CONFIG }
      const listeners = new Set()
      const publish = () => { for (const listener of listeners) listener(current) }
      /* Live view of the settings panel sections: built-in rows plus every
         installed plugin that contributes one (market, phone access, …). */
      let sectionsVersion = -1
      let sectionsLocale = -1
      let sections = []
      const readSections = () => {
        const version = ctx.slots.getVersion('settings.section')
        const revision = ctx.locale.getSnapshot().revision
        if (version !== sectionsVersion || revision !== sectionsLocale) {
          sectionsVersion = version
          sectionsLocale = revision
          sections = ctx.slots.entries('settings.section')
            .map(entry => ({
              id: String(entry.options.id ?? ''),
              label: String(typeof entry.options.label === 'function' ? entry.options.label() : entry.options.label ?? ''),
            }))
            .filter(row => row.id !== '' && row.label !== '')
        }
        return sections
      }
      const itemLabel = (id) => {
        if (id.startsWith(SECTION_PREFIX)) {
          const row = readSections().find(candidate => candidate.id === id.slice(SECTION_PREFIX.length))
          return row?.label ?? id.slice(SECTION_PREFIX.length)
        }
        return t(id)
      }
      const itemDescription = (id, state) => {
        if (id.startsWith(SECTION_PREFIX)) {
          return t('section.description').replace('{label}', itemLabel(id))
        }
        return actionDescription(id, state, t)
      }
      const load = async () => {
        try {
          const response = await fetch(new URL(CONFIG_ROUTE, hostBase()))
          if (!response.ok) return
          const parsed = await response.json()
          if (parsed === null || typeof parsed !== 'object') return
          current = {
            enabled: parsed.enabled === true,
            scope: parsed.scope === 'everywhere' ? 'everywhere' : 'conversation',
            size: Math.min(320, Math.max(140, Number(parsed.size) || 200)),
            duration: Math.min(900, Math.max(120, Number(parsed.duration) || 380)),
            blur: liquidValue(parsed.blur, 'blur'),
            saturation: liquidValue(parsed.saturation, 'saturation'),
            brightness: liquidValue(parsed.brightness, 'brightness'),
            tint: liquidValue(parsed.tint, 'tint'),
            specular: liquidValue(parsed.specular, 'specular'),
            divider: liquidValue(parsed.divider, 'divider'),
            fog: liquidValue(parsed.fog, 'fog'),
            motion: MOTION_MODES.includes(parsed.motion) ? parsed.motion : 'full',
            accent: typeof parsed.accent === 'string' && ACCENT_RE.test(parsed.accent)
              ? parsed.accent.toLowerCase()
              : DEFAULT_ACCENT,
            items: migrateItems(Array.isArray(parsed.items)
              ? parsed.items.filter(id => typeof id === 'string' && (FIXED_ITEMS.has(id) || id.startsWith(SECTION_PREFIX)))
              : DEFAULT_ITEMS),
          }
          publish()
        } catch {
          /* keep defaults */
        }
      }
      void load()
      const settingsModalOpen = () => document.querySelector('[data-shortcut-modal="settings"]') !== null
      const accountTrigger = () => document.querySelector('button[aria-haspopup="menu"][data-signed-out]')
      const settingsMenuItem = () => {
        /* Ignore our own overlay: the ring is role="menu" with menuitem sectors
           (one of them even reads "Settings") and lingers ~150ms while its
           closing animation plays, which would otherwise be mistaken for the
           account menu's Settings row. */
        const items = Array.from(document.querySelectorAll('[role="menu"] [role="menuitem"], [role="menu"] button, [role="menu"] [role="option"]'))
          .filter(el => el.closest('[data-drm-layer]') === null)
        const byText = items.find(el => /设置|settings|設定|naстройки|paramètres|einstellungen|ajustes|configura/i.test(el.textContent ?? ''))
        if (byText !== undefined) return byText
        // The account menu holds exactly three rows and Settings is the first.
        return items.length > 0 && items.length <= 4 ? items[0] : undefined
      }
      /** Open the settings panel the way a user does: avatar menu, then its Settings item. */
      const openSettingsPanel = async () => {
        if (settingsModalOpen()) return true
        const trigger = accountTrigger()
        if (trigger === null) return synthesizeSettingsOpen(ctx)
        trigger.click()
        for (let attempt = 0; attempt < 20; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 80))
          const item = settingsMenuItem()
          if (item !== undefined) {
            item.click()
            return true
          }
        }
        return false
      }
      const marketSectionId = () => {
        try {
          for (const entry of ctx.slots.entries('settings.section')) {
            const id = String(entry.options.id ?? '')
            const registrant = String(entry.options.registrant ?? '')
            if (/market/i.test(id) || /market/i.test(registrant)) return id
          }
        } catch {
          /* no ledger yet */
        }
        return undefined
      }
      /** Click one settings panel section row by its ledger id. */
      const selectSettingsSection = async (sectionId) => {
        const row = readSections().find(candidate => candidate.id === sectionId)
        const wanted = row?.label
        const findButton = () => {
          const buttons = Array.from(document.querySelectorAll('[data-shortcut-modal="settings"] nav button'))
          if (wanted !== undefined) {
            const exact = buttons.find(candidate => candidate.textContent?.trim() === wanted)
            if (exact !== undefined) return exact
          }
          return buttons.find(candidate => (candidate.textContent ?? '').includes(wanted ?? sectionId))
        }
        for (let attempt = 0; attempt < 25; attempt++) {
          const button = findButton()
          if (button !== undefined) {
            button.click()
            return
          }
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        throw new Error(`settings section "${sectionId}" not found`)
      }
      const openMarketSection = async () => {
        if (!await openSettingsPanel()) throw new Error('settings panel unavailable')
        const marketId = marketSectionId()
        if (marketId === undefined) throw new Error('market section not registered')
        await selectSettingsSection(marketId)
      }
      return {
        t,
        sections: readSections,
        /** True when `section:<id>` points at a currently registered section. */
        isKnownSection: (id) => id.startsWith(SECTION_PREFIX)
          && readSections().some(row => row.id === id.slice(SECTION_PREFIX.length)),
        /** Section rows already covered by a fixed action: the market section
            duplicates 'plugin-market', so it must not also appear as a sector. */
        isDuplicateOfFixed: (id) => id.startsWith(SECTION_PREFIX) && /market/i.test(id),
        itemLabel,
        itemDescription,
        itemPending: (id) => id.startsWith(SECTION_PREFIX)
          ? t('section.pending').replace('{label}', itemLabel(id))
          : t(`${id}.pending`),
        itemSuccess: (id) => id.startsWith(SECTION_PREFIX)
          ? t('section.success').replace('{label}', itemLabel(id))
          : t(`${id}.success`),
        itemIcon: (id) => {
          if (!id.startsWith(SECTION_PREFIX)) return id
          /* Settings sections expose no icon through any inspectable slot
             (settings.section.icon has no occupants and the shell draws its
             own nav glyph), so recognised plugins get a hand-matched glyph and
             everything else falls back to the neutral gear instead of the
             former star placeholder. */
          const sectionId = id.slice(SECTION_PREFIX.length)
          return SECTION_ICONS[sectionId] ?? 'gear'
        },
        configSnapshot: () => current,
        subscribeConfig: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        saveConfig: async (next) => {
          try {
            const response = await fetch(new URL(CONFIG_ROUTE, hostBase()), {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ version: 2, enabled: true, ...next }),
            })
            if (!response.ok) return false
            await load()
            return true
          } catch {
            return false
          }
        },
        run: async (id, snapshot) => {
          if (id.startsWith(SECTION_PREFIX)) {
            if (!await openSettingsPanel()) throw new Error('settings panel unavailable')
            await selectSettingsSection(id.slice(SECTION_PREFIX.length))
            return
          }
          switch (id) {
            case 'plugin-market':
              await openMarketSection()
              return
            case 'new-session': {
              const workspace = ctx.get?.('uiWorkspace')
              if (workspace === undefined || typeof workspace.startSession !== 'function') throw new Error('workspace navigation unavailable')
              workspace.startSession()
              return
            }
            case 'open-dir': {
              const response = await fetch(new URL(OPEN_DIR_ROUTE, hostBase()), {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ path: snapshot.cwd }),
              })
              if (!response.ok) throw new Error(`open-dir failed: HTTP ${String(response.status)}`)
              return
            }
            case 'copy-cwd':
              await clipboardWrite(snapshot.cwd)
              return
            case 'restart-dsh': {
              const response = await fetch(new URL(RESTART_ROUTE, hostBase()), {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{}',
              })
              if (!response.ok) throw new Error(`restart failed: HTTP ${String(response.status)}`)
              return
            }
            default:
              throw new Error(`unknown action ${id}`)
          }
        },
      }
    }

    return {
      inject: ['slots', 'locale', 'layout', 'shortcuts', 'sessions'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-radial-menu: dictionaries')
        const t = ctx.locale.bind(NS)
        const deps = createDeps(ctx, t)
        ctx.effect(() => {
          let disposeSlot
          const disposeInject = ctx.slots.inject('shell.overlay', () => {
            disposeSlot = ctx.slots.register({
              name: 'shell.overlay',
              id: OVERLAY_ID,
              order: 40,
              inject: () => ({ deps }),
            }, RadialMenu)
            return () => { disposeSlot?.() }
          })
          return () => {
            disposeInject()
            disposeSlot?.()
          }
        }, 'dsh-radial-menu: overlay')
        ctx.effect(() => {
          let disposeSection
          const disposeInject = ctx.slots.inject('settings.section', () => {
            disposeSection = ctx.slots.register({
              name: 'settings.section',
              id: SETTINGS_SECTION_ID,
              order: 480,
              label: () => t('section.label'),
            }, () => h(AstrolabeSettings, { deps }))
            return () => { disposeSection?.() }
          })
          return () => {
            disposeInject()
            disposeSection?.()
          }
        }, 'dsh-radial-menu: settings section')
      },
    }
  },
})
