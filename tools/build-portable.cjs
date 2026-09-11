'use strict'

// Build a self-contained Windows x64 folder from the Electron runtime already
// installed by npm. This intentionally avoids electron-builder/NSIS downloads:
// the resulting folder runs without Node, npm, DSH, or a terminal.
//
// Usage:
//   node tools/build-portable.cjs [output-directory]

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const OUT = path.join(DIST, 'whale-desktop-win')
const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist')
const OUTPUT_DIR = path.resolve(process.argv[2] || DIST)
const ZIP_NAME = 'WhaleDesktop-Windows-x64-portable.zip'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function safeRemove(target) {
  const base = path.resolve(DIST) + path.sep
  const resolved = path.resolve(target)
  assert(resolved.startsWith(base), 'refusing to remove outside dist: ' + resolved)
  fs.rmSync(resolved, { recursive: true, force: true })
}

function copyRuntime() {
  assert(fs.existsSync(path.join(ELECTRON_DIST, 'electron.exe')), 'Electron runtime not found; run npm install first')
  fs.cpSync(ELECTRON_DIST, OUT, {
    recursive: true,
    filter(source) {
      const rel = path.relative(ELECTRON_DIST, source)
      if (!rel) return true
      // Keep the runtime lean but retain the two locales used by this app.
      if (rel.startsWith('locales' + path.sep)) {
        return ['zh-CN.pak', 'en-US.pak', 'en-GB.pak'].includes(path.basename(source))
      }
      return true
    },
  })
  fs.rmSync(path.join(OUT, 'resources', 'default_app.asar'), { force: true })
  fs.renameSync(path.join(OUT, 'electron.exe'), path.join(OUT, 'WhaleDesktop.exe'))
}

function copyApp() {
  const appDir = path.join(OUT, 'resources', 'app')
  fs.mkdirSync(appDir, { recursive: true })
  for (const name of ['src', 'assets']) {
    fs.cpSync(path.join(ROOT, name), path.join(appDir, name), { recursive: true })
  }
  const license = path.join(ROOT, 'LICENSE')
  if (fs.existsSync(license)) fs.copyFileSync(license, path.join(appDir, 'LICENSE'))

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const runtimePackage = {
    name: pkg.name,
    version: pkg.version,
    private: true,
    description: pkg.description,
    main: pkg.main,
  }
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(runtimePackage, null, 2) + '\n', 'utf8')
}

function writeLauncher() {
  const cmd = [
    '@echo off',
    'start "" "%~dp0WhaleDesktop.exe"',
    '',
  ].join('\r\n')
  fs.writeFileSync(path.join(OUT, 'start-whale.cmd'), cmd, 'utf8')
  fs.writeFileSync(path.join(OUT, '启动小鲸鱼.cmd'), cmd, 'utf8')

  const readme = [
    '小鲸鱼余额挂件 · Windows 便携版',
    '',
    '双击「启动小鲸鱼.cmd」（或 start-whale.cmd / WhaleDesktop.exe）即可运行。',
    '第一次运行会自动在 %APPDATA%\\dsh-whale-desktop\\ 创建：',
    '  config.jsonc  主配置',
    '  lines.jsonc   随机台词与权重',
    '  skins\\        皮肤包',
    '',
    '菜单 → 配置文件 / 台词文件 / 皮肤文件夹，可直接打开这些位置。',
    '修改后点「重载配置」即可生效，不需要重新打包。',
    '',
    'API Key 读取顺序：config.jsonc.apiKey → DEEPSEEK_API_KEY → DSH 凭据。',
    '退出请使用托盘菜单或挂件菜单中的「退出」。',
  ].join('\r\n')
  fs.writeFileSync(path.join(OUT, '使用说明.txt'), readme, 'utf8')
}

function makeZip() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  const zip = path.join(OUTPUT_DIR, ZIP_NAME)
  fs.rmSync(zip, { force: true })
  // Windows ships bsdtar, which can create either .zip or .tar.gz and does not
  // depend on the PowerShell archive module being available.
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
  execFileSync(tar, ['-a', '-cf', zip, '-C', OUT, '.'], { stdio: 'inherit' })
  return zip
}

function main() {
  safeRemove(OUT)
  fs.mkdirSync(OUT, { recursive: true })
  copyRuntime()
  copyApp()
  writeLauncher()
  const zip = makeZip()
  console.log('portable app: ' + OUT)
  console.log('portable zip: ' + zip)
}

main()
