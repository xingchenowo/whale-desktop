'use strict'

// ---------------------------------------------------------------------------
// Renderer: the pet itself.
//
// Ported from the DSH plugin's injected widget, with three structural changes:
//   1. It owns a real, transparent desktop window, so it computes its own size
//      from the active skin's geometry and asks the main process to resize.
//   2. Random dialogue comes from the normalised lines.jsonc groups.
//   3. Every visual constant comes from the skin pack, so skins can differ in
//      geometry, not just in the image.
// ---------------------------------------------------------------------------

const MIN_SCALE = 0.6
const MAX_SCALE = 2.5
const REFRESH_MS_FLOOR = 10000
const KEY_BUBBLE_MS = 1500
const LOCK_HIDE_DELAY_MS = 700

const STYLE_CLASS = { A: 'label', B: 'amount', C: 'hint', P: 'period' }

// --- app state --------------------------------------------------------------

const state = {
  config: null,
  skin: null,
  skins: [],
  groups: [],
  geometry: null,
  scale: 1.4,
  balance: null,
  currency: null,
  todayUsage: null,
  isPeak: false,
  status: 'loading',
  message: '',
  soundSet: 'duck',
  usageMode: 'ledger',
  peakPreset: 'default',
  peakPresets: [],
  peaksFile: '',
  peaksError: null,
  displayMode: 'balance',
  keyboardClickMode: 'balance',
  soundOn: true,
  volume: 0.9,
  bubbleOn: true,
  randomLines: true,
  bubbleMs: 5000,
  showMenuButton: true,
  draggable: true,
  flipHorizontal: false,
  secondaryPet: false,
  dualPet: false,
  locked: false,
  lockVisible: false,
}

let root = null
let stage = null
let petBox = null
let imgWrap = null
let imgEl = null
let bubbleEl = null
let gifEl = null
let textBox = null
let lineEls = []
let menuBtn = null
let lockBtn = null
let menuBox = null
let gifFailed = false

let bubbleShown = false
let bubbleTimer = null
let bubbleRandomActive = false
let bubbleRandomLines = null
let animId = null
let shownAmount = null
let menuOpen = false
let pressed = false
let pressAudio = null
let releaseAudio = null
let hitCanvas = null
let hitCtx = null
let hitImage = null
let hitReady = false
let passthroughActive = false
let lockHideTimer = null
let baseSize = 320
let pressClient = null
let pressScreen = null
let movedFar = false
let dragStarted = false
const eventTrace = []

// --- helpers ----------------------------------------------------------------

