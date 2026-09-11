'use strict'

// ---------------------------------------------------------------------------
// One-off helper: derive a small square tray icon from the bundled art.
// Run with: node tools/make-tray-icon.cjs
// Writes assets/tray.png. Safe to re-run; does nothing it cannot do.
// ---------------------------------------------------------------------------

const fs = require('node:fs')
const path = require('node:path')

const PACKAGE_ROOT = path.resolve(__dirname, '..')

async function main() {
  let electron
  try {
    electron = require('electron')
  } catch (err) {
    console.error('This helper must run under Electron. Use: npx electron tools/make-tray-icon.cjs')
    process.exit(1)
  }
  const nativeImage = electron.nativeImage
  if (!nativeImage || !electron.app) {
    console.error('This helper must run under Electron. Use: npx electron tools/make-tray-icon.cjs')
    process.exit(1)
  }
  const src = path.join(PACKAGE_ROOT, 'assets', 'DSniang1.png')
  if (!fs.existsSync(src)) {
    console.error('missing', src)
    process.exit(1)
  }
  const img = nativeImage.createFromPath(src)
  if (img.isEmpty()) {
    console.error('could not decode', src)
    process.exit(1)
  }
  const out = path.join(PACKAGE_ROOT, 'assets', 'tray.png')
  fs.writeFileSync(out, img.resize({ width: 32, height: 32, quality: 'best' }).toPNG())
  console.log('wrote', out)
}

main().then(() => {
  require('electron').app.exit(0)
}).catch((err) => {
  console.error(err)
  require('electron').app.exit(1)
})
