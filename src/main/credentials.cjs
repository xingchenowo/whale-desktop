'use strict'

// ---------------------------------------------------------------------------
// Credential resolution for the DeepSeek API key.
//
// Order (first hit wins):
//   1. config.jsonc  "apiKey" / "platformToken"
//   2. environment   DEEPSEEK_API_KEY / DEEPSEEK_PLATFORM_TOKEN
//   3. DSH store     %USERPROFILE%\.dsh\.credentials.yaml
//
// The DSH fallback lets the desktop pet reuse credentials already configured
// for DSH, so existing users do not have to paste them twice. The YAML is
// parsed with a deliberately tiny reader — we only need one scalar under
// `refs:`.
// ---------------------------------------------------------------------------

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

/**
 * Minimal reader for the `refs:` block of a DSH .credentials.yaml.
 * Handles `KEY: value`, quoted values, and `KEY:\n  ...` blocks are ignored.
 */
function readDshCredential(name) {
  const file = path.join(dshHome(), '.credentials.yaml')
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (err) {
    return null
  }
  const lines = text.split(/\r?\n/)
  let inRefs = false
  let refsIndent = -1
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const indent = line.length - line.trimStart().length
    const trimmed = line.trim()
    if (!inRefs) {
      if (/^refs\s*:/.test(trimmed)) { inRefs = true; refsIndent = indent }
      continue
    }
    // A new top-level key ends the refs block.
    if (indent <= refsIndent && !trimmed.startsWith('-')) return null
    const m = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(trimmed)
    if (!m) continue
    if (m[1] !== name) continue
    let value = m[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (value === '' || value === '~' || value === 'null') return null
    return value
  }
  return null
}

/**
 * Resolve a credential, returning { value, source } or { value: null, source }.
 */
function resolveCredential(config, opts) {
  const options = opts || {}
  const envName = options.envName
  const configKey = options.configKey
  const fromConfig = configKey ? config[configKey] : ''
  if (typeof fromConfig === 'string' && fromConfig.trim()) {
    return { value: fromConfig.trim(), source: 'config.jsonc' }
  }
  const fromEnv = envName ? process.env[envName] : ''
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    return { value: fromEnv.trim(), source: 'env:' + envName }
  }
  const fromDsh = envName ? readDshCredential(envName) : null
  if (fromDsh) {
    return { value: String(fromDsh).replace(/^Bearer\s+/i, '').trim(), source: 'DSH 凭据' }
  }
  return { value: null, source: 'none' }
}

function apiKey(config) {
  return resolveCredential(config, { envName: 'DEEPSEEK_API_KEY', configKey: 'apiKey' })
}

function platformToken(config) {
  return resolveCredential(config, { envName: 'DEEPSEEK_PLATFORM_TOKEN', configKey: 'platformToken' })
}

module.exports = { apiKey, platformToken, readDshCredential }