function pickOne(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function fmt(amount, currency) {
  if (amount === null || amount === undefined || !isFinite(Number(amount))) return '--'
  const cur = currency || 'CNY'
  const sym = cur === 'CNY' ? '¥' : cur === 'USD' ? '$' : ''
  const n = Number(amount)
  const digits = Math.abs(n) >= 100 ? 2 : 4
  return (sym ? sym + ' ' : '') + n.toFixed(digits) + (sym ? '' : ' ' + cur)
}

function fmtMoney(amount) {
  if (!isFinite(Number(amount))) return '--'
  return '¥ ' + Number(amount).toFixed(4)
}

function placeholders() {
  const s = state
  return {
    today: fmt(s.todayUsage, s.currency),
    balance: fmt(s.balance, s.currency),
    currency: s.currency || 'CNY',
    period: s.isPeak ? periodText(true) : periodText(false),
  }
}

function periodText(peak) {
  const presets = Array.isArray(state.peakPresets) ? state.peakPresets : []
  const preset = presets.find((p) => p.id === state.peakPreset) || presets[0] || null
  if (preset) return peak ? preset.peak : preset.offPeak
  return peak ? '高峰时段' : '空闲时段'
}

function interpolate(text) {
  const vars = placeholders()
  return String(text).replace(/\{(\w+)\}/g, (m, key) => (vars[key] !== undefined ? vars[key] : m))
}

// --- geometry ---------------------------------------------------------------

function computeLayout() {
  const g = state.geometry || {}
  const img = g.img || { width: 0.5968, height: 0.5968, right: 0, bottom: 0 }
  const bubble = g.bubble || { width: 1, aspect: 1026 / 700, left: 0, top: 0 }
  const pad = Number(g.windowPadding) || 16

  // The bubble is sized by its own design box, never by the content box: making
  // the bubble element span the whole window (with the balloon just painted small
  // inside it) left a transparent, still-clickable layer over the pet, which ate
  // every drag and menu click on the whale.
  //
  //   vbox    = authoring box of the balloon artwork (default 1026x700)
  //   bubbleW = how wide that box is drawn at the current scale
  //
  // Every ratio in `geometry` is relative to bubbleW, including font sizes:
  // font.label = 0.0643 renders ~20.6px at a 320px bubble, matching the
  // original widget's 66/1026 authoring ratio.
  const vboxW = Number((bubble.vbox && bubble.vbox.w)) || 1026
  const vboxH = Number((bubble.vbox && bubble.vbox.h)) || 700
  const bubbleW = baseSize * (Number(bubble.width) || 1)
  const bubbleH = bubbleW * (vboxH / vboxW)
  const fontW = bubbleW

  const imageW = bubbleW * Number(img.width)
  const imageH = bubbleW * Number(img.height)

  const rawBubbleLeft = bubbleW * (Number(bubble.left) || 0)
  const rawBubbleTop = bubbleH * (Number(bubble.top) || 0)
  const rawImageLeft = bubbleW - imageW - bubbleW * (Number(img.right) || 0)
  // The pet keeps its base vertical placement; bubble.top only moves the
  // balloon relative to it, which is what makes 3/4-height positioning work.
  const rawImageTop = bubbleH - imageH - bubbleW * (Number(img.bottom) || 0)

  // A negative bubble offset means "extend the window left/up and keep the pet
  // anchored", rather than clipping the balloon outside the rendering area.
  const minX = Math.min(0, rawBubbleLeft, rawImageLeft)
  const minY = Math.min(0, rawBubbleTop, rawImageTop)
  const maxX = Math.max(rawBubbleLeft + bubbleW, rawImageLeft + imageW)
  const maxY = Math.max(rawBubbleTop + bubbleH, rawImageTop + imageH)
  const shiftX = -minX
  const shiftY = -minY
  const bubbleLeft = rawBubbleLeft + shiftX
  const bubbleTop = rawBubbleTop + shiftY
  const imageLeft = rawImageLeft + shiftX
  const imageTop = rawImageTop + shiftY
  const contentW = Math.max(1, maxX - minX)
  const contentH = Math.max(1, maxY - minY)

  // The hamburger sits in the transparent gap between the pet and the bubble, so
  // its rect is part of the layout (and of the hit test) rather than being read
  // back from the DOM.
  const btnCfg = g.menuBtn || {}
  const uiScale = bubbleW / 320
  const btnSize = (Number(btnCfg.size) || 30) * uiScale
  const btnRight = (btnCfg.right === undefined ? 4 : Number(btnCfg.right)) * uiScale
  const btnTop = (btnCfg.topRatio === undefined ? 0.4055 : Number(btnCfg.topRatio)) * contentH + 4 * uiScale

  const lockCfg = g.lockBtn || {}
  const lockSize = (Number(lockCfg.size) || 28) * uiScale
  const lockLeft = pad + imageLeft + (Number(lockCfg.offsetX) || 0) * uiScale
  const lockTop = pad + imageTop + (Number(lockCfg.offsetY) || 0) * uiScale

  return {
    pad, bubbleW, bubbleH, bubbleLeft, bubbleTop,
    fontW, imageLeft, imageTop, imageW, imageH,
    contentW, contentH,
    windowW: Math.ceil(contentW + pad * 2),
    windowH: Math.ceil(contentH + pad * 2),
    button: {
      left: pad + contentW - btnSize - btnRight,
      top: pad + btnTop,
      width: btnSize,
      height: btnSize,
    },
    lockButton: {
      left: lockLeft,
      top: lockTop,
      width: lockSize,
      height: lockSize,
    },
  }
}

function applyLayout() {
  const L = computeLayout()
  stage.style.width = L.windowW + 'px'
  stage.style.height = L.windowH + 'px'

  const g = state.geometry || {}
  const font = g.font || {}
  const text = g.text || { leftPct: 0.4425, topPct: 0.35, anchor: 'center' }
  const gif = g.gif || { leftPct: 0.4425, topPct: 0.44, maxW: 0.5458, maxH: 0.3899 }

  petBox.style.left = L.pad + 'px'
  petBox.style.top = L.pad + 'px'
  petBox.style.width = L.contentW + 'px'
  petBox.style.height = L.contentH + 'px'
  petBox.style.setProperty('--bubble-w', L.bubbleW + 'px')

  imgWrap.style.left = L.imageLeft + 'px'
  imgWrap.style.top = L.imageTop + 'px'
  imgWrap.style.width = L.imageW + 'px'
  imgWrap.style.height = L.imageH + 'px'
  imgEl.style.left = '0px'
  imgEl.style.top = '0px'
  imgEl.style.width = '100%'
  imgEl.style.height = '100%'

  bubbleEl.style.left = L.bubbleLeft + 'px'
  bubbleEl.style.top = L.bubbleTop + 'px'
  bubbleEl.style.width = L.bubbleW + 'px'
  bubbleEl.style.height = L.bubbleH + 'px'

  textBox.style.left = (text.leftPct * 100) + '%'
  textBox.style.top = (text.topPct * 100) + '%'

  gifEl.style.left = (gif.leftPct * 100) + '%'
  gifEl.style.top = (gif.topPct * 100) + '%'
  gifEl.style.maxWidth = (gif.maxW * L.bubbleW) + 'px'
  gifEl.style.maxHeight = (gif.maxH * L.bubbleW) + 'px'

  if (lineEls[0]) lineEls[0].style.fontSize = ((font.label || 0.0643) * L.fontW) + 'px'
  if (lineEls[1]) lineEls[1].style.fontSize = ((font.amount || 0.1248) * L.fontW) + 'px'
  if (lineEls[2]) lineEls[2].style.fontSize = ((font.hint || 0.0546) * L.fontW) + 'px'
  textBox.style.maxWidth = ((g.wrapMax || 0.5458) * L.bubbleW) + 'px'

  const periodEl = textBox.querySelector('.period')
  if (periodEl) periodEl.style.fontSize = ((font.period || 0.1014) * L.fontW) + 'px'

  // Reflect the anchor choice back into the transform, then measure the real
  // box so the hit test can use the composed geometry.
  textBox.style.transform = (text.anchor === 'center')
    ? 'translate(-50%, -50%)'
    : 'translate(-50%, 0)'

  const tbRect = textBox.getBoundingClientRect()
  L.textBox = {
    left: (L.pad + L.bubbleLeft) + (text.leftPct * L.bubbleW) - tbRect.width / 2,
    top: (L.pad + L.bubbleTop) + (text.topPct * L.bubbleH),
    width: tbRect.width,
    height: tbRect.height,
  }

  // Position the DOM button from the same rect the hit test uses. Previously the
  // CSS `right` offset omitted the window padding while `L.button` included it,
  // so the visible hamburger and its hit target were shifted apart.
  menuBtn.style.left = L.button.left + 'px'
  menuBtn.style.top = L.button.top + 'px'
  menuBtn.style.right = 'auto'
  menuBtn.style.width = L.button.width + 'px'
  menuBtn.style.height = L.button.height + 'px'

  lockBtn.style.left = L.lockButton.left + 'px'
  lockBtn.style.top = L.lockButton.top + 'px'
  lockBtn.style.width = L.lockButton.width + 'px'
  lockBtn.style.height = L.lockButton.height + 'px'
  lockBtn.style.fontSize = Math.round(L.lockButton.width * 0.56) + 'px'

  window.whale.resize({ width: L.windowW, height: L.windowH })
  return L
}

// --- hit testing ------------------------------------------------------------
//
// Two separate questions, deliberately kept apart:
//   'body'   -> an opaque pixel of the pet cut-out (or the visible menu button).
//               This is the grab/click target.
//   'zone'   -> anything the widget should own, including the gaps around the pet
//               and button and the open bubble/menu. While the pointer is in the
//               zone the window stays interactive, so a button sitting in a
//               transparent gap is still clickable. Outside the zone we go
//               click-through so the desktop underneath stays usable.
//
// The window cannot receive pointer events in the transparent gaps (they belong
// to whatever is behind), so every decision is made from forwarded mousemove
// coordinates rather than from element-level listeners.

/** Rasterise the cut-out so isBodyHit can read real alpha values. */
function rebuildHitMask() {
  const L = computeLayout()
  const w = Math.max(1, Math.round(L.imageW))
  const h = Math.max(1, Math.round(L.imageH))
  hitCanvas = document.createElement('canvas')
  hitCanvas.width = w
  hitCanvas.height = h
  hitCtx = hitCanvas.getContext('2d', { willReadFrequently: true })
  hitImage = new Image()
  hitReady = false
  hitImage.onload = () => {
    try {
      hitCtx.clearRect(0, 0, w, h)
      hitCtx.save()
      if (state.flipHorizontal) {
        hitCtx.translate(w, 0)
        hitCtx.scale(-1, 1)
      }
      hitCtx.drawImage(hitImage, 0, 0, w, h)
      hitCtx.restore()
      hitReady = true
    } catch (err) { hitReady = false }
  }
  hitImage.onerror = () => { hitReady = false }
  hitImage.src = (state.skin && state.skin.imageUrl) || ''
}

const ZONE_PAD = 12

function rectHit(x, y, r) {
  return !!r && x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height
}

function isLockHit(clientX, clientY, layout) {
  const L = layout || computeLayout()
  if (!lockBtn || (!state.locked && !state.lockVisible)) return false
  return rectHit(clientX, clientY, L.lockButton)
}

/**
 * Is the pointer over the balloon itself, rather than the empty rectangle around
 * it? The balloon is an ellipse inside a rectangular box, so a plain box test
 * would claim the transparent corners — and the area below the balloon, which
 * overlaps the pet's head — and swallow clicks meant for the whale.
 *
 * The renderer already knows the answer: unpainted SVG areas have
 * `pointer-events: none`, so `elementFromPoint` only returns the bubble (or its
 * painted paths) when the pointer really is on the balloon.
 */
function isBubbleHit(clientX, clientY) {
  if (state.locked) return false
  const L = computeLayout()
  if (!rectHit(clientX, clientY, {
    left: L.pad + L.bubbleLeft, top: L.pad + L.bubbleTop,
    width: L.bubbleW, height: L.bubbleH,
  })) return false
  try {
    const el = document.elementFromPoint(clientX, clientY)
    if (!el) return false
    return el === bubbleEl || bubbleEl.contains(el)
  } catch (err) {
    return false
  }
}

function isBodyHit(clientX, clientY) {
  const L = computeLayout()
  if (isLockHit(clientX, clientY, L)) return true
  if (state.locked) return false
  if (menuBtn && state.showMenuButton && rectHit(clientX, clientY, L.button)) return true
  const px = clientX - (L.pad + L.imageLeft)
  const py = clientY - (L.pad + L.imageTop)
  if (px < 0 || py < 0 || px >= L.imageW || py >= L.imageH) return false
  if (!hitReady || !hitCtx) return true
  try {
    const sx = Math.max(0, Math.min(hitCanvas.width - 1, Math.round(px * (hitCanvas.width / L.imageW))))
    const sy = Math.max(0, Math.min(hitCanvas.height - 1, Math.round(py * (hitCanvas.height / L.imageH))))
    const d = hitCtx.getImageData(sx, sy, 1, 1).data
    return d[3] > 24
  } catch (err) {
    return true
  }
}

function isZoneHit(clientX, clientY) {
  const L = computeLayout()
  if (isLockHit(clientX, clientY, L)) return true
  if (state.locked) return false
  if (isBodyHit(clientX, clientY)) return true
  if (state.showMenuButton && menuBtn && rectHit(clientX, clientY, {
    left: L.button.left - ZONE_PAD, top: L.button.top - ZONE_PAD,
    width: L.button.width + ZONE_PAD * 2, height: L.button.height + ZONE_PAD * 2,
  })) return true
  if (bubbleShown || menuOpen) {
    if (isBubbleHit(clientX, clientY)) return true
    if (menuOpen && menuBox) {
      const m = menuBox.getBoundingClientRect()
      if (rectHit(clientX, clientY, { left: m.left, top: m.top, width: m.width, height: m.height })) return true
    }
  }
  if (bubbleShown && L.textBox) {
    if (rectHit(clientX, clientY, {
      left: L.textBox.left - 4, top: L.textBox.top - 4,
      width: L.textBox.width + 8, height: L.textBox.height + 8,
    })) return true
  }
  return false
}

function updatePassthrough(clientX, clientY) {
  if (!state.locked && state.config && state.config.passthrough === false) {
    if (passthroughActive) { window.whale.setPassthrough(false); passthroughActive = false }
    return
  }
  const interactive = isZoneHit(clientX, clientY)
  if (!interactive && !passthroughActive) {
    passthroughActive = true
    window.whale.setPassthrough(true)
  } else if (interactive && passthroughActive) {
    passthroughActive = false
    window.whale.setPassthrough(false)
  }
}

// --- bubble -----------------------------------------------------------------

function applyLines(lines) {
  if (!lines) return
  if (lines.gif) {
    if (gifFailed || !state.skin || !state.skin.gifUrl) {
      applyLines([null, { t: '今天没有动图给你看~', s: 'A', c: '', w: true }, null])
      return
    }
    gifEl.style.display = 'block'
    for (const el of lineEls) el.style.display = 'none'
    return
  }
  gifEl.style.display = 'none'
  for (let i = 0; i < 3; i++) {
    const el = lineEls[i]
    const ln = lines[i]
    if (!el) continue
    if (ln) {
      el.style.display = ''
      el.className = (STYLE_CLASS[ln.s] || 'label') + (ln.w ? ' wrap' : '')
      const font = (state.geometry && state.geometry.font) || {}
      const ratio = ln.s === 'P'
        ? (font.period || 0.1014)
        : ln.s === 'B'
          ? (font.amount || 0.1248)
          : ln.s === 'C'
            ? (font.hint || 0.0546)
            : (font.label || 0.0643)
      el.style.fontSize = (ratio * computeLayout().fontW) + 'px'
      el.textContent = interpolate(ln.t)
      el.style.color = ln.c || ''
    } else {
      el.style.display = 'none'
      el.textContent = ''
      el.style.color = ''
    }
  }
}

/** The built-in dynamic group: 当前时间段 + 今日已用. */
function builtinLines(name) {
  if (name === 'gif') return { gif: true }
  const peak = !!state.isPeak
  return [
    { t: '当前时间段为:', s: 'A', c: '' },
    { t: periodText(peak), s: 'P', c: peak ? '#e0433f' : '#2fa24c' },
    { t: '今日已用 ' + fmt(state.todayUsage, state.currency), s: 'C', c: '' },
  ]
}

/** Default bubble content: current balance, with a short status hint below. */
function balanceLines() {
  const amount = (state.balance === null || state.balance === undefined)
    ? '--'
    : fmt(state.balance, state.currency)
  let hint = ''
  if (state.status === 'stale') hint = '（离线，显示上次余额）'
  else if (state.status === 'error') hint = state.message || '读取失败'
  else if (state.message) hint = state.message
  return [
    { t: 'DeepSeek 余额', s: 'A', c: '' },
    { t: amount, s: 'B', c: '' },
    hint ? { t: hint, s: 'C', c: '' } : null,
  ]
}

function timeLines() {
  const now = new Date()
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()]
  const p = (n) => String(n).padStart(2, '0')
  const date = now.getFullYear() + '-' + p(now.getMonth() + 1) + '-' + p(now.getDate()) + ' ' + week
  return [
    { t: '当前时间', s: 'A', c: '' },
    { t: p(now.getHours()) + ':' + p(now.getMinutes()) + ':' + p(now.getSeconds()), s: 'B', c: '' },
    { t: date, s: 'C', c: '' },
  ]
}

