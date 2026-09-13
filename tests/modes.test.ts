import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildModeInstructions,
  filterSkillBodyForMode,
  getFallbackInstructions,
  isDeactivationCommand,
  normalizeConfigMode,
  normalizeMode,
  normalizePersistedMode,
  resolveDefaultMode,
} from '../src/modes.ts'

test('normalizeMode accepts only runtime levels', () => {
  assert.equal(normalizeMode('ULTRA'), 'ultra')
  assert.equal(normalizeMode('  off '), 'off')
  assert.equal(normalizeMode('review'), undefined)
  assert.equal(normalizeMode(''), undefined)
  assert.equal(normalizeMode(42), undefined)
})

test('normalizeConfigMode additionally accepts the session-only review level', () => {
  assert.equal(normalizeConfigMode('review'), 'review')
  assert.equal(normalizeConfigMode('Full'), 'full')
  assert.equal(normalizeConfigMode('shrug'), undefined)
})

test('normalizePersistedMode prefers runtime levels then config levels', () => {
  assert.equal(normalizePersistedMode('lite'), 'lite')
  assert.equal(normalizePersistedMode('review'), 'review')
  assert.equal(normalizePersistedMode(null), undefined)
})

test('resolveDefaultMode prefers config, then env, then config file, then full', () => {
  assert.equal(resolveDefaultMode({ configured: 'ultra', env: { PONYTAIL_DEFAULT_MODE: 'lite' } }), 'ultra')
  assert.equal(resolveDefaultMode({ env: { PONYTAIL_DEFAULT_MODE: 'lite' } }), 'lite')
  assert.equal(
    resolveDefaultMode({ env: {}, readFile: () => JSON.stringify({ defaultMode: 'off' }) }),
    'off',
  )
  assert.equal(resolveDefaultMode({ env: {}, readFile: () => 'not json' }), 'full')
  assert.equal(resolveDefaultMode({ env: {}, readFile: () => JSON.stringify({ defaultMode: 'review' }) }), 'full')
  assert.equal(resolveDefaultMode({ env: { PONYTAIL_DEFAULT_MODE: 'nonsense' } }), 'full')
})

test('isDeactivationCommand requires the whole message to be the command', () => {
  assert.equal(isDeactivationCommand('stop ponytail'), true)
  assert.equal(isDeactivationCommand('  Normal Mode! '), true)
  assert.equal(isDeactivationCommand('add a normal mode toggle'), false)
  assert.equal(isDeactivationCommand('stop ponytail and then build the cache'), false)
})

test('filterSkillBodyForMode keeps only the active level rows and examples', () => {
  const body = [
    '---',
    'name: ponytail',
    '---',
    '# Ponytail',
    '| Level | What change |',
    '|-------|------------|',
    '| **lite** | name the alternative |',
    '| **full** | ladder enforced |',
    '| **ultra** | YAGNI extremist |',
    '- lite: "Done, cache added."',
    '- full: "@lru_cache on the fetch."',
    '- ultra: "No cache until a profiler says so."',
    '- No unrequested abstractions: keep me.',
  ].join('\n')

  const full = filterSkillBodyForMode(body, 'full')
  assert.match(full, /\*\*full\*\* \| ladder enforced/)
  assert.doesNotMatch(full, /\*\*lite\*\*/)
  assert.doesNotMatch(full, /\*\*ultra\*\*/)
  assert.match(full, /- full: "@lru_cache on the fetch\."/)
  assert.doesNotMatch(full, /- lite:/)
  assert.doesNotMatch(full, /- ultra:/)
  assert.match(full, /- No unrequested abstractions: keep me\./)
  assert.doesNotMatch(full, /name: ponytail/)

  const ultra = filterSkillBodyForMode(body, 'ultra')
  assert.match(ultra, /\*\*ultra\*\* \| YAGNI extremist/)
  assert.doesNotMatch(ultra, /\*\*full\*\*/)
  assert.match(ultra, /- No unrequested abstractions: keep me\./)
})

test('buildModeInstructions drops the ruleset when off and points at review', () => {
  assert.equal(buildModeInstructions({ mode: 'off', skillBody: '# rules' }), '')

  const review = buildModeInstructions({ mode: 'review', skillBody: '# rules' })
  assert.match(review, /^PONYTAIL MODE ACTIVE — level: review\. Behavior defined by the `ponytail-review` skill/)

  const full = buildModeInstructions({ mode: 'full', skillBody: '# The ladder\n\nstop at the first rung' })
  assert.match(full, /^PONYTAIL MODE ACTIVE — level: full\n\n# The ladder/)
  assert.match(full, /stop at the first rung$/)
})

test('buildModeInstructions falls back to the embedded ruleset without a body', () => {
  const instructions = buildModeInstructions({ mode: 'lite', skillBody: undefined })
  assert.equal(instructions, `PONYTAIL MODE ACTIVE — level: lite\n\n${getFallbackInstructions('lite')}`)
  assert.match(instructions, /The ladder/)

  const blank = buildModeInstructions({ mode: 'full', skillBody: '   \n' })
  assert.match(blank, /The ladder/)
})
