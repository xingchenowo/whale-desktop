'use strict'

// ---------------------------------------------------------------------------
// 台词 (random dialogue) — JSONC driven, user editable.
//
// File: %APPDATA%\dsh-whale-desktop\lines.jsonc   (path overridable via
// config.jsonc -> "linesFile")
//
// Shape:
//   {
//     groups: [
//       { w: 45, builtin: "period" },              // built-in dynamic content
//       { w: 7,  variants: [ "好模型... ↓" ] },     // pick a variant uniformly
//       { w: 10, gif: true },                       // show the skin's gif
//       {
//         w: 4,
//         variants: [
//           { w: 3, lines: [ { t: "哦鲸鲸...", s: "B" } ] },
//           { w: 1, lines: [ { t: "稀客", s: "A" } ] }
//         ]
//       }
//     ]
//   }
//
// A line is { t: text, s: style, c: color, w: wrap } where style is one of
//   A = 小字标题   B = 大字金额   C = 灰色提示
// Text supports {today} {balance} {currency} {period} placeholders.
//
// Group weight `w` is relative: with weights 45/7/7/10/3/1 the group of weight
// 45 is picked 45/73 of the time. Variant `w` works the same way inside a group.
// ---------------------------------------------------------------------------

const path = require('node:path')
const { readJsonc, writeJsonAtomic } = require('./lib/jsonc.cjs')
const { resolveLinesFile } = require('./config.cjs')

const LINE_STYLES = ['A', 'B', 'C', 'P']

// Bundled default, also written to disk on first run so the user has something
// concrete to edit.
const DEFAULT_LINES = {
  _README: [
    '随机台词配置：点击鲸鱼气泡后显示的台词从这里加权抽取。',
    'groups[].w / weight 是该组的相对权重；组内 variants 每个条目等概率。',
    '只想改几句时，也可以直接写顶层 lines: [{ text, weight, style }]，不必用 groups。',
    'variants 里的对象可用 w / weight 设置变体权重，并用 lines 覆盖整组台词。',
    '行格式: { t / text, s / style, c / color, w / wrap }；A=小标题 B=大字 C=灰色提示 P=中号时段。',
    '文本支持占位符: {today} 今日已用 {balance} 余额 {currency} 币种 {period} 时段。',
    'builtin: "period" 表示内置的「当前时间段 + 今日已用」动态内容。',
    'gif: true 表示显示皮肤包里的 rua.gif 动图。',
  ],
  groups: [
    { w: 45, builtin: 'period' },
    { w: 7, variants: ['好模型... ↓', '好女孩...↓'], style: 'B' },
    {
      w: 7,
      style: 'A',
      wrap: true,
      variants: [
        '不知道用户有什么用，先赶走吧~',
        '我...我...我也要挣钱吗？',
        '我去吃饭啦，测完叫我',
        '压力一只蓝色大肥鱼？！',
        'DeepSleep...',
        '坏了...用户彻底怒了！',
      ],
    },
    { w: 10, gif: true },
    {
      w: 3,
      style: 'A',
      wrap: true,
      variants: [
        '你目录里的dsh是什么...大烧货吗...?',
        '恭喜你实现token自由！token全跑了！',
        '真当我是便宜货啊...',
      ],
    },
    { w: 1, variants: ['哦鲸鲸... '], style: 'B' },
  ],
}

/** Coerce one line entry into { t, s, c, w } or null when unusable. */
function normalizeLine(entry, defaults) {
  const d = defaults || {}
  if (typeof entry === 'string') {
    if (!entry) return null
    return { t: entry, s: LINE_STYLES.includes(d.style) ? d.style : 'A', c: d.color || '', w: !!d.wrap }
  }
  if (!entry || typeof entry !== 'object') return null
  const t = entry.t === undefined ? entry.text : entry.t
  if (typeof t !== 'string' || !t) return null
  const wantedStyle = entry.s === undefined ? entry.style : entry.s
  const s = LINE_STYLES.includes(wantedStyle) ? wantedStyle : (LINE_STYLES.includes(d.style) ? d.style : 'A')
  const wantedColor = entry.c === undefined ? entry.color : entry.c
  const wantedWrap = entry.w === undefined ? entry.wrap : entry.w
  return {
    t,
    s,
    c: typeof wantedColor === 'string' ? wantedColor : (d.color || ''),
    w: wantedWrap === undefined ? !!d.wrap : !!wantedWrap,
  }
}