function keyboardLines(label, error) {
  if (error) {
    return [
      { t: '键盘监听不可用', s: 'A', c: '#e0433f' },
      { t: String(error).slice(0, 80), s: 'C', c: '#e0433f', w: true },
      null,
    ]
  }
  if (!label) {
    return [
      { t: '键盘监听', s: 'A', c: '' },
      { t: '按任意键', s: 'B', c: '' },
      null,
    ]
  }
  return [
    { t: '按键', s: 'A', c: '' },
    { t: label, s: 'B', c: '' },
    null,
  ]
}

function displayLines() {
  if (state.displayMode === 'time') return timeLines()
  if (state.displayMode === 'keyboard') {
    return state.keyboardClickMode === 'time' ? timeLines() : balanceLines()
  }
  return balanceLines()
}

function isBalanceDisplay() {
  return state.displayMode === 'balance' ||
    (state.displayMode === 'keyboard' && state.keyboardClickMode !== 'time')
}

function isTimeDisplay() {
  return state.displayMode === 'time' ||
    (state.displayMode === 'keyboard' && state.keyboardClickMode === 'time')
}

function resolveLines(sel) {
  if (!sel) return builtinLines('period')
  if (sel.gif) return { gif: true }
  if (sel.builtin) {
    // A user-provided line array for a builtin group overrides the text, but the
    // placeholders still resolve against live values.
    if (Array.isArray(sel.lines) && sel.lines.some(Boolean)) return sel.lines
    return builtinLines(sel.builtin)
  }
  return sel.lines || builtinLines('period')
}

function openBubble() {
  if (!state.bubbleOn) return
  bubbleShown = true
  bubbleRandomActive = false
  bubbleRandomLines = null
  applyLines(displayLines())
  bubbleEl.classList.add('open')
  if (bubbleTimer) clearTimeout(bubbleTimer)
  bubbleTimer = setTimeout(closeBubble, Math.max(600, Number(state.bubbleMs) || 5000))
  // Refresh in the background; the main process caches for 25 seconds, so this
  // is cheap when the user opens the bubble several times in a row.
  if (isBalanceDisplay()) refresh(false)
}

function closeBubble() {
  bubbleShown = false
  bubbleRandomActive = false
  bubbleRandomLines = null
  bubbleEl.classList.remove('open')
  if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null }
  gifEl.style.display = 'none'
}

async function onBubbleClick(e) {
  e.stopPropagation()
  if (!bubbleShown) return
  if (bubbleRandomActive) { closeBubble(); return }
  if (state.randomLines === false) { closeBubble(); return }
  const sel = await window.whale.pickLines()
  bubbleRandomActive = true
  bubbleRandomLines = sel
  applyLines(resolveLines(sel))
  if (bubbleTimer) clearTimeout(bubbleTimer)
  bubbleTimer = setTimeout(closeBubble, Math.max(600, Number(state.bubbleMs) || 5000))
}

function showKeyboardKey(payload) {
  if (!payload || state.displayMode !== 'keyboard') return
  state.keyboardError = payload.error || null
  bubbleShown = true
  bubbleRandomActive = false
  bubbleRandomLines = null
  applyLines(keyboardLines(payload.label, payload.error))
  bubbleEl.classList.add('open')
  if (bubbleTimer) clearTimeout(bubbleTimer)
  bubbleTimer = setTimeout(closeBubble, KEY_BUBBLE_MS)
}

// --- balance rendering ------------------------------------------------------

function animateAmount(from, to, currency, duration) {
  if (animId) cancelAnimationFrame(animId)
  const el = lineEls[1]
  if (!el) return
  if (from === null || from === undefined || !isFinite(from) || !isFinite(to)) {
    el.textContent = fmt(to, currency)
    return
  }
  const t0 = performance.now()
  const step = (now) => {
    const p = Math.min(1, (now - t0) / duration)
    const eased = 1 - Math.pow(1 - p, 3)
    el.textContent = fmt(from + (to - from) * eased, currency)
    if (p < 1) animId = requestAnimationFrame(step)
    else { el.textContent = fmt(to, currency); animId = null }
  }
  animId = requestAnimationFrame(step)
}

