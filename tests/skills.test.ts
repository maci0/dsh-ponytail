import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { parse } from 'yaml'
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill'
import { parseFrontmatter } from '../src/frontmatter.ts'
import { createSkillProvider, discoverSkills } from '../src/skills.ts'

const run = promisify(execFile)
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const skillsDir = join(packageRoot, 'skills')

test('parseFrontmatter folds block descriptions and keeps the body', async () => {
  const parsed = await parseFrontmatter(
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

test('parseFrontmatter reads quoted scalars and leaves a bodyless file alone', async () => {
  const quoted = await parseFrontmatter('---\nname: "x"\ndescription: \'y\'\n---\nb\n')
  assert.equal(quoted.data['name'], 'x')
  assert.equal(quoted.data['description'], 'y')

  const none = await parseFrontmatter('# just markdown\n')
  assert.deepEqual(none.data, {})
  assert.equal(none.body, '# just markdown\n')

  // An unterminated delimiter block is treated the same way.
  const unterminated = await parseFrontmatter('---\nname: x\n')
  assert.deepEqual(unterminated.data, {})
  assert.equal(unterminated.body, '---\nname: x\n')
})

test('parseFrontmatter handles CRLF files', async () => {
  const parsed = await parseFrontmatter('---\r\nname: x\r\ndescription: y\r\n---\r\nbody\r\n')
  assert.equal(parsed.data['name'], 'x')
  assert.equal(parsed.data['description'], 'y')
  assert.equal(parsed.body, 'body\n')

  // CRLF delimiters alone are not enough — an unterminated block keeps the
  // whole source as the body.
  const unterminated = await parseFrontmatter('---\r\nname: x\r\n')
  assert.deepEqual(unterminated.data, {})
  assert.equal(unterminated.body, '---\r\nname: x\r\n')
})

test('parseFrontmatter reads literal and chomped block scalars', async () => {
  const literal = await parseFrontmatter('---\nname: x\ndescription: |\n  one\n  two\n---\nbody\n')
  assert.equal(literal.data['description'], 'one\ntwo\n')
  assert.equal(literal.body, 'body\n')

  const stripped = await parseFrontmatter('---\nname: x\ndescription: >-\n  one\n  two\n---\nbody\n')
  assert.equal(stripped.data['description'], 'one two')

  const chompedLiteral = await parseFrontmatter('---\nname: x\ndescription: |-\n  one\n  two\n---\nbody\n')
  assert.equal(chompedLiteral.data['description'], 'one\ntwo')

  const blockAfterScalar = await parseFrontmatter(
    '---\nname: x\ndescription: >\n  folded\nlicense: MIT\n---\nbody\n',
  )
  assert.equal(String(blockAfterScalar.data['description']).trim(), 'folded')
  assert.equal(blockAfterScalar.data['license'], 'MIT')
})

test('parseFrontmatter keeps nested maps and typed scalars', async () => {
  const parsed = await parseFrontmatter(
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

test('parseFrontmatter leaves a malformed block with no keys', async () => {
  const parsed = await parseFrontmatter('---\nname: [unclosed\ndescription: >\n  x\n---\nbody\n')
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

test('a repeated provider list reuses one discovery instead of re-reading the tree', { timeout: 120_000 }, async () => {
  // The catalog of a packaged `skills/` tree cannot change under the provider,
  // so a second `list()` must not pay for a second readdir + read + YAML parse
  // of every SKILL.md. The counter is CPU time, which includes those syscalls;
  // the band is loose because a loaded machine may bill more per call, and the
  // uncached shape is ~100x higher, so the guard survives the noise.
  const provider = createSkillProvider({ skillsDir })
  await provider.list()

  const calls = 3000
  const budget = 120_000 // microseconds: recorded p50 was 7ms for this workload
  const before = process.cpuUsage()
  let last: readonly unknown[] = []
  for (let i = 0; i < calls; i += 1) last = await provider.list()
  const used = process.cpuUsage(before)
  const perCall = (used.user + used.system) / calls

  assert.equal(last.length, 6, 'the cached call still reports the whole catalog')
  assert.ok(
    perCall < budget / calls,
    `${calls} repeated list() calls cost ${(used.user + used.system).toFixed(0)}us; `
    + `a catalog that is re-discovered per call costs tens of ms`,
  )
})

/**
 * The reader this module replaced, kept as the reference: the same delimiter
 * regex with the whole block handed to `yaml`. The fast path in `frontmatter`
 * exists only to avoid that call, so it has to agree with it everywhere.
 * @param source - full file contents.
 * @returns the parsed keys and the remaining body, per `yaml`.
 */
function referenceFrontmatter(source: string): { data: Record<string, unknown>, body: string } {
  const text = source.replace(/^\uFEFF/, '')
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  if (match === null) return { data: {}, body: text }
  const body = text.slice(match[0].length).replace(/\r\n/g, '\n')
  const block = match[1] ?? ''
  if (block.trim() === '') return { data: {}, body }
  try {
    const parsed: unknown = parse(block)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { data: parsed as Record<string, unknown>, body }
    }
  } catch {
    // A malformed block is a skipped skill, not a failed mount.
  }
  return { data: {}, body }
}

/**
 * Blocks the fast reader takes, and blocks it must refuse so `yaml` decides:
 * nested maps, sequences, typed scalars, duplicate keys, lone carriage returns,
 * tabs, leading blank lines, and more- or less-indented block bodies.
 */
const FRONTMATTER_BLOCKS = [
  '',
  'name: x',
  'name: x\n\ndescription: y',
  'A-B_c.1: x\nlicense: MIT',
  'name: "quoted"\ndescription: \'single\'',
  "k: ''",
  'k: "it\'s fine"',
  "k: 'it''s fine'",
  'k: A usable description.',
  'k: a, b (c) - d/e',
  'k: yes\nl: on\nm: y',
  'k: true\nl: FALSE\nm: Null\nn: ~',
  'k: 1\nl: 007\nm: 0x10\nn: 1e3',
  'k: café naïve',
  'k: x#y\nl: x:y\nm: a\\b',
  'k:',
  'k: ',
  'k: >\n  one\n  two',
  'k: >-\n  one\n  two',
  'k: |\n  one\n  two',
  'k: |-\n  one\n  two',
  'k: >\n  a\n\n  b\nl: y',
  'k: |\n  a\n\n  b',
  'k: |\n  a  \n  b',
  'k: >\n  a  \n  b',
  'k: |\n    deep\n    deep',
  'k: |\n  a\tb',
  'k: >\nl: y',
  'k: >\n  a: b',
  'k: > # comment',
  'k: |+\n  a',
  'k: >\n\n  a',
  'k: >\n  a\n   b\n  c',
  'k: |\n  a\n   \n  b',
  'name: nested\nmetadata:\n  author: someone\n  tags:\n    - a',
  'name: [unclosed\ndescription: >\n  x',
  'a: 1\na: 2',
  '__proto__: x',
  'just a scalar',
  '- a\n- b',
  'k: x\r\nl: y',
  'k: x\rl: y',
  'k: |\r\n  a\r\n  b\r\n',
]

test('the fast reader and the real parser agree on every shape', async () => {
  const docs = FRONTMATTER_BLOCKS.map((block) => `---\n${block}\n---\nbody\n`)
  for (const entry of await readdir(skillsDir)) {
    const source = await readFile(join(skillsDir, entry, 'SKILL.md'), 'utf8')
    docs.push(source, source.replace(/\n/g, '\r\n'), `\uFEFF${source}`)
  }

  for (const doc of docs) {
    assert.deepStrictEqual(
      await parseFrontmatter(doc),
      referenceFrontmatter(doc),
      `reader disagrees with yaml on ${JSON.stringify(doc.slice(0, 60))}`,
    )
  }
})

test('a flat frontmatter block never loads the real YAML parser', { timeout: 120_000 }, async () => {
  // The counter is module-load work, not time: the child registers a load hook
  // that counts every `yaml` module the graph pulls in. Before this reader had
  // a fast path, `import { parse } from 'yaml'` put all 72 of them in the graph
  // at import time, before a single block was read.
  const frontmatterUrl = new URL('../src/frontmatter.ts', import.meta.url).href
  const script = [
    "import { registerHooks } from 'node:module'",
    "import { readFile, readdir } from 'node:fs/promises'",
    "import { join } from 'node:path'",
    'let yamlLoads = 0',
    'registerHooks({',
    '  load(url, context, nextLoad) {',
    "    if (url.includes('node_modules/yaml/')) yamlLoads += 1",
    '    return nextLoad(url, context)',
    '  },',
    '})',
    `const { parseFrontmatter } = await import(${JSON.stringify(frontmatterUrl)})`,
    'const atImport = yamlLoads',
    `const names = await readdir(${JSON.stringify(skillsDir)})`,
    'for (const name of names) {',
    `  await parseFrontmatter(await readFile(join(${JSON.stringify(skillsDir)}, name, 'SKILL.md'), 'utf8'))`,
    '}',
    'const afterFlat = yamlLoads',
    "await parseFrontmatter('---\\nname: x\\nmetadata:\\n  a: b\\n---\\nbody\\n')",
    'console.log(JSON.stringify({ atImport, afterFlat, afterNested: yamlLoads, skills: names.length }))',
  ].join('\n')

  const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script], {
    cwd: packageRoot,
    timeout: 60_000,
  })
  const counts = JSON.parse(stdout) as { atImport: number, afterFlat: number, afterNested: number, skills: number }

  assert.equal(counts.skills, 6, 'the child read the whole bundled catalog')
  assert.equal(counts.atImport, 0, 'importing the reader must not pull in `yaml`')
  assert.equal(counts.afterFlat, 0, 'every bundled skill is a flat block this reader proves')
  assert.ok(counts.afterNested > 0, 'a nested map still reaches the real parser')
})

/**
 * Whole documents an adversarial review used to break the fast path, or whose
 * shape the reader must refuse instead of guessing. Every entry is checked
 * against `yaml` on the same block, so an entry that only passes because the
 * reader's own proof is wrong is not a pass.
 */
const ADVERSARIAL_DOCUMENTS = [
  // Keep-chomping (`+`) keeps trailing breaks, which clip handling alone
  // cannot produce; the same header with an indentation digit is also refused.
  '---\nname: a\ntext: |+\n  line1\n\n\n---\nBODY\n',
  '---\nname: a\ntext: >+\n  line1\n\n\n---\nBODY\n',
  '---\nname: a\ntext: |+2\n  line1\n\n\n---\nBODY\n',
  // Carriage returns: lone inside a value, whole-file CRLF, CRLF inside a
  // block scalar body, and CRLF on a keep-chomped body.
  '---\nname: a\ndescription: cars\rcrash\n---\nBODY\n',
  '---\r\nname: x\r\ndescription: y\r\n---\r\nbody\r\n',
  '---\nname: x\ndescription: |\r\n  a\r\n  b\r\n---\nbody\n',
  '---\r\nname: x\r\ntext: |+\r\n  a\r\n\r\n---\r\nbody\r\n',
  // Nested maps, sequences, flow collections.
  '---\nname: x\nmetadata:\n  author: someone\n  tags:\n    - a\n    - b\n---\nb\n',
  '---\nname: x\ntags:\n  - a\n  - b\n---\nb\n',
  '---\nname: x\nk: {a: 1}\nl: [1, 2]\n---\nb\n',
  // Duplicate keys, `__proto__`, quoted keys.
  '---\na: 1\na: 2\n---\nb\n',
  '---\n__proto__: x\n---\nb\n',
  '---\n\'qk\': v\n"q2": w\n---\nb\n',
  // Scalars `yaml` resolves to something other than their own text.
  '---\nv: 0x10\nw: 0o17\n---\nb\n',
  '---\nv: .inf\nw: .nan\n---\nb\n',
  '---\nv: 1_000\nw: 2001-12-14\n---\nb\n',
  '---\nname: x\nv: 1e3\nw: 007\n---\nb\n',
  // A colon inside a value, and `---` inside a value.
  '---\nname: x\ndescription: a: b\n---\nb\n',
  '---\nname: x\ndescription: x---y\n---\nb\n',
  '---\nname: x\nk: >\n  a\n  ---\n  b\n---\nb\n',
  // Block bodies the reader must refuse: tab indent, deeper than the first
  // line, white-space-only line, and a leading blank line.
  '---\nname: x\nk: |\n\ta\n---\nb\n',
  '---\nname: x\nk: |\n    a\n    b\n---\nb\n',
  '---\nname: x\nk: |\n  a\n    b\n---\nb\n',
  '---\nname: x\nk: |\n   \n  a\n---\nb\n',
  '---\nname: x\nk: |\n\n  a\n---\nb\n',
  // Code points JS `trim` strips but YAML counts as content: the indentation of
  // a block scalar cannot be measured through them, so the whole block goes to
  // `yaml` (U+00A0, U+000B, U+000C, U+2028, U+FEFF, U+3000).
  '---\nname: a\ndescription: |\n \u00A0x\n---\nbody\n',
  '---\nname: a\ndescription: |\n \u000Bx\n---\nbody\n',
  '---\nname: a\ndescription: |\n \u000Cx\n---\nbody\n',
  '---\nname: a\ndescription: |\n \u2028x\n---\nbody\n',
  '---\nname: a\ndescription: |\n \u3000x\n---\nbody\n',
  '---\nname: a\ndescription: |\n \uFEFFx\n---\nbody\n',
  '---\nname: a\nv:\u00A0x\n---\nbody\n',
  // Delimiter corner cases: leading blank line, empty block, BOM, unclosed
  // frontmatter, and a document that is only a body.
  '---\n\nname: x\n---\nb\n',
  '---\n---\nb\n',
  '---\n\n---\nb\n',
  '\uFEFF---\nname: x\n---\nb\n',
  '---\nname: x\n',
  '---\nname: x',
  '---\r\nname: x\r\n',
  'body only\n',
]

test('the reader never diverges from yaml on an adversarial document', async () => {
  for (const doc of ADVERSARIAL_DOCUMENTS) {
    assert.deepStrictEqual(
      await parseFrontmatter(doc),
      referenceFrontmatter(doc),
      `reader disagrees with yaml on ${JSON.stringify(doc)}`,
    )
  }
})

test('keep-chomped and carriage-returned blocks take the value yaml gives', async () => {
  // Both shapes were once accepted by the fast path and transcribed wrong: `|+`
  // dropped a kept break, and a `\r` in the block made the reader throw.
  const chomped = await parseFrontmatter('---\nname: a\ntext: |+\n  line1\n\n\n---\nBODY\n')
  assert.deepStrictEqual(chomped.data['text'], parse('text: |+\n  line1\n\n')['text'])
  assert.equal(chomped.data['text'], 'line1\n\n')

  const carried = await parseFrontmatter('---\nname: a\ndescription: cars\rcrash\n---\nBODY\n')
  assert.deepStrictEqual(carried.data['description'], parse('description: cars\rcrash')['description'])
  assert.equal(carried.body, 'BODY\n')
})
