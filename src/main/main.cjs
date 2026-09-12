'use strict'

// ---------------------------------------------------------------------------
// whale-desktop — main process
//
// Responsibilities:
//   * one transparent, frameless, always-on-top window holding the pet
//   * window sizing/positioning driven by the renderer (scale + skin geometry)
//   * click-through outside the pet body, native drag while grabbing the pet
//   * balance polling + 小鲸鱼记账 ledger
//   * config / dialogue / skin file loading and hot reload
//   * tray icon and context menu
// ---------------------------------------------------------------------------

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, shell, nativeImage, dialog } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const paths = require('./paths.cjs')
const { loadConfig, DEFAULTS, resolveLinesFile } = require('./config.cjs')
const { loadLines, pickRandom, DEFAULT_LINES } = require('./lines.cjs')
const { listSkins, loadSkin } = require('./skins.cjs')
const { loadPeaks, findPeakPreset, PEAKS_FILE } = require('./peaks.cjs')
const { fetchBalance, fetchPlatformUsage, isPeakTime } = require('./balance.cjs')
const { readLedger, recordUsage, readTodayUsage } = require('./ledger.cjs')
const { apiKey, platformToken } = require('./credentials.cjs')
const { startKeyboardHook, stopKeyboardHook, isKeyboardHookRunning } = require('./keyboard.cjs')
const { readJsonc, deepMerge, writeJsonAtomic } = require('./lib/jsonc.cjs')
const { getAutostartState, setAutostartEnabled, syncAutostartTarget } = require('./autostart.cjs')

app.setAppUserModelId('MeteorNOX.WhaleDesktop')

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..')
const BALANCE_TTL_MS = 25000

// --- headless verification mode --------------------------------------------
// `electron . --verify-shot <out.png> [--click] [--wait-ms N]` boots the app,
// optionally clicks the pet to open the bubble, writes a PNG of the window and
// exits. Used to verify rendering without a human looking at the screen.
const VERIFY_SHOT = (() => {
  const i = process.argv.indexOf('--verify-shot')
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : ''
})()
const VERIFY_CLICK = process.argv.includes('--click')
const VERIFY_MENU = process.argv.includes('--menu')
const VERIFY_DRAG = process.argv.includes('--drag')
const VERIFY_NATURAL = process.argv.includes('--natural')
const VERIFY_RANDOM = (() => {
  const i = process.argv.indexOf('--random')
  return i !== -1 ? Math.max(1, Number(process.argv[i + 1]) || 5) : 0
})()
const VERIFY_SKIN = (() => {
  const i = process.argv.indexOf('--skin')
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : ''
})()
const VERIFY_BOOT_MS = (() => {
  const i = process.argv.indexOf('--wait-ms')
  return i !== -1 ? Math.max(500, Number(process.argv[i + 1]) || 4000) : 4000
})()

// --- natural interaction harness -------------------------------------------
//
// Drives the pet the way a user does: the OS cursor is moved with
// screen.getCursorScreenPoint-compatible semantics via webContents.sendInputEvent,
// then real mouseDown / mouseUp are delivered. Unlike calling the debug hooks this
// exercises the actual gesture plumbing — hit testing, the drag threshold, the
// main-process cursor-follow loop and the snap.
async function naturalDrag(from, to, steps) {
  const n = Math.max(1, steps || 10)
  for (let i = 1; i <= n; i++) {
    const x = Math.round(from.x + (to.x - from.x) * (i / n))
    const y = Math.round(from.y + (to.y - from.y) * (i / n))
    win.webContents.sendInputEvent({ type: 'mouseMove', x, y })
    await new Promise((r) => setTimeout(r, 45))
  }
}

