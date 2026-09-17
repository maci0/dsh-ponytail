/**
 * Real-composition check: the plugin mounts into a live Cordis context next to
 * the real skill registry, contributes its six bundled skills, and gives the
 * registry back on disposal.
 *
 * Only `@deepseek-ai/cordis` and `@deepseek-ai/dsh-skill` are mounted here; the
 * other services the plugin injects (`systemPrompt`, `tools`, `commands`,
 * `settings`) are optional, so their callbacks simply never run. That is also
 * why the six skills are the assertion: if the `skills` injection did not
 * resolve, the catalog would be empty and this test would fail.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as Ponytail from '../src/index.ts'

test('the six bundled skills mount into a real skill registry and leave on dispose', async () => {
  const ctx = new Context()
  await ctx.plugin(SkillRegistry as never, {} as never)

  // The plugin module's `apply` takes the structural `HostContext` this package
  // declares, which the real context satisfies; the cast bridges that structural
  // view to the framework's own plugin type.
  const fiber = await ctx.plugin(Ponytail.apply as never, {} as never)
  const listed = await ctx.skills.list()

  assert.deepEqual(listed.map((skill) => skill.name), [
    'ponytail',
    'ponytail-audit',
    'ponytail-debt',
    'ponytail-gain',
    'ponytail-help',
    'ponytail-review',
  ])
  for (const skill of listed) {
    assert.equal(skill.provider, 'ponytail')
    assert.equal(skill.source, 'bundled')
  }
  const core = listed.find((skill) => skill.name === 'ponytail')
  assert.ok(core)
  assert.match(core.whenToUse ?? '', /use when the user asks for the lazy/i)

  const loaded = await ctx.skills.get('ponytail')
  assert.ok(loaded)
  assert.match(loaded.content, /## The ladder/)
  assert.doesNotMatch(loaded.content, /^---/)

  await fiber.dispose()
  assert.deepEqual(await ctx.skills.list(), [])
})
