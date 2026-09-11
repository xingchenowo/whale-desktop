'use strict'

// ---------------------------------------------------------------------------
// 小鲸鱼记账 — the no-token usage mode.
//
// Every time the balance is observed, a drop is added to today's usage. The
// ledger rolls over at local midnight and keeps 30 days of history.
//
// Currency awareness: when the observed currency changes we only reset the
// baseline and record no difference, because the numeric jump comes from the
// account switching currency, not from real spending.
// ---------------------------------------------------------------------------

const fs = require('node:fs')
const { USAGE_FILE } = require('./paths.cjs')
const { writeJsonAtomic } = require('./lib/jsonc.cjs')

function todayKey() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

function readLedger() {
  try {
    const parsed = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'))
    if (parsed && typeof parsed === 'object' && typeof parsed.date === 'string') return parsed
  } catch (err) {}
  return { date: todayKey(), lastBalance: null, lastCurrency: '', todayUsage: 0, history: {} }
}

function writeLedger(led) {
  try {
    writeJsonAtomic(USAGE_FILE, led)
    return true
  } catch (err) {
    return false
  }
}

/**
 * Record a balance observation and return the (possibly rolled-over) ledger.
 */
function recordUsage(currentBalance, currency) {
  const t = todayKey()
  const led = readLedger()
  const cur = String(currency || '')
  const currencyChanged =
    typeof led.lastCurrency === 'string' && led.lastCurrency !== '' &&
    cur !== '' && led.lastCurrency !== cur

  if (led.date !== t) {
    if (led.date && typeof led.todayUsage === 'number') {
      led.history = led.history || {}
      led.history[led.date] = led.todayUsage
    }
    led.date = t
    led.lastBalance = currentBalance
    led.lastCurrency = cur
    led.todayUsage = 0
  } else if (currencyChanged) {
    led.lastBalance = currentBalance
    led.lastCurrency = cur
  } else {
    const prev = typeof led.lastBalance === 'number' ? led.lastBalance : currentBalance
    if (typeof prev === 'number' && typeof currentBalance === 'number' && currentBalance < prev) {
      led.todayUsage = (typeof led.todayUsage === 'number' ? led.todayUsage : 0) + (prev - currentBalance)
    }
    led.lastBalance = currentBalance
    led.lastCurrency = cur
  }

  const keys = Object.keys(led.history || {}).sort()
  while (keys.length > 30) delete led.history[keys.shift()]
  writeLedger(led)
  return led
}

function readTodayUsage() {
  return readLedger().todayUsage || 0
}

module.exports = { readLedger, recordUsage, readTodayUsage, todayKey }
