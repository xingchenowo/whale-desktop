'use strict'

// ---------------------------------------------------------------------------
// DeepSeek balance + usage.
//
// Ported from the DSH plugin, with the DSH service dependencies replaced by
// direct HTTPS calls and the credential chain in credentials.cjs.
// ---------------------------------------------------------------------------

const { apiKey, platformToken } = require('./credentials.cjs')
const { log } = require('./paths.cjs')

const BALANCE_URL = 'https://api.deepseek.com/user/balance'

// Peak/off-peak CNY price per million tokens, as [空闲, 高峰].
const PEAK_HOURS = [
  [9, 12],
  [14, 18],
]
const BASE_PRICE = { hit: [0.05, 0.1], miss: [1.5, 3.0], out: [4.5, 9.0] }
const PRO_PRICE = { hit: [0.15, 0.3], miss: [4.5, 9.0], out: [13.5, 27.0] }
const PRICING = {
  'deepseek-v4-flash-vision-exp': BASE_PRICE,
  'deepseek-v4-flash': BASE_PRICE,
  'deepseek-v4-pro': PRO_PRICE,
  'deepseek-chat': BASE_PRICE,
  'deepseek-reasoner': BASE_PRICE,
  _default: BASE_PRICE,
}

function priceFor(model) {
  const m = String(model || '').toLowerCase()
  for (const key of Object.keys(PRICING)) {
    if (key === '_default') continue
    if (m.indexOf(key) !== -1) return PRICING[key]
  }
  return PRICING._default
}

// Weekend all-valley pricing took effect at Beijing 2026-08-23 00:00.
const WEEKEND_VALLEY_FROM_SEC = Math.floor(Date.UTC(2026, 7, 22, 16, 0, 0) / 1000)

function isPeakTime(timeSec) {
  if (!isFinite(Number(timeSec))) return false
  const n = Number(timeSec)
  const bj = new Date(n * 1000 + 8 * 3600 * 1000)
  if (n >= WEEKEND_VALLEY_FROM_SEC) {
    const dow = bj.getUTCDay()
    if (dow === 0 || dow === 6) return false
  }
  const hour = bj.getUTCHours()
  for (const [start, end] of PEAK_HOURS) {
    if (hour >= start && hour < end) return true
  }
  return false
}

function pickBalanceInfo(infos, preferCurrency) {
  if (!Array.isArray(infos) || infos.length === 0) return null
  const num = (x) => (x && x.total_balance !== undefined ? Number(x.total_balance) : NaN)
  const want = String(preferCurrency || '').toUpperCase()
  if (want) {
    const exact = infos.find((x) => x && String(x.currency || '').toUpperCase() === want && isFinite(num(x)))
    if (exact) return exact
  }
  return (
    infos.find((x) => x && x.currency === 'CNY' && num(x) > 0) ||
    infos.find((x) => num(x) > 0) ||
    infos.find((x) => x && x.currency === 'CNY') ||
    infos[0]
  )
}

/**
 * Fetch the account balance.
 * Returns { ok:true, totalBalance, currency, updatedAt, keySource }
 *      or { ok:false, code, error, transient }
 */
async function fetchBalance(config) {
  const cred = apiKey(config)
  if (!cred.value) {
    return {
      ok: false,
      code: 'NO_KEY',
      error: '未配置 DEEPSEEK_API_KEY',
      hint: '在 config.jsonc 填 apiKey，或设置环境变量 DEEPSEEK_API_KEY，或先在 DSH 里配置该凭据',
    }
  }
  let lastErr = null
  for (let attempt = 0; attempt < 2; attempt++) {
    let res
    try {
      res = await fetch(BALANCE_URL, {
        headers: { Authorization: 'Bearer ' + cred.value, Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      })
    } catch (err) {
      lastErr = err
      if (attempt === 0) await new Promise((r) => setTimeout(r, 500))
      continue
    }
    if (!res.ok) {
      lastErr = new Error('HTTP ' + res.status)
      if (res.status < 500) break
      if (attempt === 0) await new Promise((r) => setTimeout(r, 500))
      continue
    }
    let data
    try {
      data = await res.json()
    } catch (err) {
      return { ok: false, code: 'PARSE', error: '余额接口返回不是合法 JSON' }
    }
    const info = pickBalanceInfo(data && data.balance_infos, config && config.currency)
    if (!info || info.total_balance === undefined) {
      return { ok: false, code: 'SHAPE', error: '余额接口返回结构异常' }
    }
    return {
      ok: true,
      totalBalance: Number(info.total_balance),
      currency: String(info.currency || 'CNY'),
      updatedAt: new Date().toISOString(),
      keySource: cred.source,
    }
  }
  const transient = !(lastErr && /^HTTP 4\d\d/.test(lastErr.message))
  return {
    ok: false,
    code: 'HTTP',
    transient,
    error: '余额接口请求失败: ' + String((lastErr && lastErr.message) || lastErr).slice(0, 200),
  }
}

function computeTodayUsage(data) {
  let d = data
  if (d && d.data && d.data.biz_data && Array.isArray(d.data.biz_data.series)) d = d.data.biz_data
  else if (d && d.data && Array.isArray(d.data.series)) d = d.data
  const series = Array.isArray(d.series) ? d.series : null
  if (!series || series.length === 0) return null
  let cost = 0
  let tokens = 0
  let found = false
  for (const s of series) {
    if (!s || typeof s !== 'object') continue
    const p = priceFor(s.model)
    const buckets = Array.isArray(s.buckets) ? s.buckets : []
    for (const b of buckets) {
      const u = b && b.usage
      if (!u || typeof u !== 'object') continue
      const hit = Number(u.PROMPT_CACHE_HIT_TOKEN) || 0
      const miss = Number(u.PROMPT_CACHE_MISS_TOKEN) || 0
      const out = Number(u.RESPONSE_TOKEN) || 0
      if (hit + miss + out === 0) continue
      found = true
      tokens += hit + miss + out
      const pi = isPeakTime(b.time) ? 1 : 0
      cost += (hit / 1e6) * p.hit[pi] + (miss / 1e6) * p.miss[pi] + (out / 1e6) * p.out[pi]
    }
  }
  return found ? { amount: cost, tokens } : null
}

/** Platform usage for today; { amount, tokens } or null. */
async function fetchPlatformUsage(config) {
  const cred = platformToken(config)
  if (!cred.value) return null
  try {
    const now = new Date()
    const tz = -now.getTimezoneOffset() * 60
    const start = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000)
    const end = start + 86400
    const url = 'https://platform.deepseek.com/api/v0/usage/by_api_key/amount?start=' + start + '&end=' + end + '&tz=' + tz
    const res = await fetch(url, {
      headers: { Authorization: 'Bearer ' + cred.value },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      log('platform usage http', res.status)
      return null
    }
    return computeTodayUsage(await res.json())
  } catch (err) {
    log('platform usage failed', String((err && err.message) || err))
    return null
  }
}

module.exports = { fetchBalance, fetchPlatformUsage, isPeakTime, priceFor, PRICING, PEAK_HOURS }
