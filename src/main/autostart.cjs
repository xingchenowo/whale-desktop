'use strict'

// Direct Windows autostart integration. This deliberately does not use
// Electron's login-item API: the registry command points at a compiled exe.
const { execFileSync, execFile } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const VALUE_NAME = 'H1kaRU.WhaleDesktop'
const LEGACY_VALUE_NAMES = ['MeteorNOX.WhaleDesktop']
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

/**
 * 异步版 reg.exe。
 *
 * 同步版（execFileSync）会冻住主进程；第一次开机自启时 reg.exe 冷启动可能慢到
 * 秒级，正好撞上用户右键托盘菜单，任务栏就会转圈假死。菜单相关的路径一律走这里。
 */
// reg.exe 输出是 GBK，直接按 utf8 读会变乱码；这里显式解码一次。
function decodeRegOutput(buf) {
  if (!buf) return ''
  if (typeof buf === 'string') return buf
  try {
    return new TextDecoder('gbk').decode(buf)
  } catch (err) {
    return Buffer.from(buf).toString('utf8')
  }
}

// execFile 的错误里退出码在 err.code（execFileSync 才是 err.status），两个都认。
function regExitCode(err) {
  if (!err) return null
  const code = err.code !== undefined ? err.code : err.status
  return typeof code === 'number' ? code : null
}

function runRegAsync(args) {
  return new Promise((resolve, reject) => {
    execFile(REG_EXE, args, { windowsHide: true, encoding: 'buffer' }, (err, stdout, stderr) => {
      if (err) {
        try {
          err.stderr = decodeRegOutput(stderr) || err.stderr
          err.stdout = decodeRegOutput(stdout)
        } catch (e) {}
        reject(err)
        return
      }
      resolve(decodeRegOutput(stdout))
    })
  })
}

async function queryValueAsync(name) {
  try {
    await runRegAsync(['query', RUN_KEY, '/v', name])
    return { ok: true, enabled: true, error: '' }
  } catch (err) {
    // 值不存在时 reg.exe 返回 1，属于正常情况：没开自启而已
    if (regExitCode(err) === 1) return { ok: true, enabled: false, error: '' }
    return { ok: false, enabled: false, error: errorText(err) }
  }
}

async function deleteValueAsync(name) {
  try {
    await runRegAsync(['delete', RUN_KEY, '/v', name, '/f'])
  } catch (err) {
    // 本来就不存在：同样是返回 1，忽略
    if (regExitCode(err) !== 1) throw err
  }
}

/** getAutostartState 的异步版，语义完全一致。 */
async function getAutostartStateAsync() {
  const exe = executablePath()
  if (process.platform !== 'win32') {
    return { enabled: false, exe, legacy: false, error: '开机自启仅支持 Windows' }
  }
  const current = await queryValueAsync(VALUE_NAME)
  if (!current.ok) return { enabled: false, exe, legacy: false, error: current.error }
  if (current.enabled) return { enabled: true, exe, legacy: false, error: '' }
  for (const name of LEGACY_VALUE_NAMES) {
    const legacy = await queryValueAsync(name)
    if (!legacy.ok) return { enabled: false, exe, legacy: false, error: legacy.error }
    if (legacy.enabled) return { enabled: true, exe, legacy: true, legacyName: name, error: '' }
  }
  return { enabled: false, exe, legacy: false, error: '' }
}

/** setAutostartEnabled 的异步版。 */
async function setAutostartEnabledAsync(enabled) {
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
      await runRegAsync(['add', RUN_KEY, '/v', VALUE_NAME, '/t', 'REG_SZ', '/d', buildRunValue(exe), '/f'])
      for (const name of LEGACY_VALUE_NAMES) await deleteValueAsync(name)
    } else {
      await deleteValueAsync(VALUE_NAME)
      for (const name of LEGACY_VALUE_NAMES) await deleteValueAsync(name)
    }
    return { ok: true, enabled: !!enabled, exe, error: '' }
  } catch (err) {
    return { ok: false, enabled: !!enabled, exe, error: errorText(err) }
  }
}

/** syncAutostartTarget 的异步版（启动时把注册表指向当前 exe）。 */
async function syncAutostartTargetAsync() {
  const state = await getAutostartStateAsync()
  if (!state.enabled) return { ok: true, enabled: false, exe: state.exe, error: '' }
  if (!state.exe) return { ok: false, enabled: true, exe: '', error: '当前无法确定已编译的 WhaleDesktop.exe 路径' }
  const result = await setAutostartEnabledAsync(true)
  if (!result.ok) return result
  return { ...result, migrated: !!state.legacy }
}

function errorText(err) {
  const stderr = err && err.stderr ? String(err.stderr).trim() : ''
  return stderr || (err && err.message) || String(err)
}

function queryValue(name) {
  try {
    runReg(['query', RUN_KEY, '/v', name])
    return { ok: true, enabled: true, error: '' }
  } catch (err) {
    // reg.exe returns 1 when the value or key does not exist.
    if (err && err.status === 1) return { ok: true, enabled: false, error: '' }
    return { ok: false, enabled: false, error: errorText(err) }
  }
}

function deleteValue(name) {
  try {
    runReg(['delete', RUN_KEY, '/v', name, '/f'])
  } catch (err) {
    if (!err || err.status !== 1) throw err
  }
}

function getAutostartState() {
  const exe = executablePath()
  if (process.platform !== 'win32') {
    return { enabled: false, exe, legacy: false, error: '开机自启仅支持 Windows' }
  }
  const current = queryValue(VALUE_NAME)
  if (!current.ok) return { enabled: false, exe, legacy: false, error: current.error }
  if (current.enabled) return { enabled: true, exe, legacy: false, error: '' }
  for (const name of LEGACY_VALUE_NAMES) {
    const legacy = queryValue(name)
    if (!legacy.ok) return { enabled: false, exe, legacy: false, error: legacy.error }
    if (legacy.enabled) return { enabled: true, exe, legacy: true, legacyName: name, error: '' }
  }
  return { enabled: false, exe, legacy: false, error: '' }
}

function syncAutostartTarget() {
  const state = getAutostartState()
  if (!state.enabled) return { ok: true, enabled: false, exe: state.exe, error: '' }
  if (!state.exe) return { ok: false, enabled: true, exe: '', error: '当前无法确定已编译的 WhaleDesktop.exe 路径' }
  const result = setAutostartEnabled(true)
  if (!result.ok) return result
  return { ...result, migrated: !!state.legacy }
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
      for (const name of LEGACY_VALUE_NAMES) deleteValue(name)
    } else {
      deleteValue(VALUE_NAME)
      for (const name of LEGACY_VALUE_NAMES) deleteValue(name)
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
  getAutostartStateAsync,
  setAutostartEnabledAsync,
  syncAutostartTargetAsync,
}
