'use strict'

// Inspect a file's raw encoding state: BOM, invalid UTF-8, first bytes.
// Usage: node tools/check-encoding.cjs <file> [...]

const fs = require('node:fs')

for (const file of process.argv.slice(2)) {
  const buf = fs.readFileSync(file)
  const bomUtf8 = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
  const bomUtf16 = buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe
  const text = buf.toString('utf8')
  const roundTrip = Buffer.from(text, 'utf8').equals(buf)
  console.log('--- ' + file)
  console.log('  bytes=' + buf.length + ' utf8BOM=' + bomUtf8 + ' utf16BOM=' + bomUtf16 + ' validUtf8=' + roundTrip)
  console.log('  first bytes: ' + buf.subarray(0, 12).toString('hex'))
  const firstLine = text.split(/\r?\n/)[0]
  console.log('  first line: ' + JSON.stringify(firstLine.slice(0, 80)))
}
