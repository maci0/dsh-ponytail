import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill'
import { parseFrontmatter } from '../src/frontmatter.ts'
import { createSkillProvider, discoverSkills } from '../src/skills.ts'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const skillsDir = join(packageRoot, 'skills')

test('parseFrontmatter folds block descriptions and keeps the body', () => {
  const parsed = parseFrontmatter(
    [
      '---',
      'name: ponytail',
      'description: >',
      '  First line of the description',
      '  continues on the next line.',
      'argument-hint: "[lite|full|ultra]"',
      'license: MIT',
      '---',
      '',
      '# Ponytail',
      '',
      'Body text.',
    ].join('\n'),
  )

  assert.equal(parsed.data['name'], 'ponytail')
  // `>` keeps the trailing newline YAML gives a clip-chomped folded scalar.
  assert.equal(
    String(parsed.data['description']).trim(),
    'First line of the description continues on the next line.',
  )
  assert.equal(parsed.data['argument-hint'], '[lite|full|ultra]')
  assert.equal(parsed.data['license'], 'MIT')
  assert.equal(parsed.body, '\n# Ponytail\n\nBody text.')
})

test('parseFrontmatter reads quoted scalars and leaves a bodyless file alone', () => {
  const quoted = parseFrontmatter('---\nname: "x"\ndescription: \'y\'\n---\nb\n')
  assert.equal(quoted.data['name'], 'x')
  assert.equal(quoted.data['description'], 'y')

  const none = parseFrontmatter('# just markdown\n')
  assert.deepEqual(none.data, {})
  assert.equal(none.body, '# just markdown\n')

  // An unterminated delimiter block is treated the same way.
  const unterminated = parseFrontmatter('---\nname: x\n')
  assert.deepEqual(unterminated.data, {})
  assert.equal(unterminated.body, '---\nname: x\n')
})

test('parseFrontmatter reads literal and chomped block scalars', () => {
  const literal = parseFrontmatter('---\nname: x\ndescription: |\n  one\n  two\n---\nbody\n')
  assert.equal(literal.data['description'], 'one\ntwo\n')
  assert.equal(literal.body, 'body\n')

  const stripped = parseFrontmatter('---\nname: x\ndescription: >-\n  one\n  two\n---\nbody\n')
  assert.equal(stripped.data['description'], 'one two')

  const chompedLiteral = parseFrontmatter('---\nname: x\ndescription: |-\n  one\n  two\n---\nbody\n')
  assert.equal(chompedLiteral.data['description'], 'one\ntwo')

  const blockAfterScalar = parseFrontmatter(
    '---\nname: x\ndescription: >\n  folded\nlicense: MIT\n---\nbody\n',
  )
  assert.equal(String(blockAfterScalar.data['description']).trim(), 'folded')
  assert.equal(blockAfterScalar.data['license'], 'MIT')
})

test('parseFrontmatter keeps nested maps and typed scalars', () => {
  const parsed = parseFrontmatter(
    [
      '---',
      'name: nested',
      'description: A usable description.',
      'disable-model-invocation: true',
      'user-invocable: false',
      'metadata:',
      '  author: someone',
      '  tags:',
      '    - a',
      '    - b',
      '---',
      'body',
    ].join('\n'),
  )

  assert.equal(parsed.data['disable-model-invocation'], true)
  assert.equal(parsed.data['user-invocable'], false)
  assert.deepEqual(parsed.data['metadata'], { author: 'someone', tags: ['a', 'b'] })
  assert.equal(parsed.body, 'body')
})

test('parseFrontmatter leaves a malformed block with no keys', () => {
  const parsed = parseFrontmatter('---\nname: [unclosed\ndescription: >\n  x\n---\nbody\n')
  assert.deepEqual(parsed.data, {})
  assert.equal(parsed.body, 'body\n')
})