async function verifyNaturalInteraction() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  function pointInWindow(fx, fy) {
    const b = win.getBounds()
    return { x: Math.round(b.width * fx), y: Math.round(b.height * fy) }
  }
  const state = () => win.webContents.executeJavaScript('JSON.stringify(window.__whaleDebug.state())')
    .then((s) => JSON.parse(s)).catch(() => null)
  const trace = () => win.webContents.executeJavaScript('JSON.stringify(window.__whaleDebug.trace())')
    .then((s) => JSON.parse(s)).catch(() => [])
  const probe = (x, y) => win.webContents.executeJavaScript(
    'JSON.stringify(window.__whaleDebug.probe(' + Math.round(x) + ',' + Math.round(y) + '))'
  ).then((s) => JSON.parse(s)).catch(() => null)

  // 1. Click the pet body -> the bubble must open through the real event path.
  // Note: sendInputEvent coordinates are window CSS pixels, while getBounds() is
  // in DIP — on a scaled display they differ, so the click point is derived from
  // the renderer's own geometry rather than from the window rect.
  await win.webContents.executeJavaScript('window.__whaleDebug.clearTrace()').catch(() => {})
  const body = await win.webContents.executeJavaScript('JSON.stringify(window.__whaleDebug.petGrabPoint())')
    .then((s) => JSON.parse(s)).catch(() => null)
  if (!body) { paths.log('verify natural: cannot resolve a pet grab point'); return }
  paths.log('verify natural: grab point=' + JSON.stringify(body))
  const at1 = await win.webContents.executeJavaScript(
    'JSON.stringify(window.__whaleDebug.at(' + body.x + ',' + body.y + '))'
  ).catch(() => 'ERR')
  paths.log('verify natural: point detail=' + at1)
  win.webContents.sendInputEvent({ type: 'mouseMove', x: body.x, y: body.y })
  await sleep(300)
  win.webContents.sendInputEvent({ type: 'mouseDown', x: body.x, y: body.y, button: 'left', clickCount: 1 })
  await sleep(80)
  win.webContents.sendInputEvent({ type: 'mouseUp', x: body.x, y: body.y, button: 'left', clickCount: 1 })
  await sleep(700)
  const afterClick = await state()
  paths.log('verify natural: click -> bubbleShown=' + (afterClick && afterClick.bubbleShown))
  paths.log('verify natural: body probe=' + JSON.stringify(await probe(body.x, body.y)))

  // 2. Click a genuinely painted part of the balloon: first click switches to
  // random dialogue, the next click closes it. This catches the missing
  // bubble click listener that a coordinate-only test once missed.
  await win.webContents.executeJavaScript('window.__whaleDebug.clearTrace()').catch(() => {})
  const bubblePoint = await win.webContents.executeJavaScript(
    'JSON.stringify(window.__whaleDebug.bubblePoint())'
  ).then(JSON.parse).catch(() => null)
  const bubbleStates = []
  if (bubblePoint) {
    for (let i = 0; i < 2; i++) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: bubblePoint.x, y: bubblePoint.y })
      await sleep(120)
      win.webContents.sendInputEvent({ type: 'mouseDown', x: bubblePoint.x, y: bubblePoint.y, button: 'left', clickCount: 1 })
      await sleep(80)
      win.webContents.sendInputEvent({ type: 'mouseUp', x: bubblePoint.x, y: bubblePoint.y, button: 'left', clickCount: 1 })
      await sleep(450)
      bubbleStates.push(await state())
    }
  }
  paths.log('verify natural: bubble clicks -> states=' + JSON.stringify(bubbleStates) +
    ' point=' + JSON.stringify(bubblePoint) +
    ' trace=' + JSON.stringify(await trace()))

  // 3. Open the menu with the hamburger, then click it again to dismiss.
  const before = win.getBounds()
  const btn = await win.webContents.executeJavaScript(
    'JSON.stringify(window.__whaleDebug.buttonCenter())'
  ).then(JSON.parse).catch(() => null)
  if (btn) {
    win.webContents.sendInputEvent({ type: 'mouseMove', x: btn.x, y: btn.y })
    await sleep(300)
    win.webContents.sendInputEvent({ type: 'mouseDown', x: btn.x, y: btn.y, button: 'left', clickCount: 1 })
    await sleep(80)
    win.webContents.sendInputEvent({ type: 'mouseUp', x: btn.x, y: btn.y, button: 'left', clickCount: 1 })
    await sleep(600)
    const opened = await state()
    paths.log('verify natural: hamburger -> menuOpen=' + (opened && opened.menuOpen))
    win.webContents.sendInputEvent({ type: 'mouseDown', x: btn.x, y: btn.y, button: 'left', clickCount: 1 })
    await sleep(80)
    win.webContents.sendInputEvent({ type: 'mouseUp', x: btn.x, y: btn.y, button: 'left', clickCount: 1 })
    await sleep(600)
    const closed = await state()
    paths.log('verify natural: hamburger again -> menuOpen=' + (closed && closed.menuOpen))
  } else {
    paths.log('verify natural: could not resolve hamburger centre')
  }

  // 4. Drag the pet with real events; the window must follow and stay on screen.
  const dragFrom = await win.webContents.executeJavaScript('JSON.stringify(window.__whaleDebug.petCenter())')
    .then((s) => JSON.parse(s)).catch(() => null)
  if (!dragFrom) { paths.log('verify natural: cannot resolve pet centre for drag'); return }
  // Fixed cursor-space anchor: the window moves under the cursor while dragging,
  // so the grab point must be computed once.
  const anchor = { x: before.x + dragFrom.x, y: before.y + dragFrom.y }
  const target = { x: anchor.x - 220, y: anchor.y - 140 }
  const cur = screen.getCursorScreenPoint()
  // The cursor must actually be over the grab point before the drag loop starts
  // following it, so the window does not jump on the first poll.
  await naturalDrag(cur, anchor, 4)
  win.webContents.sendInputEvent({ type: 'mouseMove', x: dragFrom.x, y: dragFrom.y })
  await sleep(200)
  win.webContents.sendInputEvent({ type: 'mouseDown', x: dragFrom.x, y: dragFrom.y, button: 'left', clickCount: 1 })
  await sleep(150)
  await naturalDrag(anchor, target, 12)
  await sleep(300)
  const during = win.getBounds()
  win.webContents.sendInputEvent({ type: 'mouseUp', x: dragFrom.x, y: dragFrom.y, button: 'left', clickCount: 1 })
  await sleep(700)
  const afterDrag = win.getBounds()
  const display = screen.getDisplayMatching(afterDrag)
  const wa = display.workArea
  const inside = afterDrag.x >= wa.x - 1 && afterDrag.y >= wa.y - 1 &&
    afterDrag.x + afterDrag.width <= wa.x + wa.width + 1 &&
    afterDrag.y + afterDrag.height <= wa.y + wa.height + 1
  paths.log('verify natural: drag from=' + JSON.stringify(before) +
    ' during=' + JSON.stringify(during) +
    ' after=' + JSON.stringify(afterDrag) +
    ' moved=' + (during.x !== before.x || during.y !== before.y) +
    ' insideWorkArea=' + inside)

  // 5. Lock must make the pet click-through while the lock icon remains usable.
  await win.webContents.executeJavaScript('window.__whaleDebug.close()').catch(() => {})
  win.webContents.sendInputEvent({ type: 'mouseMove', x: body.x, y: body.y })
  await sleep(350)
  const lock = await win.webContents.executeJavaScript('JSON.stringify(window.__whaleDebug.lockCenter())')
    .then((s) => JSON.parse(s)).catch(() => null)
  if (lock) {
    const clickAt = async (p) => {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y })
      await sleep(120)
      win.webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 })
      await sleep(80)
      win.webContents.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 })
      await sleep(450)
    }
    await clickAt(lock)
    const locked = await state()
    await clickAt(body)
    const whileLocked = await state()
    await clickAt(lock)
    const unlocked = await state()
    paths.log('verify natural: lock -> locked=' + (locked && locked.locked) +
      ' bodyClickOpenedBubble=' + (whileLocked && whileLocked.bubbleShown) +
      ' passthrough=' + (whileLocked && whileLocked.passthroughActive) +
      ' unlocked=' + !(unlocked && unlocked.locked))
  } else {
    paths.log('verify natural: could not resolve lock centre')
  }
}

