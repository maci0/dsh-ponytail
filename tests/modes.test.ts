import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildModeInstructions,
  filterSkillBodyForMode,
  isDeactivationCommand,
  normalizeCommandMode,
  normalizeMode,
  resolveDefaultMode,
} from '../src/modes.ts'

test('normalizeMode accepts only runtime levels', () => {
  assert.equal(normalizeMode('ULTRA'), 'ultra')
  assert.equal(normalizeMode('  off '), 'off')
  assert.equal(normalizeMode('review'), undefined)
  assert.equal(normalizeMode(''), undefined)
  assert.equal(normalizeMode(42), undefined)
})

test('normalizeCommandMode accepts the session-only review level', () => {
  assert.equal(normalizeCommandMode('review'), 'review')
  assert.equal(normalizeCommandMode('Full'), 'full')
  assert.equal(normalizeCommandMode('shrug'), undefined)
})

test('resolveDefaultMode takes a configured level and falls back to full', () => {
  assert.equal(resolveDefaultMode('ultra'), 'ultra')
  assert.equal(resolveDefaultMode(undefined), 'full')
  assert.equal(resolveDefaultMode('nonsense'), 'full')
  assert.equal(resolveDefaultMode('review'), 'full')
})

test('isDeactivationCommand requires the whole message to be the command', () => {
  assert.equal(isDeactivationCommand('stop ponytail'), true)
  assert.equal(isDeactivationCommand('  Normal Mode! '), true)
  assert.equal(isDeactivationCommand('add a normal mode toggle'), false)
  assert.equal(isDeactivationCommand('stop ponytail and then build the cache'), false)
})

test('filterSkillBodyForMode keeps only the active level rows and examples', () => {
  const body = [
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
