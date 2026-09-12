'use strict'

// ---------------------------------------------------------------------------
// Named peak/off-peak wording presets.
//
// File: %APPDATA%\dsh-whale-desktop\peaks.jsonc
// Every item becomes one entry in the pet menu; its `name` is what users see.
// ---------------------------------------------------------------------------

const { readJsonc, writeJsonAtomic } = require('./lib/jsonc.cjs')
const { PEAKS_FILE } = require('./paths.cjs')

const DEFAULT_PEAKS = {
  _README: [
    '峰谷文案配置。每个 presets 项会在桌宠菜单里显示为一项。',
    'name = 菜单显示名，peak = 高峰时段文案，offPeak = 空闲时段文案。',
    '可以添加任意多项；id 可省略，省略时会根据 name 自动生成。',
  ],
  presets: [
    { id: 'default', name: '默认', peak: '高峰时段', offPeak: '空闲时段' },
    { id: 'liangwen', name: '梁文峰谷', peak: '梁文峰', offPeak: '梁文谷' },
    { id: 'qiangqiang', name: '!?强强?!', peak: '!?峰峰?!', offPeak: '!?谷谷?!' },
  ],
}

function makeId(value, index, used) {
  const base = String(value || ('preset-' + (index + 1)))
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '') || ('preset-' + (index + 1))
  let id = base
  let suffix = 2
  while (used.has(id)) {
    id = base + '-' + suffix
    suffix++
  }
  used.add(id)
  return id
}

function normalizePreset(item, index, used) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  const name = String(item.name || item.label || '方案 ' + (index + 1)).trim()
  if (!name) return null
  const id = makeId(item.id || item.key || name, index, used)
  const peak = String(item.peak || item.peakText || '高峰时段').trim() || '高峰时段'
  const offPeak = String(item.offPeak || item.offpeak || item.valley || '空闲时段').trim() || '空闲时段'
  return { id, name, peak, offPeak }
}

function normalize(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const items = Array.isArray(source.presets) ? source.presets : DEFAULT_PEAKS.presets
  const used = new Set()
  const presets = []
  for (let i = 0; i < items.length; i++) {
    const preset = normalizePreset(items[i], i, used)
    if (preset) presets.push(preset)
  }
  if (presets.length === 0) {
    return normalize(DEFAULT_PEAKS)
  }
  return presets
}

function loadPeaks(config) {
  const res = readJsonc(PEAKS_FILE)
  if (res.missing) {
    try { writeJsonAtomic(PEAKS_FILE, DEFAULT_PEAKS) } catch (err) {}
    return { file: PEAKS_FILE, presets: normalize(DEFAULT_PEAKS), error: null, created: true }
  }
  if (res.error) {
    return { file: PEAKS_FILE, presets: normalize(DEFAULT_PEAKS), error: '峰谷文案文件语法错误: ' + res.error, created: false }
  }
  const presets = normalize(res.value)
  // Preserve the legacy config.jsonc custom labels as one selectable preset.
  if (config && config.peakMode === 'custom' && config.peakLabels &&
      !presets.some((p) => p.id === 'legacy-custom')) {
    presets.push({
      id: 'legacy-custom',
      name: '自定义（旧配置）',
      peak: String(config.peakLabels.peak || '高峰时段'),
      offPeak: String(config.peakLabels.offPeak || '空闲时段'),
    })
  }
  return { file: PEAKS_FILE, presets, error: null, created: false }
}

function findPeakPreset(presets, id) {
  const list = Array.isArray(presets) ? presets : []
  return list.find((p) => p.id === id) || list[0] || null
}

module.exports = { DEFAULT_PEAKS, loadPeaks, normalize, findPeakPreset, PEAKS_FILE }