function renderBalance(payload) {
  if (!payload) return
  if (!payload.ok) {
    state.balance = null
    state.currency = null
    state.todayUsage = null
    state.status = 'error'
    state.message = payload.hint || payload.error || '读取失败'
    if (bubbleShown && !bubbleRandomActive && isBalanceDisplay()) applyLines(balanceLines())
    return
  }
  const cur = payload.currency || 'CNY'
  state.balance = Number(payload.totalBalance)
  state.currency = cur
  state.todayUsage = payload.todayUsage === undefined ? null : payload.todayUsage
  state.isPeak = payload.isPeak === undefined ? state.isPeak : !!payload.isPeak
  state.status = payload.stale ? 'stale' : 'ok'
  state.message = payload.usageWarning || payload.warning || ''

  const changed = shownAmount !== null && state.balance !== shownAmount
  if (bubbleShown && !bubbleRandomActive && isBalanceDisplay()) {
    applyLines(balanceLines())
    if (changed) animateAmount(shownAmount, state.balance, cur, 700)
  }
  if (shownAmount === null || changed) shownAmount = state.balance

}

// --- audio ------------------------------------------------------------------

function applySoundSet() {
  const skin = state.skin
  if (!skin || !skin.sounds) return
  let def = skin.sounds[state.soundSet]
  if (!def) {
    const keys = Object.keys(skin.sounds)
    if (keys.length === 0) { pressAudio = releaseAudio = null; return }
    def = skin.sounds[keys[0]]
  }
  pressAudio = def.press ? new Audio(def.press) : null
  releaseAudio = def.release ? new Audio(def.release) : null
  for (const a of [pressAudio, releaseAudio]) if (a) a.volume = state.volume
}

function playPress() {
  if (!state.soundOn || !pressAudio) return
  try { pressAudio.currentTime = 0; pressAudio.volume = state.volume; pressAudio.play().catch(() => {}) } catch (err) {}
}

function playRelease() {
  if (!state.soundOn || !releaseAudio) return
  try { releaseAudio.currentTime = 0; releaseAudio.volume = state.volume; releaseAudio.play().catch(() => {}) } catch (err) {}
}

// --- interaction ------------------------------------------------------------

function setPressed(on) {
  if (pressed === on) return
  pressed = on
  petBox.classList.toggle('pressed', on)
}

function updateLockButton() {
  if (!lockBtn) return
  lockBtn.textContent = state.locked ? '🔒' : '🔓'
  lockBtn.classList.toggle('locked', state.locked)
  lockBtn.classList.toggle('visible', state.locked || state.lockVisible)
  lockBtn.title = state.locked ? '解除锁定' : '锁定桌宠（鼠标穿透）'
}

function showLockTemporarily() {
  if (lockHideTimer) { clearTimeout(lockHideTimer); lockHideTimer = null }
  if (!state.lockVisible) {
    state.lockVisible = true
    updateLockButton()
  }
}

function scheduleLockHide() {
  if (state.locked || !state.lockVisible || lockHideTimer) return
  lockHideTimer = setTimeout(() => {
    lockHideTimer = null
    if (state.locked) return
    state.lockVisible = false
    updateLockButton()
  }, LOCK_HIDE_DELAY_MS)
}

function toggleLock() {
  state.locked = !state.locked
  state.lockVisible = state.locked
  if (lockHideTimer) { clearTimeout(lockHideTimer); lockHideTimer = null }
  if (state.locked) {
    closeMenu()
    closeBubble()
    setPressed(false)
    window.whale.dragEnd()
  }
  updateLockButton()
  const L = computeLayout()
  updateHover(L.lockButton.left + L.lockButton.width / 2, L.lockButton.top + L.lockButton.height / 2)
}

function setupInteraction() {
  document.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
  bubbleEl.addEventListener('click', onBubbleClick)
  menuBtn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    toggleMenu()
  })
  lockBtn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    toggleLock()
  })
  window.addEventListener('blur', () => {
    setPressed(false)
    window.whale.dragEnd()
  })
  // Forwarded mousemove is the only reliable signal while the window is
  // click-through, so all hover state is derived here rather than from
  // element-level enter/leave events.
  document.addEventListener('mousemove', (e) => updateHover(e.clientX, e.clientY))
  document.addEventListener('pointermove', (e) => updateHover(e.clientX, e.clientY))
  // Leaving the window entirely means leaving every zone.
  document.addEventListener('mouseleave', () => {
    updatePassthrough(-1, -1)
    setPressed(false)
    scheduleLockHide()
    if (!menuOpen) menuBtn.classList.remove('visible')
    root.style.cursor = 'default'
  })
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    if (isLockHit(e.clientX, e.clientY)) return
    if (isBodyHit(e.clientX, e.clientY) || rectHit(e.clientX, e.clientY, buttonRect())) toggleMenu()
  })
  window.addEventListener('resize', () => { applyLayout(); rebuildHitMask() })
  setupEventTrace()
}

/**
 * Keep a small rolling log of the input events that actually reach the window.
 *
 * Debugging the desktop pet is otherwise blind: in the transparent gaps the
 * window receives forwarded mousemove only, so "the click did nothing" can mean
 * the event never arrived, arrived as a different type, or arrived at a
 * different coordinate. Dumped by `window.__whaleDebug.trace()`.
 */
function setupEventTrace() {
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']) {
    document.addEventListener(type, (e) => {
      eventTrace.push({
        t: type,
        x: e.clientX,
        y: e.clientY,
        b: e.button,
        body: isBodyHit(e.clientX, e.clientY),
        zone: isZoneHit(e.clientX, e.clientY),
        target: e.target && e.target.className ? String(e.target.className).slice(0, 24) : '',
      })
      if (eventTrace.length > 60) eventTrace.shift()
    }, true)
  }
  for (const type of ['pointermove', 'mousemove']) {
    document.addEventListener(type, (e) => {
      const last = eventTrace[eventTrace.length - 1]
      if (last && last.t === type) { last.count = (last.count || 1) + 1; last.x = e.clientX; last.y = e.clientY; return }
      eventTrace.push({ t: type, x: e.clientX, y: e.clientY, count: 1 })
      if (eventTrace.length > 60) eventTrace.shift()
    }, true)
  }
}

function buttonRect() {
  return computeLayout().button
}

/** Click target that belongs to a real control (menu / bubble / button). */
function isInteractiveTarget(target) {
  return !!(target && target.closest && target.closest(
    '.menu, .menu-btn, .lock-btn, .bubble, .select, .range, .number, .check, .btn'
  ))
}

function onPointerDown(e) {
  if (e.button !== 0) return
  if (isInteractiveTarget(e.target)) return
  if (!isBodyHit(e.clientX, e.clientY)) {
    // Clicking empty space inside the zone (not the pet) just dismisses the menu.
    if (menuOpen) closeMenu()
    return
  }
  setPressed(true)
  playPress()
  // Capture the pointer so releasing outside the tiny transparent window still
  // produces pointerup and ends the custom cursor-follow drag promptly.
  try { document.body.setPointerCapture(e.pointerId) } catch (err) {}
  // Client coords are safe to compare until the window actually moves, which only
  // happens after dragBegin. pressClient doubles as the grab offset.
  pressClient = { x: e.clientX, y: e.clientY }
  pressScreen = { x: e.screenX, y: e.screenY }
  movedFar = false
  // The real window drag starts only after the pointer moves a few pixels, so a
  // plain click never turns into a (snapping) drag.
  dragStarted = false
  if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null }
}

function maybeBeginDrag(clientX, clientY) {
  if (dragStarted || !pressed || !state.draggable || !pressClient) return
  const moved = Math.abs(clientX - pressClient.x) + Math.abs(clientY - pressClient.y)
  if (moved < 4) return
  dragStarted = true
  window.whale.dragBegin(pressClient)
}