async function runVerifyShot() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  try {
    // Wait for the renderer to finish its bootstrap.
    for (let i = 0; i < 30; i++) {
      const ready = await win.webContents.executeJavaScript('!!(window.__whaleDebug)').catch(() => false)
      if (ready) break
      await sleep(300)
    }
    if (VERIFY_SKIN) {
      const r = await win.webContents.executeJavaScript(
        'window.whale.setConfig({ skin: ' + JSON.stringify(VERIFY_SKIN) + ' })' +
        '.then(() => window.__whaleDebug.state())'
      ).catch((err) => 'ERR ' + err)
      paths.log('verify skin switch:', JSON.stringify(r))
      await sleep(1200)
    }
    if (VERIFY_CLICK) {
      await win.webContents.executeJavaScript('window.__whaleDebug.open()').catch(() => {})
      await sleep(1400)
    }
    if (VERIFY_RANDOM) {
      // Walk the weighted dialogue picker so every group gets exercised. Each
      // pick re-opens the bubble, because clicking twice closes it.
      const seen = []
      for (let i = 0; i < VERIFY_RANDOM; i++) {
        const one = await win.webContents.executeJavaScript(
          '(function(){ window.__whaleDebug.close(); window.__whaleDebug.open(); })();' +
          'new Promise(r => setTimeout(() => { window.__whaleDebug.random(); ' +
          'setTimeout(() => r(window.__whaleDebug.state().lines), 200) }, 600))'
        ).catch((err) => ['ERR ' + err])
        seen.push(one)
      }
      paths.log('verify random picks:', JSON.stringify(seen))
      await sleep(600)
    }
    if (VERIFY_MENU) {
      await win.webContents.executeJavaScript('window.__whaleDebug.openMenu()').catch(() => {})
      await sleep(900)
    }
    if (VERIFY_DRAG) {
      // Exercise the cursor-following drag: grab the pet, let the poll loop move
      // the window to the cursor, release, and confirm the snap kept it on screen.
      const before = win.getBounds()
      const cursor = screen.getCursorScreenPoint()
      paths.log('verify drag: before=' + JSON.stringify(before) + ' cursor=' + JSON.stringify(cursor))
      // Grab point inside the pet's cut-out (lower-right of the window).
      const grab = { x: Math.round(before.width * 0.75), y: Math.round(before.height * 0.8) }
      win.webContents.sendInputEvent({ type: 'mouseMove', x: grab.x, y: grab.y })
      await sleep(300)
      await win.webContents.executeJavaScript(
        'window.whale.dragBegin(' + JSON.stringify(grab) + ')'
      ).catch((err) => paths.log('drag begin failed', String(err)))
      await sleep(900)
      const during = win.getBounds()
      paths.log('verify drag: during=' + JSON.stringify(during) +
        ' moved=' + (during.x !== before.x || during.y !== before.y))
      await win.webContents.executeJavaScript('window.whale.dragEnd()').catch(() => {})
      await sleep(700)
      const after = win.getBounds()
      const displays = screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, workArea: d.workArea }))
      const display = screen.getDisplayMatching(after)
      const wa = display.workArea
      const inside = after.x >= wa.x - 1 && after.y >= wa.y - 1 &&
        after.x + after.width <= wa.x + wa.width + 1 &&
        after.y + after.height <= wa.y + wa.height + 1
      paths.log('verify drag: after=' + JSON.stringify(after) + ' insideWorkArea=' + inside)
      paths.log('verify drag: workArea=' + JSON.stringify(wa) + ' displays=' + JSON.stringify(displays))
      paths.log('verify drag: saved state=' + JSON.stringify(getState()))
    }
    if (VERIFY_NATURAL) {
      await verifyNaturalInteraction()
    }
    const info = await win.webContents.executeJavaScript('JSON.stringify(window.__whaleDebug.state())').catch((err) => 'ERR ' + err)
    paths.log('verify state:', info)
    if (String(info).startsWith('ERR')) {
      const body = await win.webContents.executeJavaScript('document.body ? document.body.innerText.slice(0, 600) : "no body"').catch(() => 'n/a')
      paths.log('verify body:', body)
    }
    const img = await win.capturePage()
    fs.writeFileSync(VERIFY_SHOT, img.toPNG())
    paths.log('verify shot written', VERIFY_SHOT, img.getSize().width + 'x' + img.getSize().height)
  } catch (err) {
    paths.log('verify shot failed', String((err && err.message) || err))
  }
  quitting = true
  app.exit(0)
}

let win = null
let tray = null
let configResult = { config: { ...DEFAULTS }, user: {}, error: null }
let linesResult = null
let peaksResult = null
let currentSkin = null
let balanceCache = null
let balanceCacheAt = 0
let balanceInFlight = null
let refreshTimer = null
let lastGoodBalance = null
let quitting = false
let dragging = false
let dragOffset = { x: 0, y: 0 }
let dragTimer = null
let dragCursor = { x: 0, y: 0 }
let dragStillSince = 0
let keyboardError = null

// --- config / lines / skins -------------------------------------------------

function reloadConfig() {
  configResult = loadConfig()
  if (configResult.error) paths.log('config error:', configResult.error)
  return configResult.config
}

function reloadLines() {
  linesResult = loadLines(configResult.config)
  if (linesResult.error) paths.log('lines error:', linesResult.error)
  return linesResult
}

function reloadPeaks() {
  peaksResult = loadPeaks(config())
  if (peaksResult.error) paths.log('peaks error:', peaksResult.error)
  return peaksResult
}

/** Ensure configResult.user exists even if it was built before this field. */
function userConfig() {
  if (!configResult.user || typeof configResult.user !== 'object') configResult.user = {}
  return configResult.user
}

function reloadSkin() {
  const cfg = configResult.config
  currentSkin = loadSkin(cfg.skin)
  if (!currentSkin) paths.log('no skin could be loaded')
  return currentSkin
}

function config() {
  return configResult.config
}