/** Normalise the raw JSONC into a predictable structure for the renderer. */
function normalize(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const groupsIn = Array.isArray(src.groups)
    ? src.groups
    : (Array.isArray(src.lines) ? [{ w: 1, variants: src.lines }] : DEFAULT_LINES.groups)
  const groups = []
  for (const g of groupsIn) {
    if (!g || typeof g !== 'object' || Array.isArray(g)) continue
    if (g.enabled === false) continue
    const rawWeight = g.w === undefined ? g.weight : g.w
    const w = Number(rawWeight)
    const weight = isFinite(w) && w >= 0 ? w : 1
    const defaults = {
      style: g.style === undefined ? g.s : g.style,
      color: g.color === undefined ? g.c : g.color,
      wrap: g.wrap,
    }
    const group = { w: weight }

    if (g.builtin !== undefined) {
      group.builtin = String(g.builtin)
      const period = normalizeLineArray(g.lines, defaults)
      if (period) group.lines = period
      groups.push(group)
      continue
    }
    if (g.gif === true || g.builtin === 'gif') {
      group.gif = true
      groups.push(group)
      continue
    }

    const variantsIn = Array.isArray(g.variants) ? g.variants : (Array.isArray(g.lines) ? g.lines : [])
    if (variantsIn.length === 0) continue
    const variants = []
    for (const v of variantsIn) {
      if (v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.lines)) {
        const lines = normalizeLineArray(v.lines, defaults)
        if (!lines) continue
        const rawVariantWeight = v.w === undefined ? v.weight : v.w
        const vw = Number(rawVariantWeight)
        variants.push({ w: isFinite(vw) && vw >= 0 ? vw : 1, lines })
        continue
      }
      const line = normalizeLine(v, defaults)
      if (!line) continue
      const rawVariantWeight = (v && typeof v === 'object' && !Array.isArray(v))
        ? (v.w === undefined ? v.weight : v.w)
        : NaN
      const vw = Number(rawVariantWeight)
      variants.push({ w: 1, lines: [null, line, null], singleWeight: isFinite(vw) && vw >= 0 ? vw : 1 })
    }
    if (variants.length === 0) continue
    group.variants = variants
    groups.push(group)
  }
  if (groups.length === 0) {
    return { groups: normalize(DEFAULT_LINES).groups, error: null }
  }
  return { groups, error: null }
}

function normalizeLineArray(arr, defaults) {
  if (!Array.isArray(arr)) return null
  const lines = []
  for (const entry of arr) {
    const line = normalizeLine(entry, defaults)
    lines.push(line)
  }
  if (lines.length === 0) return null
  const has = lines.some((l) => l !== null)
  return has ? lines : null
}

/** Full load with a descriptive error instead of silently using defaults. */
function loadLines(config) {
  const file = resolveLinesFile(config || {})
  const res = readJsonc(file)
  if (res.missing) {
    try {
      writeJsonAtomic(file, DEFAULT_LINES)
    } catch (err) {}
    const norm = normalize(DEFAULT_LINES)
    return { file, groups: norm.groups, error: null, created: true }
  }
  if (res.error) {
    const norm = normalize(DEFAULT_LINES)
    return { file, groups: norm.groups, error: '台词文件语法错误: ' + res.error, created: false }
  }
  const norm = normalize(res.value)
  return { file, groups: norm.groups, error: null, created: false }
}

function pickWeighted(items, weightOf) {
  let total = 0
  for (const it of items) total += Math.max(0, weightOf(it))
  if (total <= 0) return null
  let r = Math.random() * total
  for (const it of items) {
    r -= Math.max(0, weightOf(it))
    if (r < 0) return it
  }
  return items[items.length - 1]
}

/**
 * Draw one random line set from the normalised groups.
 * Returns { builtin } | { gif:true } | { lines:[...] }
 * (The renderer resolves `builtin` into actual text so it can use live values.)
 */
function pickRandom(groups) {
  const list = Array.isArray(groups) ? groups : []
  if (list.length === 0) return { builtin: 'period' }
  const group = pickWeighted(list, (g) => Number(g.w) || 0)
  if (!group) return { builtin: 'period' }
  if (group.builtin !== undefined) {
    if (group.builtin === 'gif') return { gif: true }
    if (group.builtin === 'period' || group.builtin === 'time') {
      return { builtin: group.builtin, lines: group.lines || null }
    }
    return { builtin: group.builtin, lines: group.lines || null }
  }
  if (group.gif) return { gif: true }
  const variants = Array.isArray(group.variants) ? group.variants : []
  if (variants.length === 0) return { builtin: 'period' }
  const variant = pickWeighted(variants, (v) => {
    if (v.w !== undefined && v.singleWeight !== undefined) return v.singleWeight
    return Number(v.w) || 0
  })
  return variant ? { lines: variant.lines } : { builtin: 'period' }
}

module.exports = { DEFAULT_LINES, loadLines, pickRandom, normalize, resolveLinesFile }
