'use strict'

// ---------------------------------------------------------------------------
// Where the app keeps its user-editable data.
//
//   %APPDATA%\dsh-whale-desktop\
//     config.jsonc      main settings (lines: 台词文件路径, skin, scale, ...)
//     lines.jsonc       default 台词 + 权重
//     peaks.jsonc       named peak/off-peak wording presets
//     skins\            one directory per 皮肤包
//     .usage.json       小鲸鱼记账账本
//
// Using APPDATA (not the install dir) keeps user data alive across app updates
// and avoids needing admin rights to write next to the exe.
// ---------------------------------------------------------------------------

const path = require('node:path')
const fs = require('node:fs')
const { ensureDir } = require('./lib/jsonc.cjs')

function appDataRoot() {
  const base = process.env.APPDATA || path.join(process.env.USERPROFILE || '.', 'AppData', 'Roaming')
  return path.join(base, 'dsh-whale-desktop')
}

const ROOT = appDataRoot()
const CONFIG_FILE = path.join(ROOT, 'config.jsonc')
const LINES_FILE = path.join(ROOT, 'lines.jsonc')
const PEAKS_FILE = path.join(ROOT, 'peaks.jsonc')
const USAGE_FILE = path.join(ROOT, '.usage.json')
const SKINS_DIR = path.join(ROOT, 'skins')
const LOG_FILE = path.join(ROOT, 'whale.log')

function ensureLayout() {
  ensureDir(ROOT)
  ensureDir(SKINS_DIR)
}

/** Append a line to the app log; never throws. */
function log(...parts) {
  const line = new Date().toISOString() + ' ' + parts.map((p) => {
    if (typeof p === 'string') return p
    try { return JSON.stringify(p) } catch (err) { return String(p) }
  }).join(' ')
  try {
    ensureDir(ROOT)
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf8')
  } catch (err) {}
  if (process.env.WHALE_DEBUG) console.log(line)
}

module.exports = {
  ROOT,
  CONFIG_FILE,
  LINES_FILE,
  PEAKS_FILE,
  USAGE_FILE,
  SKINS_DIR,
  LOG_FILE,
  ensureLayout,
  log,
}