/** Renderer bootstrap payload. */
function statePayload() {
  return {
    config: config(),
    configError: configResult.error,
    configFile: paths.CONFIG_FILE,
    linesFile: linesResult ? linesResult.file : '',
    linesError: linesResult ? linesResult.error : null,
    groups: linesResult ? linesResult.groups : [],
    peaksFile: peaksResult ? peaksResult.file : PEAKS_FILE,
    peaksError: peaksResult ? peaksResult.error : null,
    peakPresets: peaksResult ? peaksResult.presets : [],
    skin: currentSkin ? skinPayload(currentSkin) : null,
    skins: listSkins().map((s) => ({ name: s.name, displayName: s.displayName, description: s.description })),
    hasApiKey: !!apiKey(config()).value,
    keySource: apiKey(config()).source,
    hasPlatformToken: !!platformToken(config()).value,
    isPeak: isPeakTime(Math.floor(Date.now() / 1000)),
    displayMode: config().displayMode,
    keyboardClickMode: config().keyboardClickMode,
    keyboardError,
    keyboardHookRunning: isKeyboardHookRunning(),
  }
}

function skinPayload(skin) {
  return {
    name: skin.name,
    displayName: skin.displayName,
    description: skin.description,
    geometry: skin.geometry,
    imageUrl: fileUrl(skin.imagePath),
    gifUrl: skin.gifPath ? fileUrl(skin.gifPath) : '',
    sounds: Object.fromEntries(
      Object.entries(skin.sounds || {}).map(([key, def]) => [
        key,
        { label: def.label, press: def.press ? fileUrl(def.press) : '', release: def.release ? fileUrl(def.release) : '' },
      ])
    ),
  }
}

function fileUrl(file) {
  if (!file) return ''
  return 'whale-asset://local/' + encodeURIComponent(path.basename(file)) + '?p=' + encodeURIComponent(file)
}

/**
 * Merge a patch into the live config and persist it.
 *
 * Only the keys the user actually set are tracked in `configResult.user`, and
 * only those are written back. Writing the fully-merged config instead would
 * dump every default into the file and wipe the user's own comments on the very
 * first menu toggle.
 */
function updateConfig(patch) {
  if (!patch || typeof patch !== 'object') return config()
  configResult = {
    config: deepMerge(configResult.config, patch),
    user: deepMerge(userConfig(), patch),
    error: null,
  }
  try {
    writeConfigFile(userConfig())
  } catch (err) {
    paths.log('failed to persist config:', String((err && err.message) || err))
  }
  return configResult.config
}

function writeConfigFile(value) {
  const header = [
    '// 小鲸鱼桌面挂件配置',
    '// 这里只写入你改过的项；未出现的项使用程序内置默认值。',
    '// 保存后点托盘菜单「重载配置与台词」或挂件菜单「重载配置」即可生效。',
    '// 完整默认值与说明见 README.md 的「主配置」一节。',
    '// 支持 // 注释与尾逗号。',
    '',
  ].join('\n')
  const body = JSON.stringify(value && typeof value === 'object' ? value : {}, null, 2)
  fs.mkdirSync(paths.ROOT, { recursive: true })
  const tmp = paths.CONFIG_FILE + '.tmp-' + process.pid
  fs.writeFileSync(tmp, header + body + '\n', 'utf8')
  fs.renameSync(tmp, paths.CONFIG_FILE)
}

function ensureUserFiles() {
  paths.ensureLayout()
  const cfgRes = readJsonc(paths.CONFIG_FILE)
  if (cfgRes.missing) {
    try { writeConfigFile(DEFAULTS) } catch (err) { paths.log('cannot write default config', String(err)) }
  }
  const linesRes = readJsonc(paths.LINES_FILE)
  if (linesRes.missing) {
    try { writeJsonAtomic(paths.LINES_FILE, DEFAULT_LINES) } catch (err) { paths.log('cannot write default lines', String(err)) }
  }
  installDefaultSkin()
}

/**
 * Materialise skins\default\ from assets shipped in the repo, once.
 *
 * The default skin deliberately carries NO geometry block: it inherits
 * BASE_GEOMETRY from skins.cjs, so the reference values live in exactly one
 * place. A file generated by an older build kept a stale copy of that geometry
 * (recognisable by its missing `text.anchor`), so drop that block once when we
 * see it — user setups only ever override meta (names, sounds, image).
 */
function installDefaultSkin() {
  const dir = path.join(paths.SKINS_DIR, 'default')
  try {
    fs.mkdirSync(path.join(dir, 'sounds'), { recursive: true })
    const srcAssets = path.join(PACKAGE_ROOT, 'assets')
    const imgSrc = path.join(srcAssets, 'DSniang1.png')
    const imgDst = path.join(dir, 'whale.png')
    if (!fs.existsSync(imgDst) && fs.existsSync(imgSrc)) fs.copyFileSync(imgSrc, imgDst)
    const gifSrc = path.join(srcAssets, 'rua.gif')
    const gifDst = path.join(dir, 'rua.gif')
    if (!fs.existsSync(gifDst) && fs.existsSync(gifSrc)) fs.copyFileSync(gifSrc, gifDst)
    for (const s of ['Ya1.mp3', 'Ya2.mp3', 'D1.mp3', 'D2.mp3']) {
      const from = path.join(srcAssets, s)
      const to = path.join(dir, 'sounds', s)
      if (!fs.existsSync(to) && fs.existsSync(from)) fs.copyFileSync(from, to)
    }
    const metaFile = path.join(dir, 'skin.jsonc')
    if (fs.existsSync(metaFile)) {
      const existing = readJsonc(metaFile)
      const v = existing.value
      const staleGeometry = v && typeof v === 'object' && v.geometry &&
        (!v.geometry.text || v.geometry.text.anchor === undefined)
      if (staleGeometry) {
        delete v.geometry
        try {
          fs.writeFileSync(metaFile, JSON.stringify(v, null, 2) + '\n', 'utf8')
          paths.log('removed stale geometry from default skin.jsonc')
        } catch (err) {}
      }
      return
    }
    const meta = {
      _README: [
        '皮肤包定义。本文件只描述「这个皮肤是什么」；几何参数(geometry)不写在这里时，',
        '会继承程序内置的默认几何(见 src/main/skins.cjs 的 BASE_GEOMETRY)，',
        '这样默认皮肤永远跟随程序更新，不会残留旧常量。',
        '',
        '要自定义，就在下面加一个 geometry 块覆盖任意字段；此时该皮肤不再跟随内置默认值。',
        '本文件没有 geometry 块，说明它完全继承内置参考几何（见 src/main/skins.cjs 的 BASE_GEOMETRY）。',
        '定位几何时的排查顺序：气泡位置不对 -> geometry.bubble；',
        '气泡里文字不对 -> geometry.text / geometry.font；立绘大小位置不对 -> geometry.img。',
        '所有比例都是「占气泡宽度的比例」；bubble.left 控制气泡相对立绘的横向位置。',
        '文字默认 anchor=center，leftPct/topPct 是文字块中心在气泡内的百分比位置。',
      ],
      name: 'default',
      displayName: '默认 · 小鲸鱼',
      description: '原版 DSH 插件的小鲸鱼与气泡构图',
      author: '',
      image: 'whale.png',
      gif: 'rua.gif',
      sounds: {
        duck: { label: '小黄鸭', press: 'sounds/Ya1.mp3', release: 'sounds/Ya2.mp3' },
        fx1: { label: '音效1', press: 'sounds/D1.mp3', release: 'sounds/D2.mp3' },
      },
    }
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n', 'utf8')
  } catch (err) {
    paths.log('installDefaultSkin failed:', String((err && err.message) || err))
  }
}

