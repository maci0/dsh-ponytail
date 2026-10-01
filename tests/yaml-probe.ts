/**
 * Child-process probe for the frontmatter fast path, run by `skills.test.ts`
 * with the test runner's own executable. It needs a process of its own: the
 * counter is the module registry, and `bun test` shares one process across
 * test files, some of which import `yaml` directly.
 *
 * The counter is module-load work, not time: `yaml` resolves to its CommonJS
 * build, so every file it loads lands in `require.cache`. Before this reader
 * had a fast path, importing it put all of `yaml` in the graph at once.
 *
 * Prints `{ atImport, afterFlat, afterNested, skills }` as JSON on stdout.
 */

import { createRequire } from 'node:module'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const skillsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')

/** Count the `yaml` package files this process has loaded so far. */
function yamlLoads(): number {
  return Object.keys(require.cache).filter((path) => /node_modules[/\\]yaml[/\\]/.test(path)).length
}

const { parseFrontmatter } = await import('../src/frontmatter.ts')
const atImport = yamlLoads()
const names = await readdir(skillsDir)
for (const name of names) {
  await parseFrontmatter(await readFile(join(skillsDir, name, 'SKILL.md'), 'utf8'))
}
const afterFlat = yamlLoads()
await parseFrontmatter('---\nname: x\nmetadata:\n  a: b\n---\nbody\n')
console.log(JSON.stringify({ atImport, afterFlat, afterNested: yamlLoads(), skills: names.length }))
