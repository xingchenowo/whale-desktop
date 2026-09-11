'use strict'

// Screenshot the primary display to verify the pet renders.
// Usage: npx electron tools/screenshot.cjs <outfile.png>

const { app, BrowserWindow, desktopCapturer, screen } = require('electron')
const fs = require('node:fs')

const out = process.argv[2] || 'screenshot.png'

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const display = screen.getPrimaryDisplay()
  const { width, height } = display.size
  const scale = display.scaleFactor || 1
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) },
    })
    if (!sources.length) {
      console.error('no screen sources')
      app.exit(1)
      return
    }
    const img = sources[0].thumbnail
    fs.writeFileSync(out, img.toPNG())
    console.log('wrote ' + out + ' (' + img.getSize().width + 'x' + img.getSize().height + ')')
    app.exit(0)
  } catch (err) {
    console.error('capture failed: ' + String((err && err.message) || err))
    app.exit(1)
  }
})