// --- window -----------------------------------------------------------------

function getState() {
  const store = getStore()
  return store.get('win', {})
}

function getStore() {
  // tiny lazy JSON store for window geometry + anchor
  if (!getStore._s) {
    const file = path.join(paths.ROOT, '.window.json')
    getStore._s = {
      get(key, dflt) {
        try {
          const v = JSON.parse(fs.readFileSync(file, 'utf8'))
          return v && v[key] !== undefined ? v[key] : dflt
        } catch (err) { return dflt }
      },
      set(key, value) {
        let all = {}
        try { all = JSON.parse(fs.readFileSync(file, 'utf8')) || {} } catch (err) {}
        all[key] = value
        try { writeJsonAtomic(file, all) } catch (err) {}
      },
    }
  }
  return getStore._s
}

/** Compute the initial pet position from config.anchor. */
function anchorRect(width, height) {
  const cfg = config()
  const a = cfg.anchor || {}
  const display = screen.getPrimaryDisplay()
  const wa = display.workArea
  const hDist = Number(a.hDist) || 0
  const vDist = Number(a.vDist) || 0
  const x = a.h === 'left' ? wa.x + hDist : wa.x + wa.width - width - hDist
  const y = a.v === 'top' ? wa.y + vDist : wa.y + wa.height - height - vDist
  return { x: Math.round(x), y: Math.round(y) }
}

function resizeWindow(width, height) {
  if (!win || win.isDestroyed()) return
  const w = Math.max(80, Math.round(width))
  const h = Math.max(80, Math.round(height))
  const state = getState()
  const old = state.rect
  const bounds = win.getBounds()
  let x = bounds.x
  let y = bounds.y
  // Keep the anchored edge glued while the window grows/shrinks, so scaling
  // feels like the pet grows in place instead of drifting.
  if (old && old.w) {
    const hAnchor = state.hAnchor || 'right'
    const vAnchor = state.vAnchor || 'bottom'
    if (hAnchor === 'right') x = bounds.x + (old.w - w)
    if (vAnchor === 'bottom') y = bounds.y + (old.h - h)
  } else {
    const r = anchorRect(w, h)
    x = r.x
    y = r.y
  }
  win.setBounds({ x: Math.round(x), y: Math.round(y), width: w, height: h })
  getStore().set('win', { ...state, rect: { x: Math.round(x), y: Math.round(y), w, h } })
}

function rememberBounds() {
  if (!win || win.isDestroyed()) return
  const b = win.getBounds()
  const state = getState()
  getStore().set('win', { ...state, rect: { x: b.x, y: b.y, w: b.width, h: b.height } })
}

/**
 * Keep the window inside the display work area and remember which edges we sit
 * against. A native window drag only moves the window, so this is what turns a
 * free drag into the plugin's "snap to edge" behaviour.
 */
function dropSnap() {
  if (!win || win.isDestroyed()) return null
  const b = win.getBounds()
  const display = screen.getDisplayMatching(b)
  const wa = display.workArea
  const x = Math.max(wa.x, Math.min(b.x, wa.x + wa.width - b.width))
  const y = Math.max(wa.y, Math.min(b.y, wa.y + wa.height - b.height))
  if (x !== b.x || y !== b.y) {
    win.setBounds({ x: Math.round(x), y: Math.round(y), width: b.width, height: b.height })
  }
  const dLeft = x - wa.x
  const dRight = wa.x + wa.width - (x + b.width)
  const dTop = y - wa.y
  const dBottom = wa.y + wa.height - (y + b.height)
  const anchors = { h: dLeft <= dRight ? 'left' : 'right', v: dTop <= dBottom ? 'top' : 'bottom' }
  updateAnchors(anchors.h, anchors.v)
  rememberBounds()
  return { x: Math.round(x), y: Math.round(y), ...anchors }
}

function updateAnchors(hAnchor, vAnchor) {
  const state = getState()
  getStore().set('win', { ...state, hAnchor, vAnchor })
}

/**
 * Where to put the window on launch.
 *
 * A remembered position wins, but it is re-clamped into a real display's work
 * area first — monitors get unplugged or change resolution, and a window restored
 * off-screen would be invisible and impossible to drag back.
 */
function resolveInitialBounds(w, h) {
  const saved = getState().rect
  if (!saved || saved.x === undefined || saved.y === undefined) {
    const r = anchorRect(w, h)
    return { x: r.x, y: r.y }
  }
  const probe = { x: Math.round(saved.x), y: Math.round(saved.y), width: w, height: h }
  const display = screen.getDisplayMatching(probe)
  const wa = display.workArea
  return {
    x: Math.round(Math.max(wa.x, Math.min(probe.x, wa.x + wa.width - w))),
    y: Math.round(Math.max(wa.y, Math.min(probe.y, wa.y + wa.height - h))),
  }
}

