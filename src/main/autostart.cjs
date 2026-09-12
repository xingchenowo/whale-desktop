'use strict'

// Direct Windows autostart integration. This deliberately does not use
// Electron's login-item API: the registry command points at a compiled exe.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const VALUE_NAME = 'MeteorNOX.WhaleDesktop'
const REG_EXE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe')

function executablePath() {
  const portable = process.env.PORTABLE_EXECUTABLE_FILE
  if (portable) {
    const resolved = path.resolve(portable)
    if (/\.exe$/i.test(resolved) && fs.existsSync(resolved)) return resolved
  }
  // "electron ." is a development launch; never register the Electron dev binary.
  if (process.defaultApp) return ''
  const exe = process.execPath
  return exe && /\.exe$/i.test(exe) ? exe : ''
}

function quoteWindowsArg(value) {
  return '"' + String(value).replace(/"/g, '""') + '"'
}

function buildRunValue(exePath) {
  if (!exePath) throw new Error('未找到已编译的 WhaleDesktop.exe')
  return quoteWindowsArg(exePath) + ' --autostart'
}

function runReg(args) {
  return execFileSync(REG_EXE, args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function errorText(err) {
  const stderr = err && err.stderr ? String(err.stderr).trim() : ''
  return stderr || (err && err.message) || String(err)
}

function getAutostartState() {
  const exe = executablePath()
  if (process.platform !== 'win32') {
    return { enabled: false, exe, error: '开机自启仅支持 Windows' }
  }
  try {
    runReg(['query', RUN_KEY, '/v', VALUE_NAME])
    return { enabled: true, exe, error: '' }
  } catch (err) {
    // reg.exe returns 1 when the value or key does not exist.
    if (err && err.status === 1) return { enabled: false, exe, error: '' }
    return { enabled: false, exe, error: errorText(err) }
  }
}

function syncAutostartTarget() {
  const state = getAutostartState()
  if (!state.enabled) return { ok: true, enabled: false, exe: state.exe, error: '' }
  if (!state.exe) return { ok: false, enabled: true, exe: '', error: '当前无法确定已编译的 WhaleDesktop.exe 路径' }
  return setAutostartEnabled(true)
}

function setAutostartEnabled(enabled) {
  if (process.platform !== 'win32') {
    return { ok: false, enabled: false, error: '开机自启仅支持 Windows' }
  }
  const exe = executablePath()
  if (!exe) {
    return {
      ok: false,
      enabled: false,
      error: '当前是开发模式；请使用已编译的便携版或安装版设置开机自启。',
    }
  }
  try {
    if (enabled) {
      runReg(['add', RUN_KEY, '/v', VALUE_NAME, '/t', 'REG_SZ', '/d', buildRunValue(exe), '/f'])
    } else {
      try {
        runReg(['delete', RUN_KEY, '/v', VALUE_NAME, '/f'])
      } catch (err) {
        // Deleting an already-absent value is a successful "disabled" state.
        if (!err || err.status !== 1) throw err
      }
    }
    return { ok: true, enabled: !!enabled, exe, error: '' }
  } catch (err) {
    return { ok: false, enabled: !!enabled, exe, error: errorText(err) }
  }
}

module.exports = {
  RUN_KEY,
  VALUE_NAME,
  executablePath,
  buildRunValue,
  getAutostartState,
  setAutostartEnabled,
  syncAutostartTarget,
}