function onPointerUp(e) {
  const wasPressed = pressed
  if (wasPressed) { setPressed(false); playRelease() }
  if (state.draggable && dragStarted) window.whale.dragEnd()
  try { document.body.releasePointerCapture(e.pointerId) } catch (err) {}
  dragStarted = false
  // A real drag must not also count as a click on the pet.
  if (pressScreen) movedFar = Math.abs(e.screenX - pressScreen.x) + Math.abs(e.screenY - pressScreen.y) > 4
  pressClient = null
  pressScreen = null
  // A left click on the pet toggles the bubble.
  if (wasPressed && e.button === 0 && !movedFar) {
    if (menuOpen) closeMenu()
    if (bubbleShown) closeBubble()
    else openBubble()
  }
  movedFar = false
}

function onDocumentClick(e) {
  if (isInteractiveTarget(e.target)) return
  if (menuOpen && !isBodyHit(e.clientX, e.clientY)) closeMenu()
}

function updateHover(clientX, clientY) {
  updatePassthrough(clientX, clientY)
  maybeBeginDrag(clientX, clientY)
  const overLock = isLockHit(clientX, clientY)
  const body = !state.locked && isBodyHit(clientX, clientY)
  const overButton = !state.locked && state.showMenuButton && rectHit(clientX, clientY, buttonRect())
  if (!pressed) {
    const overBubble = !state.locked && bubbleShown && isBubbleHit(clientX, clientY)
    if (state.locked || body || overButton || overLock || menuOpen) showLockTemporarily()
    else scheduleLockHide()
    root.style.cursor = overLock
      ? 'pointer'
      : (overBubble ? 'pointer' : ((body || overButton) ? (state.draggable ? 'grab' : 'pointer') : 'default'))
    // The hamburger appears while the pointer is over the pet, and stays up while
    // the menu is open so it can be clicked again to dismiss.
    menuBtn.classList.toggle('visible', !state.locked && state.showMenuButton && (body || overButton || menuOpen))
  }
}

// --- menu -------------------------------------------------------------------

function menuRow() {
  const r = document.createElement('div')
  r.className = 'menu-row'
  return r
}

function menuLabel(text) {
  const s = document.createElement('span')
  s.textContent = text
  return s
}

function warningRow(text) {
  const r = menuRow()
  r.className += ' menu-warning'
  r.textContent = text
  return r
}

function makeCheckbox(checked, onChange) {
  const i = document.createElement('input')
  i.type = 'checkbox'
  i.className = 'check'
  i.checked = !!checked
  i.addEventListener('change', () => onChange(i.checked))
  return i
}