function createWindow() {
  const saved = getState().rect
  const w = saved && saved.w ? saved.w : 560
  const h = saved && saved.h ? saved.h : 520
  const pos = resolveInitialBounds(w, h)

  win = new BrowserWindow({
    width: w,
    height: h,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  })

  // Surface renderer errors in the app log; without this a renderer exception is
  // invisible in a packaged tray app.
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    paths.log('renderer[' + level + ']', message, sourceId ? sourceId.split(/[\\/]/).pop() + ':' + line : '')
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    paths.log('renderer gone:', JSON.stringify(details))
  })
  win.webContents.on('preload-error', (_e, preloadPath, error) => {
    paths.log('preload error:', preloadPath, String((error && error.message) || error))
  })

  win.setAlwaysOnTop(config().alwaysOnTop !== false, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.loadFile(path.join(PACKAGE_ROOT, 'src', 'renderer', 'index.html'))

  win.once('ready-to-show', () => {
    win.showInactive()
  })

  win.on('moved', () => {
    rememberBounds()
  })
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      win.hide()
    }
  })
}

// --- cursor-following drag --------------------------------------------------

/**
 * Follow the global cursor while the user holds the pet.
 *
 * The renderer records where inside the window the grab happened; from then on
 * the main process polls `screen.getCursorScreenPoint()` and moves the window so
 * that same point stays under the cursor. Polling (rather than renderer pointer
 * events) is what lets the drag continue seamlessly once the cursor leaves the
 * window bounds — and unlike a `-webkit-app-region` drag it leaves hover events
 * intact for the menu button.
 */
function dragLoop() {
  if (!dragging || !win || win.isDestroyed()) { endCursorDrag(true); return }
  try {
    const p = screen.getCursorScreenPoint()
    if (p.x !== dragCursor.x || p.y !== dragCursor.y) {
      dragCursor = { x: p.x, y: p.y }
      dragStillSince = Date.now()
    } else if (dragStillSince && Date.now() - dragStillSince > 10000) {
      // Safety net: the renderer's pointerup never arrives when the button is
      // released outside the window, so settle once the cursor has been idle.
      endCursorDrag(true)
      return
    }
    const x = Math.round(p.x - dragOffset.x)
    const y = Math.round(p.y - dragOffset.y)
    const b = win.getBounds()
    if (x !== b.x || y !== b.y) {
      win.setBounds({ x, y, width: b.width, height: b.height })
    }
  } catch (err) {}
  dragTimer = setTimeout(dragLoop, 12)
}

function startCursorDrag(offset) {
  if (!win || win.isDestroyed()) return
  dragging = true
  dragOffset = { x: offset.x, y: offset.y }
  const p = screen.getCursorScreenPoint()
  dragCursor = { x: p.x, y: p.y }
  dragStillSince = Date.now()
  if (dragTimer) clearTimeout(dragTimer)
  dragTimer = setTimeout(dragLoop, 12)
}

function endCursorDrag(snap) {
  if (dragTimer) { clearTimeout(dragTimer); dragTimer = null }
  if (!dragging) return
  dragging = false
  // Always normalise on release: the window must never be left off-screen, and
  // dropSnap() is a no-op when the position is already inside the work area.
  if (snap) dropSnap()
  else rememberBounds()
}

// --- balance ----------------------------------------------------------------

async function refreshBalance(manual) {
  const now = Date.now()
  if (!manual && balanceCache && now - balanceCacheAt < BALANCE_TTL_MS) {
    return {
      ...balanceCache,
      cached: true,
      isPeak: isPeakTime(Math.floor(now / 1000)),
    }
  }
  if (balanceInFlight) return balanceInFlight
  balanceInFlight = (async () => {
    const cfg = config()
    const res = await fetchBalance(cfg)
    if (!res.ok) {
      // Network hiccup: keep the last known balance instead of blanking the UI.
      if (res.transient && lastGoodBalance) {
        return { ...lastGoodBalance, stale: true, warning: res.error }
      }
      return res
    }
    lastGoodBalance = res
    const led = recordUsage(Number(res.totalBalance), res.currency)
    const payload = {
      ...res,
      isPeak: isPeakTime(Math.floor(Date.now() / 1000)),
      usageMode: 'ledger',
      todayUsage: led.todayUsage || 0,
      usageSource: '小鲸鱼记账',
    }
    if (cfg.usageMode === 'token' && platformToken(cfg).value) {
      const u = await fetchPlatformUsage(cfg)
      if (u && isFinite(u.amount)) {
        payload.usageMode = 'token'
        payload.todayUsage = u.amount
        payload.todayTokens = u.tokens
        payload.usageSource = '平台接口'
      } else {
        payload.usageWarning = '平台令牌不可用，已回退到记账模式'
      }
    }
    balanceCache = payload
    balanceCacheAt = Date.now()
    return payload
  })().finally(() => {
    balanceInFlight = null
  })
  return balanceInFlight
}

function invalidateBalanceCache() {
  balanceCache = null
  balanceCacheAt = 0
  balanceInFlight = null
}

function scheduleRefresh() {
  if (refreshTimer) clearInterval(refreshTimer)
  const ms = Math.max(10000, Number(config().refreshMs) || 60000)
  refreshTimer = setInterval(() => {
    if (!wantsBalanceDisplay()) return
    refreshBalance(false).then((payload) => {
      sendToRenderer('whale:balance', payload)
    }).catch(() => {})
  }, ms)
}

function wantsBalanceDisplay() {
  const cfg = config()
  return cfg.displayMode === 'balance' ||
    (cfg.displayMode === 'keyboard' && cfg.keyboardClickMode !== 'time')
}

