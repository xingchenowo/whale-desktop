'use strict'

// Pure-logic smoke test for the dialogue normaliser and weighted picker.
// Usage: node tools/test-lines.cjs

const { normalize, pickRandom, DEFAULT_LINES } = require('../src/main/lines.cjs')

let failures = 0
function check(name, cond, extra) {
  if (cond) {
    console.log('PASS ' + name)
  } else {
    failures++
    console.log('FAIL ' + name + (extra ? '  -> ' + extra : ''))
  }
}

// 1. The bundled default must normalise without throwing and keep every group.
const norm = normalize(DEFAULT_LINES)
check('default groups parsed', norm.groups.length === DEFAULT_LINES.groups.length,
  'got ' + norm.groups.length + ' want ' + DEFAULT_LINES.groups.length)
check('builtin group survives', norm.groups.some((g) => g.builtin === 'period'))
check('gif group survives', norm.groups.some((g) => g.gif === true))
check('weight preserved', norm.groups[0].w === 45, 'w=' + norm.groups[0].w)

// 2. A malformed file must not crash and must still yield usable groups.
const bad = normalize({ _README: ['note'], groups: [null, 42, { w: 1 }] })
check('malformed input falls back', bad.groups.length === DEFAULT_LINES.groups.length,
  'got ' + bad.groups.length)

// 3. Weighted picking must respect a zero weight and stay inside the set.
const only = normalize({ groups: [{ w: 0, variants: ['never'] }, { w: 5, variants: ['always'] }] })
let sawNever = false
for (let i = 0; i < 300; i++) {
  const sel = pickRandom(only.groups)
  const text = sel.lines && sel.lines[1] && sel.lines[1].t
  if (text === 'never') sawNever = true
}
check('zero-weight group never picked', !sawNever)

// 4. Weighted distribution sanity: 9:1 should land near 90%.
const dist = normalize({
  groups: [
    { w: 9, variants: ['nine'] },
    { w: 1, variants: ['one'] },
  ],
})
let nine = 0
const N = 4000
for (let i = 0; i < N; i++) {
  const sel = pickRandom(dist.groups)
  if (sel.lines[1].t === 'nine') nine++
}
const ratio = nine / N
check('weight ratio ~0.9', Math.abs(ratio - 0.9) < 0.04, 'ratio=' + ratio.toFixed(3))

// 5. Variant weights inside a group.
const inner = normalize({
  groups: [{
    w: 1,
    variants: [
      { w: 3, lines: [{ t: 'common', s: 'B' }] },
      { w: 1, lines: [{ t: 'rare', s: 'B' }] },
    ],
  }],
})
let common = 0
for (let i = 0; i < N; i++) {
  const sel = pickRandom(inner.groups)
  if (sel.lines[0].t === 'common') common++
}
check('variant ratio ~0.75', Math.abs(common / N - 0.75) < 0.04, 'ratio=' + (common / N).toFixed(3))

// 6. Style/wrap defaults propagate from the group to bare string variants.
const styled = normalize({ groups: [{ w: 1, style: 'B', wrap: true, variants: ['hi'] }] })
const line = pickRandom(styled.groups).lines[1]
check('group style propagates', line.s === 'B' && line.w === true, JSON.stringify(line))

// 7. Friendly flat format: lines may be a top-level array and weights may use
// the full `weight` name instead of the terse `w` alias.
const flat = normalize({
  lines: [
    { text: 'disabled', weight: 0, style: 'A' },
    { text: 'enabled', weight: 5, style: 'B' },
  ],
})
let sawDisabled = false
let sawEnabled = false
for (let i = 0; i < 200; i++) {
  const sel = pickRandom(flat.groups)
  const text = sel.lines && sel.lines[1] && sel.lines[1].t
  if (text === 'disabled') sawDisabled = true
  if (text === 'enabled') sawEnabled = true
}
check('flat lines + weight alias', !sawDisabled && sawEnabled)

// 8. Zero-weight variants must not throw or resurrect a disabled line.
const allZero = normalize({ groups: [{ weight: 1, variants: [{ text: 'zero', weight: 0 }] }] })
const zeroPick = pickRandom(allZero.groups)
check('all-zero variants fall back safely', !!zeroPick && !!zeroPick.builtin, JSON.stringify(zeroPick))

console.log(failures === 0 ? '\nALL PASS' : '\n' + failures + ' FAILED')
process.exit(failures === 0 ? 0 : 1)