function buildMenu() {
  menuBox = document.createElement('div')
  menuBox.className = 'menu'

  const skin = state.skin || { sounds: {}, displayName: '' }

  if (state.configError) menuBox.appendChild(warningRow('配置错误：' + state.configError))
  if (state.linesError) menuBox.appendChild(warningRow('台词错误：' + state.linesError))
  if (state.peaksError) menuBox.appendChild(warningRow('峰谷文案错误：' + state.peaksError))
  if (state.hasApiKey === false) menuBox.appendChild(warningRow('未找到 API Key，余额暂时不可用'))
  if (state.keyboardError) menuBox.appendChild(warningRow('键盘监听不可用：' + state.keyboardError))

  // skin
  const skinRow = menuRow()
  skinRow.appendChild(menuLabel('皮肤'))
  const skinSelect = document.createElement('select')
  skinSelect.className = 'select'
  skinSelect.dataset.role = 'skin'
  for (const s of state.skins) {
    const o = document.createElement('option')
    o.value = s.name
    o.textContent = s.displayName
    skinSelect.appendChild(o)
  }
  skinSelect.value = skin.name || 'default'
  skinSelect.addEventListener('change', () => {
    window.whale.setSkin(skinSelect.value).then((res) => {
      // setConfig returns the freshly resolved skin/geometry; apply it here so the
      // new skin takes effect immediately instead of waiting for the next state push.
      if (res && res.skin) {
        state.skin = res.skin
        state.geometry = res.skin.geometry
        applySkinToDom()
        applyStatePayload({ config: res.config || state.config })
        buildMenuContents()
      }
    }).catch(() => {})
  })
  skinRow.appendChild(skinSelect)
  menuBox.appendChild(skinRow)

  // display mode
  const displayRow = menuRow()
  displayRow.appendChild(menuLabel('显示'))
  const displaySelect = document.createElement('select')
  displaySelect.className = 'select'
  for (const [v, label] of [['balance', 'DeepSeek 余额'], ['time', '时间'], ['keyboard', '键盘按键']]) {
    const o = document.createElement('option')
    o.value = v
    o.textContent = label
    displaySelect.appendChild(o)
  }
  displaySelect.value = state.displayMode
  displaySelect.addEventListener('change', () => {
    state.displayMode = displaySelect.value
    saveConfig({ displayMode: state.displayMode })
    if (bubbleShown && !bubbleRandomActive) applyLines(displayLines())
    if (isBalanceDisplay()) refresh(false)
  })
  displayRow.appendChild(displaySelect)
  menuBox.appendChild(displayRow)

  const keyboardClickRow = menuRow()
  keyboardClickRow.appendChild(menuLabel('按键点击'))
  const keyboardClickSelect = document.createElement('select')
  keyboardClickSelect.className = 'select'
  for (const [v, label] of [['balance', 'DeepSeek 余额'], ['time', '时间']]) {
    const o = document.createElement('option')
    o.value = v
    o.textContent = label
    keyboardClickSelect.appendChild(o)
  }
  keyboardClickSelect.value = state.keyboardClickMode
  keyboardClickSelect.addEventListener('change', () => {
    state.keyboardClickMode = keyboardClickSelect.value
    saveConfig({ keyboardClickMode: state.keyboardClickMode })
    if (bubbleShown && !bubbleRandomActive) applyLines(displayLines())
    if (isBalanceDisplay()) refresh(false)
  })
  keyboardClickRow.appendChild(keyboardClickSelect)
  menuBox.appendChild(keyboardClickRow)

  // scale
  const scaleRow = menuRow()
  scaleRow.appendChild(menuLabel('大小'))
  const range = document.createElement('input')
  range.type = 'range'
  range.min = String(MIN_SCALE)
  range.max = String(MAX_SCALE)
  range.step = '0.05'
  range.className = 'range'
  range.value = String(state.scale)
  const num = document.createElement('input')
  num.type = 'number'
  num.min = '1'
  num.max = '20'
  num.step = '1'
  num.className = 'number'
  const toDisplay = (s) => Math.round(1 + (s - MIN_SCALE) * 19 / (MAX_SCALE - MIN_SCALE))
  const fromDisplay = (v) => MIN_SCALE + Math.max(0, Math.min(20, v) - 1) * (MAX_SCALE - MIN_SCALE) / 19
  num.value = String(toDisplay(state.scale))
  range.addEventListener('input', () => {
    setScale(Number(range.value))
    num.value = String(toDisplay(state.scale))
  })
  range.addEventListener('change', () => saveConfig({ scale: Number(state.scale.toFixed(2)) }))
  num.addEventListener('input', () => {
    const s = fromDisplay(Math.round(Number(num.value)))
    range.value = String(s)
    setScale(s)
  })
  num.addEventListener('change', () => saveConfig({ scale: Number(state.scale.toFixed(2)) }))
  scaleRow.appendChild(range)
  scaleRow.appendChild(num)
  menuBox.appendChild(scaleRow)

  // sound set + volume
  const soundRow = menuRow()
  const soundToggle = makeCheckbox(state.soundOn, (v) => { state.soundOn = v; applySoundSet(); window.whale.setSound({ soundOn: v }).catch(() => {}) })
  soundRow.appendChild(soundToggle)
  const soundSelect = document.createElement('select')
  soundSelect.className = 'select'
  const soundKeys = Object.keys(skin.sounds || {})
  if (soundKeys.length === 0) {
    const o = document.createElement('option')
    o.textContent = '（该皮肤无音效）'
    soundSelect.appendChild(o)
    soundSelect.disabled = true
  }
  for (const k of soundKeys) {
    const o = document.createElement('option')
    o.value = k
    o.textContent = skin.sounds[k].label || k
    soundSelect.appendChild(o)
  }
  if (soundKeys.length && !soundKeys.includes(state.soundSet)) state.soundSet = soundKeys[0]
  soundSelect.value = state.soundSet || ''
  soundSelect.addEventListener('change', () => {
    state.soundSet = soundSelect.value
    applySoundSet()
    window.whale.setSound({ soundSet: state.soundSet }).catch(() => {})
  })
  soundRow.appendChild(soundSelect)
  const vol = document.createElement('input')
  vol.type = 'range'
  vol.min = '0'
  vol.max = '100'
  vol.step = '5'
  vol.className = 'range'
  vol.value = String(Math.round(state.volume * 100))
  const volPct = document.createElement('span')
  volPct.className = 'pct'
  volPct.textContent = vol.value + '%'
  vol.addEventListener('input', () => {
    state.volume = Number(vol.value) / 100
    volPct.textContent = vol.value + '%'
    for (const a of [pressAudio, releaseAudio]) if (a) a.volume = state.volume
  })
  vol.addEventListener('change', () => window.whale.setSound({ volume: state.volume }).catch(() => {}))
  const volRow = menuRow()
  volRow.appendChild(menuLabel('音量'))
  volRow.appendChild(vol)
  volRow.appendChild(volPct)
  menuBox.appendChild(soundRow)
  menuBox.appendChild(volRow)

  menuBox.appendChild(sep())

  // usage mode
  const usageRow = menuRow()
  usageRow.appendChild(menuLabel('用量'))
  const usageSelect = document.createElement('select')
  usageSelect.className = 'select'
  for (const [v, label] of [['ledger', '小鲸鱼记账 (推荐)'], ['token', '实时·令牌']]) {
    const o = document.createElement('option')
    o.value = v
    o.textContent = label
    usageSelect.appendChild(o)
  }
  usageSelect.value = state.usageMode
  usageSelect.addEventListener('change', () => {
    state.usageMode = usageSelect.value
    saveConfig({ usageMode: state.usageMode })
    refresh(true)
  })
  usageRow.appendChild(usageSelect)
  menuBox.appendChild(usageRow)

  // peak wording
  const peakRow = menuRow()
  peakRow.appendChild(menuLabel('峰谷文案'))
  const peakSelect = document.createElement('select')
  peakSelect.className = 'select'
  peakSelect.dataset.role = 'peak'
  for (const preset of state.peakPresets) {
    const o = document.createElement('option')
    o.value = preset.id
    o.textContent = preset.name
    peakSelect.appendChild(o)
  }
  peakSelect.value = state.peakPreset
  peakSelect.addEventListener('change', () => {
    state.peakPreset = peakSelect.value
    saveConfig({ peakPreset: state.peakPreset })
  })
  peakRow.appendChild(peakSelect)
  menuBox.appendChild(peakRow)

  menuBox.appendChild(sep())

  // toggles
  const bubbleRow = menuRow()
  bubbleRow.appendChild(makeCheckbox(state.bubbleOn, (v) => {
    state.bubbleOn = v
    saveConfig({ bubbleOn: v })
    if (!v) closeBubble()
  }))
  bubbleRow.appendChild(menuLabel('气泡'))
  const randomRow = menuRow()
  randomRow.appendChild(makeCheckbox(state.randomLines, (v) => { state.randomLines = v; saveConfig({ randomLines: v }) }))
  randomRow.appendChild(menuLabel('随机台词'))
  const menuBtnRow = menuRow()
  menuBtnRow.appendChild(makeCheckbox(state.showMenuButton, (v) => {
    state.showMenuButton = v
    menuBtn.style.display = v ? '' : 'none'
    saveConfig({ showMenuButton: v })
  }))
  menuBtnRow.appendChild(menuLabel('显示菜单按钮'))
  const dragRow = menuRow()
  dragRow.appendChild(makeCheckbox(state.draggable, (v) => {
    state.draggable = v
    saveConfig({ draggable: v })
  }))
  dragRow.appendChild(menuLabel('允许拖动'))
  const passRow = menuRow()
  passRow.appendChild(makeCheckbox(state.config.passthrough !== false, (v) => {
    state.config.passthrough = v
    saveConfig({ passthrough: v })
    if (!v) { passthroughActive = false; window.whale.setPassthrough(false) }
  }))
  passRow.appendChild(menuLabel('鼠标穿透'))
  const topRow = menuRow()
  topRow.appendChild(makeCheckbox(state.config.alwaysOnTop !== false, (v) => {
    state.config.alwaysOnTop = v
    saveConfig({ alwaysOnTop: v })
  }))
  topRow.appendChild(menuLabel('总在最前'))
  menuBox.appendChild(bubbleRow)
  menuBox.appendChild(randomRow)
  menuBox.appendChild(menuBtnRow)
  menuBox.appendChild(dragRow)
  menuBox.appendChild(passRow)
  menuBox.appendChild(topRow)

  const dualRow = menuRow()
  dualRow.appendChild(makeCheckbox(state.dualPet, (v) => {
    window.whale.toggleDualPet(v).then((res) => {
      state.dualPet = !!(res && res.enabled)
      buildMenuContents()
    }).catch(() => {})
  }))
  dualRow.appendChild(menuLabel('双开桌宠'))
  menuBox.appendChild(dualRow)

  const flipRow = menuRow()
  flipRow.appendChild(makeCheckbox(state.flipHorizontal, (v) => {
    state.flipHorizontal = v
    petBox.classList.toggle('flip-horizontal', v)
    rebuildHitMask()
    window.whale.setFlip(v).catch(() => {})
  }))
  flipRow.appendChild(menuLabel('水平翻转'))
  menuBox.appendChild(flipRow)

  menuBox.appendChild(sep())

  const openRow = menuRow()
  const cfgBtn = button('配置文件', () => window.whale.openPath('config'))
  const linesBtn = button('台词文件', () => window.whale.openPath('lines'))
  const skinsBtn = button('皮肤文件夹', () => window.whale.openPath('skins'))
  openRow.appendChild(cfgBtn)
  openRow.appendChild(linesBtn)
  openRow.appendChild(skinsBtn)
  menuBox.appendChild(openRow)

  const openRow2 = menuRow()
  const currentSkinBtn = button('当前皮肤', () => window.whale.openPath('skin'))
  const peaksBtn = button('峰谷文案', () => window.whale.openPath('peaks'))
  openRow2.appendChild(currentSkinBtn)
  openRow2.appendChild(peaksBtn)
  menuBox.appendChild(openRow2)

  const reloadRow = menuRow()
  reloadRow.appendChild(button('重载配置', () => window.whale.reload().then(applyStatePayload)))
  reloadRow.appendChild(button('立即刷新', () => refresh(true)))
  reloadRow.appendChild(button('隐藏', () => window.whale.hide()))
  menuBox.appendChild(reloadRow)

  const quitRow = menuRow()
  quitRow.appendChild(button('退出', () => window.whale.quit()))
  menuBox.appendChild(quitRow)

  stage.appendChild(menuBox)
}

function sep() {
  const d = document.createElement('div')
  d.className = 'menu-sep'
  return d
}

function button(text, onClick) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'btn'
  b.textContent = text
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick() })
  return b
}

function toggleMenu() {
  if (menuOpen) closeMenu()
  else openMenu()
}

function openMenu() {
  menuOpen = true
  menuBox.classList.add('open')
  positionMenu()
  // Skin folders can be added while the app is running. Refresh this one list
  // when the menu opens so the new pack appears without a restart.
  window.whale.getState().then((payload) => {
    if (!menuOpen || !payload) return
    if (Array.isArray(payload.skins)) {
      state.skins = payload.skins
      const select = menuBox.querySelector('[data-role="skin"]')
      if (select) {
        const current = select.value || (state.skin && state.skin.name) || 'default'
        select.innerHTML = ''
        for (const s of state.skins) {
          const o = document.createElement('option')
          o.value = s.name
          o.textContent = s.displayName
          select.appendChild(o)
        }
        select.value = current
      }
    }
    if (Array.isArray(payload.peakPresets)) {
      state.peakPresets = payload.peakPresets
      const select = menuBox.querySelector('[data-role="peak"]')
      if (select) {
        const current = select.value || state.peakPreset
        select.innerHTML = ''
        for (const preset of state.peakPresets) {
          const o = document.createElement('option')
          o.value = preset.id
          o.textContent = preset.name
          select.appendChild(o)
        }
        select.value = current
      }
    }
  }).catch(() => {})
}