test('discoverSkills reports and skips a file with no usable description', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ponytail-skills-'))
  try {
    // A nested map where a scalar belongs: `yaml` parses it, and the summary
    // has no description to route on.
    await mkdir(join(root, 'broken'), { recursive: true })
    await writeFile(join(root, 'broken', 'SKILL.md'), '---\nname: broken\ndescription:\n  nested: value\n---\nbody\n')
    await mkdir(join(root, 'fine'), { recursive: true })
    await writeFile(join(root, 'fine', 'SKILL.md'), '---\nname: fine\ndescription: >\n  A usable description.\n---\nbody\n')

    const warnings: string[] = []
    const skills = await discoverSkills(root, (message) => warnings.push(message))

    assert.deepEqual(skills.map((skill) => skill.name), ['fine'])
    assert.equal(warnings.length, 1)
    assert.match(warnings[0] ?? '', /frontmatter has no description/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('discoverSkills reads every bundled skill with a usable description', async () => {
  const skills = await discoverSkills(skillsDir)

  assert.deepEqual(
    skills.map((skill) => skill.name),
    ['ponytail', 'ponytail-audit', 'ponytail-debt', 'ponytail-gain', 'ponytail-help', 'ponytail-review'],
  )
  for (const skill of skills) {
    assert.ok(skill.description.length > 20, `${skill.name} has a description`)
    assert.doesNotMatch(skill.content, /^---/, `${skill.name} body has no frontmatter`)
    assert.equal(skill.metadata['license'] ?? 'MIT', 'MIT')
    assert.equal(skill.metadata['description'], undefined)
    assert.equal(skill.metadata['whenToUse'], undefined)
    assert.deepEqual(skill.invocation, { modelInvocable: true, userInvocable: true })
  }

  const core = skills.find((skill) => skill.name === 'ponytail')
  assert.ok(core)
  assert.match(core.content, /## The ladder/)
  assert.equal(core.metadata['argument-hint'], '[lite|full|ultra]')
  assert.match(core.whenToUse ?? '', /use when the user asks for the lazy/i)
  assert.doesNotMatch(core.whenToUse ?? '', /^Forces/)
})

test('discoverSkills reports and skips an unreadable directory', async () => {
  const warnings: string[] = []
  const skills = await discoverSkills(join(packageRoot, 'does-not-exist'), (message) => warnings.push(message))

  assert.deepEqual(skills, [])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0] ?? '', /cannot read skills directory/)
})

test('the provider lists candidates and loads their bodies', async () => {
  const provider = createSkillProvider({ skillsDir })
  const candidates = await provider.list()

  assert.equal(provider.name, 'ponytail')
  assert.equal(candidates.length, 6)
  for (const candidate of candidates) {
    assert.equal(candidate.rank, BUNDLED_SKILL_RANK)
    assert.equal(candidate.source, 'bundled')
    assert.equal(candidate.provider, 'ponytail')
    assert.equal(candidate.invocation.modelInvocable, true)
    assert.equal(candidate.invocation.userInvocable, true)
    assert.equal(candidate.resourceBase?.kind, 'directory')
  }

  const review = candidates.find((candidate) => candidate.name === 'ponytail-review')
  assert.ok(review)
  const definition = await provider.get(review)
  assert.ok(definition)
  assert.equal(definition.name, 'ponytail-review')
  assert.match(definition.content, /net: -<N> lines possible\./)
  assert.doesNotMatch(definition.content, /^---/)

  const missing = await provider.get({ ...review, locator: join(skillsDir, 'nope', 'SKILL.md') })
  assert.equal(missing, undefined)

  const stale = await provider.get({ ...review, name: 'other-skill' })
  assert.equal(stale, undefined)
})

test('the provider projects the invocation policy and whenToUse', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ponytail-policy-'))
  try {
    await mkdir(join(root, 'model-off'), { recursive: true })
    await writeFile(
      join(root, 'model-off', 'SKILL.md'),
      [
        '---',
        'name: model-off',
        'description: The model must not see this one.',
        'disable-model-invocation: true',
        'whenToUse: Only when the human asks for it.',
        '---',
        'body',
      ].join('\n'),
    )

    await mkdir(join(root, 'human-off'), { recursive: true })
    await writeFile(
      join(root, 'human-off', 'SKILL.md'),
      '---\nname: human-off\ndescription: The human catalog must not list this one.\nuser-invocable: false\n---\nbody\n',
    )
    await mkdir(join(root, 'plain'), { recursive: true })
    await writeFile(
      join(root, 'plain', 'SKILL.md'),
      '---\nname: plain\ndescription: A skill with no invocation flags at all.\n---\nbody\n',
    )

    const provider = createSkillProvider({ skillsDir: root })
    const candidates = await provider.list()
    const byName = new Map(candidates.map((candidate) => [candidate.name, candidate]))

    const modelOff = byName.get('model-off')
    assert.ok(modelOff)
    assert.deepEqual(modelOff.invocation, { modelInvocable: false, userInvocable: true })
    assert.equal(modelOff.whenToUse, 'Only when the human asks for it.')
    // Resolved controls and carried routing guidance are not metadata.
    assert.equal(modelOff.metadata?.['disable-model-invocation'], undefined)
    assert.equal(modelOff.metadata?.['whenToUse'], undefined)

    const humanOff = byName.get('human-off')
    assert.ok(humanOff)
    assert.deepEqual(humanOff.invocation, { modelInvocable: true, userInvocable: false })

    const plain = byName.get('plain')
    assert.ok(plain)
    assert.deepEqual(plain.invocation, { modelInvocable: true, userInvocable: true })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the provider settles on an aborted lookup without reading the tree', async () => {
  const provider = createSkillProvider({ skillsDir })
  const controller = new AbortController()
  controller.abort()

  assert.deepEqual(await provider.list({ signal: controller.signal }), [])

  const candidates = await provider.list()
  const first = candidates[0]
  assert.ok(first)
  assert.equal(await provider.get(first, { signal: controller.signal }), undefined)
})

test('a skill whose frontmatter name breaks the grammar is skipped', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ponytail-name-'))
  try {
    await mkdir(join(root, 'skill'), { recursive: true })
    await writeFile(
      join(root, 'skill', 'SKILL.md'),
      '---\nname: not_a_skill\ndescription: A description that exists.\n---\nbody\n',
    )
    const warnings: string[] = []
    const discovered = await discoverSkills(root, (message) => warnings.push(message))

    assert.deepEqual(discovered, [])
    assert.equal(warnings.length, 1)
    assert.match(warnings[0] ?? '', /is not a valid kebab-case skill name/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
