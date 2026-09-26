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
import { apply } from '../src/index.ts'

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

test('the injected section reuses one filtered ruleset per level', { timeout: 120_000 }, () => {
  // `assemble` resolves the section text on every request, and the body is
  // read once at load, so repeated assemblies at one level must not re-filter
  // it. The counter is CPU time over many assemblies: a memoized section costs
  // ~0.1us per call, a re-filtered one ~10us, so the band holds on a loaded
  // machine while still failing if the memo disappears.
  const sections: { text: string | (() => string) }[] = []
  const services: Record<string, unknown> = {
    systemPrompt: { section: (section: unknown) => { sections.push(section as { text: () => string }); return () => {} } },
    skills: { registerProvider: () => () => {} },
    tools: { register: () => () => {} },
    commands: { register: () => () => {} },
    settings: {
      update: async () => {},
    },
  }
  const ctx = {
    inject: (deps: readonly string[], callback: (scope: unknown) => void) => {
      const scope: Record<string, unknown> = { ...ctx }
      for (const dep of deps) scope[dep] = services[dep]
      callback(scope)
      return () => {}
    },
    get: (service: string) => services[service],
    on: () => () => {},
    ...services,
  }
  apply(ctx as never)

  const section = sections[0]
  assert.ok(section, 'the plugin registers one system-prompt section')
  const text = section.text as () => string
  text()

  const calls = 20_000
  const budget = 60_000 // microseconds: recorded p50 ~2.9ms, uncached ~190ms
  const before = process.cpuUsage()
  let rendered = ''
  for (let i = 0; i < calls; i += 1) rendered = text()
  const used = process.cpuUsage(before)
  const perCall = (used.user + used.system) / calls

  assert.match(rendered, /^PONYTAIL MODE ACTIVE — level: full\n\n/)
  assert.ok(
    perCall < budget / calls,
    `${calls} assemblies cost ${(used.user + used.system).toFixed(0)}us; `
    + 'a section that re-filters the body per assembly costs tens of milliseconds',
  )
})