function applyDisplayMode() {
  if (config().displayMode !== 'keyboard') {
    stopKeyboardHook()
    keyboardError = null
    return
  }
  const result = startKeyboardHook((label) => {
    if (config().displayMode !== 'keyboard') return
    sendToRenderer('whale:key', { label, ts: Date.now() })
  })
  if (!result.ok) {
    keyboardError = result.error || 'keyboard hook unavailable'
    paths.log('keyboard hook failed:', keyboardError)
    sendToRenderer('whale:key', { error: keyboardError })
  } else {
    keyboardError = null
  }
}

function sendToRenderer(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

// --- tray -------------------------------------------------------------------

function trayIcon() {
  const candidates = [
    path.join(PACKAGE_ROOT, 'assets', 'tray.png'),
    path.join(PACKAGE_ROOT, 'assets', 'DSniang1.png'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const img = nativeImage.createFromPath(c)
      if (!img.isEmpty()) return img.resize({ width: 32, height: 32, quality: 'best' })
    }
  }
  return nativeImage.createEmpty()
}

function rebuildTrayMenu() {
  if (!tray) return
  const cfg = config()
  const skins = listSkins()
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示/隐藏小鲸鱼', click: () => toggleWindow() },
    { type: 'separator' },
    {
      label: '皮肤',
      submenu: skins.map((s) => ({
        label: s.displayName + (s.name === (currentSkin && currentSkin.name) ? ' ✓' : ''),
        type: 'radio',
        checked: s.name === (currentSkin && currentSkin.name),
        click: () => applySkin(s.name),
      })),
    },
    {
      label: '刷新余额',
      click: () => {
        refreshBalance(true).then((p) => sendToRenderer('whale:balance', p)).catch(() => {})
      },
    },
    { type: 'separator' },
    { label: '打开配置文件夹', click: () => shell.openPath(paths.ROOT) },
    { label: '打开台词文件', click: () => shell.openPath(currentLinesFile()) },
    { label: '打开峰谷文案文件', click: () => shell.openPath(PEAKS_FILE) },
    { label: '打开皮肤文件夹', click: () => shell.openPath(paths.SKINS_DIR) },
    { label: '重载配置与台词', click: () => reloadAllAndNotify() },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: getAutostartState().enabled,
      click: (item) => {
        const result = setAutostartEnabled(item.checked)
        if (!result.ok) {
          item.checked = !item.checked
          dialog.showErrorBox('开机自启设置失败', result.error)
        }
      },
    },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit() } },
  ]))
}

function toggleWindow() {
  if (!win || win.isDestroyed()) return
  if (win.isVisible()) win.hide()
  else { win.showInactive(); win.setAlwaysOnTop(config().alwaysOnTop !== false, 'screen-saver') }
}

function reloadAllAndNotify() {
  reloadConfig()
  reloadPeaks()
  reloadLines()
  reloadSkin()
  win?.setAlwaysOnTop(config().alwaysOnTop !== false, 'screen-saver')
  sendToRenderer('whale:state', statePayload())
  applyDisplayMode()
  scheduleRefresh()
  rebuildTrayMenu()
}

function currentLinesFile() {
  return (linesResult && linesResult.file) || resolveLinesFile(config())
}

function applySkin(name) {
  updateConfig({ skin: name })
  reloadSkin()
  rebuildTrayMenu()
  sendToRenderer('whale:state', statePayload())
}

// --- IPC --------------------------------------------------------------------

