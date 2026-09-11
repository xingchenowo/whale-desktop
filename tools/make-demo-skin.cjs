'use strict'

// Create a demo skin that proves per-skin geometry works: same art, different
// image box and text anchor. Usage: node tools/make-demo-skin.cjs

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'dsh-whale-desktop')
const src = path.join(ROOT, 'skins', 'default')
const dst = path.join(ROOT, 'skins', 'demo-small')

if (!fs.existsSync(path.join(src, 'skin.jsonc'))) {
  console.error('default skin not found; run the app once first')
  process.exit(1)
}

fs.rmSync(dst, { recursive: true, force: true })
fs.mkdirSync(dst, { recursive: true })
for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
  const from = path.join(src, entry.name)
  const to = path.join(dst, entry.name)
  if (entry.isDirectory()) fs.cpSync(from, to, { recursive: true })
  else if (entry.name !== 'skin.jsonc') fs.copyFileSync(from, to)
}

const meta = {
  _README: [
    '演示皮肤：立绘缩小并右移、文字下移，用来直观验证 geometry 参数真的生效。',
    '对比 layers：切换到本皮肤后窗口会自动变小（因为内容变小），这就是按皮肤几何自适应尺寸。',
  ],
  name: 'demo-small',
  displayName: '演示 · 小尺寸立绘',
  description: '演示皮肤：把立绘改小并右移，文字下移，验证 geometry 生效',
  author: 'whale-desktop',
  image: 'whale.png',
  gif: 'rua.gif',
  sounds: {
    duck: { label: '小黄鸭', press: 'sounds/Ya1.mp3', release: 'sounds/Ya2.mp3' },
    fx1: { label: '音效1', press: 'sounds/D1.mp3', release: 'sounds/D2.mp3' },
  },
  geometry: {
    img: { width: 0.42, height: 0.42, right: 0.06, bottom: -0.04 },
    text: { leftPct: 0.4425, topPct: 0.35, anchor: 'center' },
  },
}

fs.writeFileSync(path.join(dst, 'skin.jsonc'), JSON.stringify(meta, null, 2) + '\n', 'utf8')
console.log('created ' + dst)
