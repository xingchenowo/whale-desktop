'use strict'

// ---------------------------------------------------------------------------
// Main configuration: defaults + load from %APPDATA%\dsh-whale-desktop\config.jsonc
//
// Everything user-tunable lives here. Missing keys fall back to DEFAULTS, and
// the loader records an `error` when the file is malformed so the UI can warn
// instead of silently reverting.
// ---------------------------------------------------------------------------

const path = require('node:path')
const { readJsonc, deepMerge, expandHome } = require('./lib/jsonc.cjs')
const { CONFIG_FILE, LINES_FILE, ROOT } = require('./paths.cjs')

const DEFAULTS = {
  // --- appearance -----------------------------------------------------------
  // Name of a directory under skins\. See skins\default\skin.jsonc.
  skin: 'default',
  // Overall pet size multiplier. The whole desktop window scales with this, so
  // larger values do not clip the bubble.
  scale: 1.4,
  // Where the pet snaps to on launch. h: left|right, v: top|bottom.
  anchor: { h: 'right', v: 'bottom', hDist: 40, vDist: 60 },
  // Keep above normal windows.
  alwaysOnTop: true,

  // --- 台词 (random dialogue) ----------------------------------------------
  // Path to the dialogue file. Relative paths resolve against the config dir.
  linesFile: 'lines.jsonc',
  // Clicking the bubble switches to a random line; clicking again closes it.
  randomLines: true,
  // Allow the pet bubble to be shown at all.
  bubbleOn: true,
  // How long the bubble stays open, in milliseconds.
  bubbleMs: 5000,
  // What the speech bubble shows by default:
  // 'balance' | 'time' | 'keyboard'
  displayMode: 'balance',
  // In keyboard mode, clicking the pet shows this content.
  // 'balance' | 'time'
  keyboardClickMode: 'balance',

  // --- 用量 / 余额 ----------------------------------------------------------
  // 'ledger' = 小鲸鱼记账 (balance-difference bookkeeping, no token needed)
  // 'token'  = 实时·令牌 (needs DEEPSEEK_PLATFORM_TOKEN, exact per-hour usage)
  usageMode: 'ledger',
  // DeepSeek API key. Leave empty to read the DEEPSEEK_API_KEY environment
  // variable, or the key configured in DSH (~/.dsh/.credentials.yaml).
  apiKey: '',
  // Optional DeepSeek platform session token for 'token' usage mode.
  platformToken: '',
  // Balance refresh interval, milliseconds.
  refreshMs: 60000,
  // Display currency preference: '' = auto (CNY first, then any positive).
  currency: '',

  // --- 区域文案 -------------------------------------------------------------
  // Selected preset id from the independent peaks.jsonc file.
  peakPreset: 'default',

  // --- 声音 -----------------------------------------------------------------
  sound: true,
  volume: 0.9,
  // Sound set inside the active skin: 'duck' | 'fx1' | any key defined by the skin.
  soundSet: 'duck',

  // --- 窗口行为 -------------------------------------------------------------
  // Allow the pet to be dragged with the left mouse button.
  draggable: true,
  // Pass mouse clicks through to the window underneath when not hovering the pet.
  passthrough: true,
  // Show the hamburger menu button on hover.
  showMenuButton: true,
}

function loadConfig() {
  const res = readJsonc(CONFIG_FILE)
  if (res.missing) return { config: { ...DEFAULTS }, user: {}, error: null, created: false }
  if (res.error) return { config: { ...DEFAULTS }, user: {}, error: 'config.jsonc 语法错误: ' + res.error, created: false }
  const raw = res.value && typeof res.value === 'object' ? res.value : {}
  const clean = { ...raw }
  if (clean.peakPreset === undefined && typeof raw.peakMode === 'string') {
    clean.peakPreset = raw.peakMode === 'custom' ? 'legacy-custom' : raw.peakMode
  }
  return { config: deepMerge(DEFAULTS, clean), user: clean, error: null, created: true }
}

/** Resolve the dialogue file path (absolute, ~ expanded, relative to config dir). */
function resolveLinesFile(config) {
  const raw = expandHome(String(config.linesFile || 'lines.jsonc'))
  if (path.isAbsolute(raw)) return raw
  return path.join(ROOT, raw)
}

module.exports = { DEFAULTS, CONFIG_FILE, LINES_FILE, loadConfig, resolveLinesFile }