function closeMenu() {
  menuOpen = false
  menuBox.classList.remove('open')
}

function positionMenu() {
  const L = computeLayout()
  const btnRect = menuBtn.getBoundingClientRect()
  const mw = menuBox.offsetWidth || 230
  const mh = menuBox.offsetHeight || 320
  let left = L.pad + L.contentW - mw
  let top = btnRect.bottom + 6
  if (top + mh > L.windowH) {
    // The window is deliberately compact; the full menu is often taller than
    // the pet. Put it beside the hamburger instead of on top of it so a second
    // click on the hamburger can still close the menu.
    top = 4
    left = Math.max(4, btnRect.left - mw - 8)
  }
  left = Math.max(4, Math.min(left, L.windowW - mw - 4))
  menuBox.style.left = left + 'px'
  menuBox.style.top = top + 'px'
}

function setScale(scale) {
  state.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))
  baseSize = 320 * state.scale
  applyLayout()
  rebuildHitMask()
  if (menuOpen) positionMenu()
}

function saveConfig(patch) {
  window.whale.setConfig(patch).catch(() => {})
}

// --- bootstrap --------------------------------------------------------------

function applyStatePayload(payload) {
  if (!payload) return
  // setConfig() intentionally returns partial payloads (for example only the
  // newly selected skin). Preserve fields that were not included instead of
  // clearing groups/skin metadata and silently breaking random dialogue.
  if (payload.config !== undefined) state.config = payload.config || {}
  if (payload.configError !== undefined) state.configError = payload.configError || null
  if (payload.skins !== undefined) state.skins = payload.skins || []
  if (payload.groups !== undefined) state.groups = payload.groups || []
  if (payload.linesFile !== undefined) state.linesFile = payload.linesFile || ''
  if (payload.linesError !== undefined) state.linesError = payload.linesError || null
  if (payload.peaksFile !== undefined) state.peaksFile = payload.peaksFile || ''
  if (payload.peaksError !== undefined) state.peaksError = payload.peaksError || null
  if (payload.peakPresets !== undefined) state.peakPresets = payload.peakPresets || []
  if (payload.hasApiKey !== undefined) state.hasApiKey = payload.hasApiKey
  if (payload.keySource !== undefined) state.keySource = payload.keySource
  if (payload.skin !== undefined) state.skin = payload.skin || null
  if (payload.isPeak !== undefined) state.isPeak = payload.isPeak
  if (payload.keyboardError !== undefined) state.keyboardError = payload.keyboardError || null
  if (payload.keyboardHookRunning !== undefined) state.keyboardHookRunning = !!payload.keyboardHookRunning
  if (payload.secondaryPet !== undefined) state.secondaryPet = !!payload.secondaryPet
  if (payload.dualPet !== undefined) state.dualPet = !!payload.dualPet
  if (payload.flipHorizontal !== undefined) state.flipHorizontal = !!payload.flipHorizontal

  const c = state.config
  state.scale = Number(c.scale) || 1.4
  state.soundOn = payload.soundOn !== undefined ? !!payload.soundOn : (c.sound !== false)
  state.volume = typeof payload.volume === 'number'
    ? payload.volume
    : (typeof c.volume === 'number' ? c.volume : 0.9)
  state.soundSet = payload.soundSet || c.soundSet || 'duck'
  state.usageMode = c.usageMode === 'token' ? 'token' : 'ledger'
  state.peakPreset = c.peakPreset || 'default'
  state.displayMode = ['balance', 'time', 'keyboard'].includes(c.displayMode) ? c.displayMode : 'balance'
  state.keyboardClickMode = c.keyboardClickMode === 'time' ? 'time' : 'balance'
  state.bubbleOn = c.bubbleOn !== false
  state.randomLines = c.randomLines !== false
  state.bubbleMs = Number(c.bubbleMs) || 5000
  state.showMenuButton = c.showMenuButton !== false
  state.draggable = c.draggable !== false
  if (petBox) petBox.classList.toggle('flip-horizontal', state.flipHorizontal)

  if (state.skin) {
    state.geometry = state.skin.geometry
    applySkinToDom()
  } else {
    state.geometry = null
  }

  menuBtn.style.display = state.showMenuButton ? '' : 'none'
  applySoundSet()
  updateLockButton()
  baseSize = 320 * state.scale
  applyLayout()
  rebuildHitMask()
  if (bubbleShown && !bubbleRandomActive) applyLines(displayLines())
  if (menuOpen) { closeMenu(); buildMenuContents() }
}

/** Push the active skin's assets into the DOM and rebuild derived state. */
function applySkinToDom() {
  if (!state.skin) return
  imgEl.src = state.skin.imageUrl
  hitImage = null
  hitReady = false
  gifFailed = false
  gifEl.onerror = () => { gifFailed = true }
  gifEl.src = state.skin.gifUrl || ''
  applySoundSet()
}

/** Rebuild the menu in place (needed after a skin change alters sound sets). */
function buildMenuContents() {
  const wasOpen = menuOpen
  const old = menuBox
  if (old && old.parentNode) old.parentNode.removeChild(old)
  buildMenu()
  if (wasOpen) {
    menuBox.classList.add('open')
    positionMenu()
  }
}

async function refresh(manual) {
  try {
    const payload = await window.whale.getBalance(!!manual)
    renderBalance(payload)
  } catch (err) {
    renderBalance({ ok: false, error: String((err && err.message) || err) })
  }
}

/** Rough theme variables so the menu matches the pet's palette. */
function themeVars(el) {
  el.style.setProperty('--ink', '#203170')
  el.style.setProperty('--ink-soft', '#536ba9')
}