function setupIpc() {
  ipcMain.handle('whale:get-state', () => statePayload())

  ipcMain.handle('whale:balance', async (_e, manual) => {
    const payload = await refreshBalance(!!manual)
    return payload
  })

  ipcMain.handle('whale:pick-lines', () => pickRandom(linesResult ? linesResult.groups : []))

  ipcMain.handle('whale:set-config', (_e, patch) => {
    const before = config()
    const merged = updateConfig(patch || {})
    // Only pay the full reload cost for keys that need it.
    const needsSkin = patch && patch.skin !== undefined && patch.skin !== before.skin
    const needsLines = patch && (patch.linesFile !== undefined)
    const needsDisplay = patch && (patch.displayMode !== undefined || patch.keyboardClickMode !== undefined || patch.refreshMs !== undefined)
    const needsPeaks = patch && (patch.peakPreset !== undefined)
    if (needsSkin) reloadSkin()
    if (needsLines) reloadLines()
    if (patch && ['apiKey', 'platformToken', 'currency', 'usageMode'].some((key) => patch[key] !== undefined)) {
      invalidateBalanceCache()
    }
    if (patch && patch.alwaysOnTop !== undefined && win && !win.isDestroyed()) {
      win.setAlwaysOnTop(merged.alwaysOnTop !== false, 'screen-saver')
    }
    if (needsDisplay) {
      applyDisplayMode()
      scheduleRefresh()
      if (wantsBalanceDisplay()) {
        refreshBalance(false).then((payload) => sendToRenderer('whale:balance', payload)).catch(() => {})
      }
    }
    rebuildTrayMenu()
    if (needsSkin || needsLines || needsDisplay || needsPeaks) sendToRenderer('whale:state', statePayload())
    return { config: merged, skin: needsSkin ? skinPayload(currentSkin) : undefined, groups: needsLines ? linesResult.groups : undefined }
  })

  ipcMain.handle('whale:reload', () => {
    reloadAllAndNotify()
    return statePayload()
  })

  ipcMain.handle('whale:resize', (_e, size) => {
    resizeWindow(Number(size && size.width) || 300, Number(size && size.height) || 300)
    return true
  })

  ipcMain.on('whale:anchors', (_e, anchors) => {
    updateAnchors(anchors && anchors.h, anchors && anchors.v)
  })

  ipcMain.on('whale:passthrough', (_e, ignore) => {
    if (!win || win.isDestroyed()) return
    // Click-through is only allowed outside an active drag; otherwise the native
    // drag would lose its mouse capture mid-gesture.
    if (dragging && ignore) return
    if (ignore) win.setIgnoreMouseEvents(true, { forward: true })
    else win.setIgnoreMouseEvents(false)
  })

  ipcMain.on('whale:drag-begin', (_e, offset) => {
    if (!win || win.isDestroyed()) return
    startCursorDrag({
      x: Number(offset && offset.x) || 0,
      y: Number(offset && offset.y) || 0,
    })
  })
  ipcMain.on('whale:drag-end', () => {
    endCursorDrag(true)
  })

  ipcMain.on('whale:move-by', (_e, delta) => {
    if (!win || win.isDestroyed() || !delta) return
    const b = win.getBounds()
    win.setBounds({
      x: Math.round(b.x + (Number(delta.dx) || 0)),
      y: Math.round(b.y + (Number(delta.dy) || 0)),
      width: b.width,
      height: b.height,
    })
  })

  // End a drag: snap to the nearest horizontal/vertical edge of the display
  // under the pointer, then remember which edges we are glued to.
  ipcMain.handle('whale:drop', () => {
    if (!win || win.isDestroyed()) return null
    const b = win.getBounds()
    const display = screen.getDisplayMatching(b)
    const wa = display.workArea
    const gap = 12
    const dLeft = b.x - wa.x
    const dRight = wa.x + wa.width - (b.x + b.width)
    const dTop = b.y - wa.y
    const dBottom = wa.y + wa.height - (b.y + b.height)
    let x = b.x
    let y = b.y
    const hAnchor = dLeft <= dRight ? 'left' : 'right'
    const vAnchor = dTop <= dBottom ? 'top' : 'bottom'
    if (Math.min(dLeft, dRight) < 140) x = hAnchor === 'left' ? wa.x + gap : wa.x + wa.width - b.width - gap
    if (Math.min(dTop, dBottom) < 140) y = vAnchor === 'top' ? wa.y + gap : wa.y + wa.height - b.height - gap
    x = Math.max(wa.x, Math.min(x, wa.x + wa.width - b.width))
    y = Math.max(wa.y, Math.min(y, wa.y + wa.height - b.height))
    win.setBounds({ x: Math.round(x), y: Math.round(y), width: b.width, height: b.height })
    updateAnchors(hAnchor, vAnchor)
    return { x: Math.round(x), y: Math.round(y), hAnchor, vAnchor }
  })

  ipcMain.handle('whale:open-path', (_e, which) => {
    const map = {
      config: paths.CONFIG_FILE,
      lines: currentLinesFile(),
      peaks: PEAKS_FILE,
      skins: paths.SKINS_DIR,
      skin: currentSkin ? currentSkin.dir : paths.SKINS_DIR,
      root: paths.ROOT,
    }
    const target = map[which] || paths.ROOT
    if (which === 'config' || which === 'lines' || which === 'peaks') {
      try {
        if (fs.existsSync(target)) shell.showItemInFolder(target)
        return true
      } catch (err) { return false }
    }
    shell.openPath(target)
    return true
  })

  ipcMain.handle('whale:read-file', (_e, which) => {
    const map = { config: paths.CONFIG_FILE, lines: currentLinesFile(), peaks: PEAKS_FILE }
    const target = map[which]
    if (!target) return null
    try { return fs.readFileSync(target, 'utf8') } catch (err) { return null }
  })

  ipcMain.handle('whale:write-file', (_e, which, text) => {
    const map = { config: paths.CONFIG_FILE, lines: currentLinesFile(), peaks: PEAKS_FILE }
    const target = map[which]
    if (!target || typeof text !== 'string') return { ok: false }
    try {
      fs.writeFileSync(target, text, 'utf8')
      reloadAllAndNotify()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) }
    }
  })

  ipcMain.handle('whale:quit', () => { quitting = true; app.quit(); return true })
  ipcMain.handle('whale:hide', () => { if (win && !win.isDestroyed()) win.hide(); return true })
}

// --- asset protocol ---------------------------------------------------------

function registerAssetProtocol() {
  const { protocol, net } = require('electron')
  protocol.handle('whale-asset', (request) => {
    try {
      const url = new URL(request.url)
      const file = url.searchParams.get('p')
      if (!file) return new Response('missing p', { status: 400 })
      // Only ever serve files inside the app data root or the package assets.
      const resolved = path.resolve(file)
      const allowed = [path.resolve(paths.ROOT), path.resolve(PACKAGE_ROOT)]
      const ok = allowed.some((base) => resolved.toLowerCase().startsWith(base.toLowerCase()))
      if (!ok) return new Response('forbidden', { status: 403 })
      return net.fetch('file://' + resolved.replace(/\\/g, '/'))
    } catch (err) {
      return new Response('error', { status: 500 })
    }
  })
}

// --- app lifecycle ----------------------------------------------------------

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance && !VERIFY_SHOT) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) { win.showInactive() }
  })

  app.whenReady().then(() => {
    paths.ensureLayout()
    const autostartSync = syncAutostartTarget()
    if (!autostartSync.ok && autostartSync.enabled) paths.log('autostart sync failed:', autostartSync.error)
    ensureUserFiles()
    reloadConfig()
    reloadPeaks()
    reloadLines()
    reloadSkin()
    registerAssetProtocol()
    setupIpc()
    createWindow()
    tray = new Tray(trayIcon())
    tray.setToolTip('小鲸鱼余额挂件')
    tray.on('click', () => toggleWindow())
    rebuildTrayMenu()
    applyDisplayMode()
    scheduleRefresh()
    // Warm the balance cache shortly after boot.
    setTimeout(() => {
      if (wantsBalanceDisplay()) {
        refreshBalance(false).then((payload) => sendToRenderer('whale:balance', payload)).catch(() => {})
      }
    }, 1200)

    if (VERIFY_SHOT) {
      const startVerify = () => setTimeout(() => runVerifyShot(), VERIFY_BOOT_MS)
      if (win.webContents.isLoading()) win.webContents.once('did-finish-load', startVerify)
      else startVerify()
    }
  })

  app.on('before-quit', () => {
    quitting = true
    stopKeyboardHook()
  })
  app.on('window-all-closed', () => {
    // Tray app: keep running with no window.
  })
  app.on('activate', () => {
    if (!win || win.isDestroyed()) createWindow()
    else win.showInactive()
  })
}
