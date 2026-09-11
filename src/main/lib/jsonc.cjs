'use strict'

// ---------------------------------------------------------------------------
// Small helpers: JSONC parsing, atomic JSON writes, path expansion.
// ---------------------------------------------------------------------------

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

/**
 * Strip // and /* *\/ comments plus trailing commas, then JSON.parse.
 * Comment stripping is string-aware so that URLs ("https://...") survive.
 * Returns { value, error } — never throws.
 */
function parseJsonc(text) {
  let out = ''
  let inString = false
  let inLine = false
  let inBlock = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const n = text[i + 1]
    if (inLine) {
      if (c === '\n') { inLine = false; out += c }
      continue
    }
    if (inBlock) {
      if (c === '*' && n === '/') { inBlock = false; i++ }
      continue
    }
    if (inString) {
      out += c
      if (c === '\\') { out += n === undefined ? '' : n; i++ }
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') { inString = true; out += c; continue }
    if (c === '/' && n === '/') { inLine = true; i++; continue }
    if (c === '/' && n === '*') { inBlock = true; i++; continue }
    out += c
  }
  // remove trailing commas: , followed by } or ]
  out = out.replace(/,(\s*[}\]])/g, '$1')
  try {
    return { value: JSON.parse(out), error: null }
  } catch (err) {
    return { value: null, error: String((err && err.message) || err) }
  }
}

/** Read a JSONC file. Returns { value, error, missing }. */
function readJsonc(file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (err) {
    return { value: null, error: null, missing: true }
  }
  // strip BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const parsed = parseJsonc(text)
  return { value: parsed.value, error: parsed.error, missing: false, text }
}

/** Write JSON atomically (tmp + rename) so a crash cannot truncate the file. */
function writeJsonAtomic(file, value) {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = file + '.tmp-' + process.pid
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, file)
}

/** Deep-merge plain objects: values from `patch` win; arrays are replaced wholesale. */
function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return patch === undefined ? base : patch
  }
  const out = (base && typeof base === 'object' && !Array.isArray(base)) ? { ...base } : {}
  for (const key of Object.keys(patch)) {
    const bv = out[key]
    const pv = patch[key]
    if (pv && typeof pv === 'object' && !Array.isArray(pv) &&
        bv && typeof bv === 'object' && !Array.isArray(bv)) {
      out[key] = deepMerge(bv, pv)
    } else {
      out[key] = pv
    }
  }
  return out
}

/** Expand a leading ~ to the user home directory. */
function expandHome(p) {
  if (typeof p !== 'string' || p === '') return p
  if (p === '~') return os.homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2))
  return p
}

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }) } catch (err) {}
  return dir
}

module.exports = { parseJsonc, readJsonc, writeJsonAtomic, deepMerge, expandHome, ensureDir }