async function boot() {
  // Load state first: the menu is built from config/skin values, so building it
  // before the payload arrives would read undefined fields.
  const payload = await window.whale.getState()

  root = document.createElement('div')
  root.className = 'root'
  stage = document.getElementById('stage')
  themeVars(stage)

  petBox = document.createElement('div')
  petBox.className = 'pet'

  imgWrap = document.createElement('div')
  imgWrap.className = 'pet-img-wrap'
  imgEl = document.createElement('img')
  imgEl.className = 'pet-img'
  imgEl.alt = '小鲸鱼'
  imgEl.draggable = false
  imgEl.style.webkitAppRegion = 'no-drag'
  imgWrap.appendChild(imgEl)

  bubbleEl = document.createElement('div')
  bubbleEl.className = 'bubble'
  bubbleEl.innerHTML =
    '<svg viewBox="0 0 1026 700" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path class="bshape" fill="#FFFFFF" stroke="#203170" stroke-width="18" stroke-linejoin="round" stroke-linecap="round" d="M 827 248 A 373 232 0 1 0 81 246 A 373 232 0 0 0 301 465 A 57 32 10 0 0 413 484 A 373 232 0 0 0 827 248 Z"/>' +
    '<ellipse class="b1" cx="352" cy="561" rx="37.5" ry="26" fill="#FFFFFF" stroke="#203170" stroke-width="18"/>' +
    '<ellipse class="b2" cx="442" cy="646" rx="24.5" ry="18" fill="#FFFFFF" stroke="#203170" stroke-width="18"/>' +
    '</svg>'

  gifEl = document.createElement('img')
  gifEl.className = 'gif'
  gifEl.alt = ''
  gifEl.draggable = false
  bubbleEl.appendChild(gifEl)

  textBox = document.createElement('div')
  textBox.className = 'text'
  for (const cls of ['label', 'amount', 'hint']) {
    const d = document.createElement('div')
    d.className = cls
    textBox.appendChild(d)
    lineEls.push(d)
  }
  bubbleEl.appendChild(textBox)

  menuBtn = document.createElement('button')
  menuBtn.type = 'button'
  menuBtn.className = 'menu-btn'
  menuBtn.title = '菜单'
  menuBtn.innerHTML = '<span></span><span></span><span></span>'

  lockBtn = document.createElement('button')
  lockBtn.type = 'button'
  lockBtn.className = 'lock-btn'
  lockBtn.textContent = '🔓'
  lockBtn.title = '锁定桌宠（鼠标穿透）'

  petBox.appendChild(imgWrap)
  petBox.appendChild(bubbleEl)
  root.appendChild(petBox)
  root.appendChild(lockBtn)
  root.appendChild(menuBtn)
  stage.appendChild(root)

  setupInteraction()

  applyStatePayload(payload)
  updateLockButton()
  buildMenu()
  if (!state.secondaryPet && isBalanceDisplay()) await refresh(false)

  window.whale.onState((p) => applyStatePayload(p))
  window.whale.onBalance((p) => renderBalance(p))
  window.whale.onKey((p) => showKeyboardKey(p))

  // Time mode updates every second; balance/period content only needs a slower
  // passive refresh because the main process already polls the API.
  setInterval(() => {
    if (bubbleShown && !bubbleRandomActive && isTimeDisplay()) applyLines(timeLines())
  }, 1000)
  setInterval(() => {
    if (bubbleShown && !bubbleRandomActive && isBalanceDisplay()) applyLines(balanceLines())
  }, 30000)

  // Debug/automation hook for the headless screenshot mode and for tinkering in
  // DevTools. Not used by normal operation.
  window.__whaleDebug = {
    open: () => openBubble(),
    lock: () => { if (!state.locked) toggleLock() },
    unlock: () => { if (state.locked) toggleLock() },
    isLocked: () => state.locked,
    close: () => closeBubble(),
    random: () => onBubbleClick({ stopPropagation() {} }),
    clickBubble: () => bubbleEl.click(),
    clickMenu: () => menuBtn.click(),
    openMenu: () => openMenu(),
    closeMenu: () => closeMenu(),
    /** Centre of the hamburger button in window client coordinates. */
    buttonCenter: () => {
      const r = buttonRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    },
    lockCenter: () => {
      const r = computeLayout().lockButton
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    },
    /** True when the given client point is over the visible balloon artwork. */
    isBubbleHit: (x, y) => isBubbleHit(x, y),
    /** Extra detail for diagnosing a single point. */
    at: (x, y) => {
      const el = document.elementFromPoint(x, y)
      const L = computeLayout()
      const box = {
        left: L.pad + L.bubbleLeft, top: L.pad + L.bubbleTop,
        width: L.bubbleW, height: L.bubbleH,
      }
      return {
        x, y,
        element: el ? (String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || el.tagName) : null,
        isBubble: !!el && (el === bubbleEl || bubbleEl.contains(el)),
        inBubbleBox: rectHit(x, y, box),
        bubbleShown,
        isBubbleHit: isBubbleHit(x, y),
        isBodyHit: isBodyHit(x, y),
        box,
      }
    },
    /** True when the given client point is over the pet's opaque pixels. */
    isBodyHit: (x, y) => isBodyHit(x, y),
    /**
     * A point on the visible pet that is opaque AND not covered by the balloon —
     * the reliable grab target, since the default skin draws the balloon beside
     * the pet. Scans the whole image box and returns null when nothing qualifies.
     */
    petGrabPoint: () => {
      const L = computeLayout()
      const x0 = Math.round(L.pad + L.imageLeft)
      const y0 = Math.round(L.pad + L.imageTop)
      const w = Math.round(L.imageW)
      const h = Math.round(L.imageH)
      // Prefer low-alpha travels first (bottom band, then top band) so the chosen
      // point tends to be visually stable across skins.
      const rows = []
      for (let r = 1; r >= 0; r--) {
        for (let i = 0; i < 20; i++) rows.push(r === 1 ? 0.55 + 0.44 * (i / 19) : 0.02 + 0.42 * (i / 19))
      }
      for (const fy of rows) {
        for (let i = 0; i <= 20; i++) {
          const fx = 0.6 + 0.39 * (i / 20)
          const x = Math.round(x0 + w * fx)
          const y = Math.round(y0 + h * fy)
          if (isBodyHit(x, y) && !isBubbleHit(x, y)) return { x, y }
        }
      }
      return null
    },
    /** A client point that is actually over the visible balloon artwork. */
    bubblePoint: () => {
      const L = computeLayout()
      const x0 = Math.round(L.pad + L.bubbleLeft)
      const y0 = Math.round(L.pad + L.bubbleTop)
      const w = Math.round(L.bubbleW)
      const h = Math.round(L.bubbleH)
      for (let row = 1; row <= 8; row++) {
        for (let col = 1; col <= 8; col++) {
          const x = Math.round(x0 + w * (col / 9))
          const y = Math.round(y0 + h * (row / 9))
          if (isBubbleHit(x, y)) return { x, y }
        }
      }
      return null
    },
    /**
     * A point on the visible pet that the balloon does not cover. The default
     * skin draws the balloon beside the pet's head, so the lower band of the
     * cut-out is the reliable non-overlapping target.
     */
    petCenter: () => {
      const L = computeLayout()
      return {
        x: Math.round(L.pad + L.imageLeft + L.imageW * 0.85),
        y: Math.round(L.pad + L.imageTop + L.imageH * 0.95),
      }
    },
    /** Recent input events that actually reached this window. */
    trace: () => eventTrace.slice(),
    clearTrace: () => { eventTrace.length = 0 },
    /** What the browser thinks is under a client point, plus key rects. */
    probe: (x, y) => {
      const L = computeLayout()
      const el = document.elementFromPoint(x, y)
      const br = bubbleEl.getBoundingClientRect()
      const ir = imgEl.getBoundingClientRect()
      const tr = textBox.getBoundingClientRect()
      return {
        at: el ? (String(el.className || el.tagName) || el.tagName) : null,
        bubbleInline: { left: bubbleEl.style.left, top: bubbleEl.style.top, width: bubbleEl.style.width, height: bubbleEl.style.height },
        bubbleOffset: { w: bubbleEl.offsetWidth, h: bubbleEl.offsetHeight },
        layout: { bubbleW: L.bubbleW, bubbleH: L.bubbleH, imageW: L.imageW, imageLeft: L.imageLeft, fontW: L.fontW, baseSize },
        bubbleRect: { l: Math.round(br.left), t: Math.round(br.top), w: Math.round(br.width), h: Math.round(br.height) },
        imageRect: { l: Math.round(ir.left), t: Math.round(ir.top), w: Math.round(ir.width), h: Math.round(ir.height) },
        textRect: { l: Math.round(tr.left), t: Math.round(tr.top), w: Math.round(tr.width), h: Math.round(tr.height) },
        buttonRect: L.button,
        lockRect: L.lockButton,
        stageSize: { w: stage.style.width, h: stage.style.height },
      }
    },
    state: () => ({
      scale: state.scale,
      skin: state.skin && state.skin.name,
      groups: state.groups.length,
      linesFile: state.linesFile,
      linesError: state.linesError,
      configError: state.configError,
      hasApiKey: state.hasApiKey,
      keySource: state.keySource,
      usageMode: state.usageMode,
      displayMode: state.displayMode,
      keyboardClickMode: state.keyboardClickMode,
      peakPreset: state.peakPreset,
      peakPresets: state.peakPresets,
      peaksError: state.peaksError,
      soundOn: state.soundOn,
      volume: state.volume,
      soundSet: state.soundSet,
      flipHorizontal: state.flipHorizontal,
      secondaryPet: state.secondaryPet,
      dualPet: state.dualPet,
      locked: state.locked,
      lockVisible: state.lockVisible,
      keyboardError: state.keyboardError,
      keyboardHookRunning: state.keyboardHookRunning,
      passthroughActive,
      bubbleShown,
      randomActive: bubbleRandomActive,
      menuOpen,
      balance: state.balance,
      currency: state.currency,
      todayUsage: state.todayUsage,
      lines: lineEls.map((el) => el.textContent),
      hintVisible: lineEls[2] ? lineEls[2].style.display : 'n/a',
      window: { w: stage.offsetWidth, h: stage.offsetHeight },
    }),
  }
}

boot().catch((err) => {
  document.body.innerHTML = '<pre style="color:#c00;font:12px monospace;padding:8px">' +
    String((err && err.stack) || err) + '</pre>'
})
