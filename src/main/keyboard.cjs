'use strict'

// ---------------------------------------------------------------------------
// Global key listener for the "keyboard" display mode.
//
// uiohook-napi uses a low-level hook to observe key events without consuming
// them, so games and other apps continue to receive every key normally. The
// hook is started only while displayMode === "keyboard" and is stopped again
// when another display mode is selected.
// ---------------------------------------------------------------------------

let uIOhook = null
let UiohookKey = null
let loadError = null

try {
  ;({ uIOhook, UiohookKey } = require('uiohook-napi'))
} catch (err) {
  loadError = String((err && err.message) || err)
}

let running = false
let attached = false
let keyHandler = null
const pressed = new Set()
const pressOrder = []

const KEY_NAMES = {
  Backspace: 'Backspace',
  Tab: 'Tab',
  Enter: 'Enter',
  CapsLock: 'CapsLock',
  Escape: 'Esc',
  Space: 'Space',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  End: 'End',
  Home: 'Home',
  ArrowLeft: '←',
  ArrowUp: '↑',
  ArrowRight: '→',
  ArrowDown: '↓',
  Insert: 'Insert',
  Delete: 'Delete',
  NumpadMultiply: 'Num *',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  NumpadDecimal: 'Num .',
  NumpadDivide: 'Num /',
  NumpadEnter: 'Num Enter',
  NumpadEnd: 'Num 1',
  NumpadArrowDown: 'Num 2',
  NumpadPageDown: 'Num 3',
  NumpadArrowLeft: 'Num 4',
  NumpadArrowRight: 'Num 6',
  NumpadHome: 'Num 7',
  NumpadArrowUp: 'Num 8',
  NumpadPageUp: 'Num 9',
  NumpadInsert: 'Num 0',
  NumpadDelete: 'Num .',
  Semicolon: ';',
  Equal: '=',
  Comma: ',',
  Minus: '-',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  BracketLeft: '[',
  Backslash: '\\',
  BracketRight: ']',
  Quote: "'",
  Ctrl: 'Ctrl',
  CtrlRight: 'Ctrl',
  Alt: 'Alt',
  AltRight: 'Alt',
  Shift: 'Shift',
  ShiftRight: 'Shift',
  Meta: 'Win',
  MetaRight: 'Win',
  NumLock: 'NumLock',
  ScrollLock: 'ScrollLock',
  PrintScreen: 'PrintScreen',
}

function labelFor(code) {
  if (!UiohookKey) return 'Key ' + code
  for (const [name, value] of Object.entries(UiohookKey)) {
    if (value !== code) continue
    if (KEY_NAMES[name]) return KEY_NAMES[name]
    if (/^[A-Z0-9]$/.test(name)) return name
    if (/^Numpad[0-9]$/.test(name)) return 'Num ' + name.slice(6)
    if (/^F[0-9]+$/.test(name)) return name
    return name
  }
  return 'Key ' + code
}

const SHIFT_NUMBER_KEYS = [
  ['1', '!'], ['2', '@'], ['3', '#'], ['4', '$'], ['5', '%'],
  ['6', '^'], ['7', '&'], ['8', '*'], ['9', '('], ['0', ')'],
]

function shiftNumberLabel(code) {
  if (!UiohookKey) return null
  for (const [key, symbol] of SHIFT_NUMBER_KEYS) {
    if (UiohookKey[key] === code) return symbol
  }
  return null
}

function isShiftCode(code) {
  return !!UiohookKey && (code === UiohookKey.Shift || code === UiohookKey.ShiftRight)
}

function keyIdentity(code) {
  return labelFor(code)
}

function emitPressedCombo() {
  const shiftHeld = !!UiohookKey && (
    pressed.has(UiohookKey.Shift) || pressed.has(UiohookKey.ShiftRight)
  )
  const shiftedNumberPresent = shiftHeld && pressOrder.some((code) =>
    pressed.has(code) && shiftNumberLabel(code)
  )
  const labels = []
  for (const code of pressOrder) {
    if (!pressed.has(code)) continue
    if (shiftedNumberPresent && isShiftCode(code)) continue
    const label = (shiftHeld && shiftNumberLabel(code)) || labelFor(code)
    if (!labels.includes(label)) labels.push(label)
    if (labels.length >= 3) break
  }
  const label = labels.join(' + ')
  if (!label) return
  try { if (keyHandler) keyHandler(label) } catch (err) {}
}

function attach() {
  if (attached || !uIOhook) return
  attached = true
  uIOhook.on('keydown', (event) => {
    if (!running) return
    const code = event.keycode
    const identity = keyIdentity(code)
    if ([...pressed].some((held) => keyIdentity(held) === identity)) return
    pressed.add(code)
    pressOrder.push(code)
    emitPressedCombo()
  })
  uIOhook.on('keyup', (event) => {
    const code = event.keycode
    const identity = keyIdentity(code)
    for (const held of [...pressed]) {
      if (keyIdentity(held) !== identity) continue
      pressed.delete(held)
      const index = pressOrder.indexOf(held)
      if (index !== -1) pressOrder.splice(index, 1)
    }
  })
}

function startKeyboardHook(handler) {
  keyHandler = handler
  if (loadError || !uIOhook) return { ok: false, error: loadError || 'uiohook-napi unavailable' }
  attach()
  if (!running) {
    try {
      uIOhook.start()
      running = true
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) }
    }
  }
  return { ok: true }
}

function stopKeyboardHook() {
  keyHandler = null
  pressed.clear()
  pressOrder.length = 0
  if (!uIOhook || !running) return
  running = false
  try { uIOhook.stop() } catch (err) {}
}

function isKeyboardHookRunning() {
  return running
}

module.exports = { startKeyboardHook, stopKeyboardHook, isKeyboardHookRunning }
