'use strict'

// ---------------------------------------------------------------------------
// 皮肤包 (skin packs)
//
// A skin is a directory under %APPDATA%\dsh-whale-desktop\skins\<name>\ :
//
//   skin.jsonc      metadata + geometry + which sounds the pack provides
//   whale.png       cut-out pet image (transparent background)
//   rua.gif         optional, shown by a gif line in the dialogue file
//   sounds\         optional mp3s referenced by skin.jsonc
//
// Geometry is per-skin because a different cut-out has its own transparent
// margins — the original plugin hard-coded these values, which is exactly why
// swapping the image used to misalign the bubble. All size values are ratios of
// the base unit U (= window width / bubble.width), so a skin scales as a whole.
// ---------------------------------------------------------------------------

const fs = require('node:fs')
const path = require('node:path')
const { SKINS_DIR, log } = require('./paths.cjs')
const { readJsonc, deepMerge } = require('./lib/jsonc.cjs')

// Geometry of the bundled default skin. Mirrors the original DSH plugin so the
// desktop pet looks identical out of the box.
const BASE_GEOMETRY = {
  // Cut-out image box, as a ratio of the bubble width.
  img: {
    width: 0.5968,
    height: 0.5968,
    right: 0,
    bottom: 0,
  },
  // The speech balloon. `vbox` is the authoring box of the artwork and defines
  // the aspect ratio; `width` is how wide it is drawn, as a ratio of the skin's
  // base size. 0.7143 here (a 320px balloon for a 448px base) reproduces the
  // original plugin's composition, where the balloon and the pet are the same
  // size and sit side by side — the pet's head stays clickable beside it.
  bubble: {
    width: 0.7143,
    vbox: { w: 1026, h: 700 },
    // Keep the balloon a little to the left of the pet's head.
    left: 0.02,
    // Raise the balloon above its baseline; -0.15 is half again as high as the
    // previous -0.10 placement.
    top: -0.46,
  },
  // Text block inside the bubble. `anchor` picks what topPct refers to:
  //   'top'    -> the block sits below topPct of the bubble height
  //   'center' -> topPct is the block's vertical centre
  // Centre the line block on the main balloon body (the SVG ellipse centre is
  // around x=44.25%, y=35% of the authoring box).
  text: { leftPct: 0.4425, topPct: 0.35, anchor: 'center' },
  // Font sizes, as a ratio of U.
  font: {
    label: 0.0643,
    amount: 0.1248,
    period: 0.1014,
    hint: 0.0546,
  },
  wrapMax: 0.5458,
  // GIF shown by a `{ "gif": true }` line group: centre + max size in the bubble.
  gif: { leftPct: 0.4425, topPct: 0.44, maxW: 0.5458, maxH: 0.3899 },
  // Hover menu button. topRatio is a fraction of the content height; measured
  // against the pet's own box so it sits at the pet's upper corner.
  menuBtn: { topRatio: 0.4055, right: 4, size: 30 },
  // Window padding around the bubble+pet union, in px at scale 1.
  windowPadding: 16,
}

const BASE_META = {
  name: 'default',
  displayName: '默认 · 小鲸鱼',
  description: '原版 DSH 插件的小鲸鱼与气泡几何',
  author: '',
  sounds: {
    duck: {
      label: '小黄鸭',
      press: 'sounds/Ya1.mp3',
      release: 'sounds/Ya2.mp3',
    },
    fx1: {
      label: '音效1',
      press: 'sounds/D1.mp3',
      release: 'sounds/D2.mp3',
    },
  },
}

function loadSkinDir(dirName) {
  const dir = path.join(SKINS_DIR, dirName)
  const metaRes = readJsonc(path.join(dir, 'skin.jsonc'))
  if (metaRes.missing) return null
  if (metaRes.error) {
    log('skin.jsonc parse error', dirName, metaRes.error)
    return null
  }
  const raw = metaRes.value && typeof metaRes.value === 'object' ? metaRes.value : {}
  const meta = deepMerge(BASE_META, raw)
  const geometry = deepMerge(BASE_GEOMETRY, raw.geometry || {})

  // Resolve the pet image: explicit `image`, else the first matching default name.
  let imagePath = ''
  if (typeof meta.image === 'string' && meta.image.trim()) {
    imagePath = path.join(dir, meta.image.trim())
  } else {
    for (const cand of ['whale.png', 'whale.gif', 'DSniang1.png', 'DSniang02.png']) {
      const p = path.join(dir, cand)
      if (fs.existsSync(p)) { imagePath = p; break }
    }
  }
  if (!imagePath || !fs.existsSync(imagePath)) {
    log('skin has no usable image', dirName, imagePath)
    return null
  }

  // Resolve optional gif.
  let gifPath = ''
  if (typeof meta.gif === 'string' && meta.gif.trim()) {
    const p = path.join(dir, meta.gif.trim())
    if (fs.existsSync(p)) gifPath = p
  } else {
    const p = path.join(dir, 'rua.gif')
    if (fs.existsSync(p)) gifPath = p
  }

  // Resolve sounds: keep only the sets whose files exist.
  const sounds = {}
  for (const [key, def] of Object.entries(meta.sounds || {})) {
    if (!def || typeof def !== 'object') continue
    const press = def.press ? path.join(dir, String(def.press)) : ''
    const release = def.release ? path.join(dir, String(def.release)) : ''
    if (press && fs.existsSync(press)) {
      sounds[key] = {
        label: String(def.label || key),
        press,
        release: release && fs.existsSync(release) ? release : '',
      }
    }
  }

  return {
    name: dirName,
    dir,
    displayName: String(meta.displayName || dirName),
    description: String(meta.description || ''),
    author: String(meta.author || ''),
    imagePath,
    gifPath,
    sounds,
    geometry,
  }
}

/** All loadable skins, default first. */
function listSkins() {
  let entries = []
  try {
    entries = fs.readdirSync(SKINS_DIR, { withFileTypes: true })
  } catch (err) {
    return []
  }
  const skins = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const skin = loadSkinDir(e.name)
    if (skin) skins.push(skin)
  }
  skins.sort((a, b) => {
    if (a.name === 'default') return -1
    if (b.name === 'default') return 1
    return a.name.localeCompare(b.name)
  })
  return skins
}

function loadSkin(name) {
  const wanted = String(name || 'default')
  const direct = loadSkinDir(wanted)
  if (direct) return direct
  if (wanted !== 'default') log('skin not found, falling back to default:', wanted)
  const fallback = loadSkinDir('default')
  if (fallback) return fallback
  const all = listSkins()
  return all[0] || null
}

module.exports = { BASE_GEOMETRY, BASE_META, listSkins, loadSkin, SKINS_DIR }
