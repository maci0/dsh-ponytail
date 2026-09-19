/**
 * YAML-frontmatter reader for the bundled `SKILL.md` files.
 *
 * A frontmatter block is dominated by one shape: a flat mapping of
 * `key: value` entries carrying plain, quoted, or block scalars. This module
 * reads that shape by hand, because the alternative — handing every block to
 * `yaml` — pulls the whole parser into the boot path of the plugin, where it is
 * the single largest cost of mounting. Anything the reader cannot prove it
 * would transcribe exactly is handed to `yaml`, the same parser the upstream
 * filesystem provider uses, through a dynamic `import`, so this reader accepts
 * exactly what the registry accepts and the parser is loaded only by a document
 * that actually needs it: plain scalars, quoted scalars, folded (`>`, `>-`) and
 * literal (`|`, `|-`) block scalars, and nested maps. A missing or malformed
 * block yields no keys and leaves the whole source as the body rather than
 * throwing: `discoverSkills` reports the consequence (no description) and
 * keeps every other skill.
 *
 * @module dsh-ponytail/frontmatter
 */

/** Parsed frontmatter plus the markdown body that follows it. */
interface Frontmatter {
  readonly data: Readonly<Record<string, unknown>>
  /** Everything after the closing delimiter, or the whole source when absent. */
  readonly body: string
}

const FRONTMATTER_BLOCK = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

/**
 * A mapping key this reader can prove `yaml` resolves to the same string: a
 * letter or underscore first, because a leading digit or sign could resolve to
 * a number, and none of the indicator characters that would open a tag,
 * anchor, alias, flow node, or quoted key.
 */
const PLAIN_KEY = /^([A-Za-z_][A-Za-z0-9_.-]*):(?:[ \t](.*))?$/

/**
 * Code points JavaScript's `trim`/`trimStart` strip but YAML counts as content:
 * a block scalar's indentation is measured from them here, so a block holding
 * one cannot be read line by line and goes to `yaml`.
 */
const JS_ONLY_SPACE = /[\u000B\u000C\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]/

/**
 * The plain-scalar spellings `yaml` resolves to something other than their own
 * text. Only the YAML 1.2 core schema spellings: `yes`, `on`, `y`, and `no`
 * are plain strings there, and every numeric, timestamp, and `.inf`/`.nan`
 * form starts with a character this pattern excludes.
 */
const TYPED_WORDS: ReadonlyMap<string, unknown> = new Map([
  ['null', null],
  ['Null', null],
  ['NULL', null],
  ['true', true],
  ['True', true],
  ['TRUE', true],
  ['false', false],
  ['False', false],
  ['FALSE', false],
])

/**
 * Plain scalars this reader returns verbatim. The leading character rules out
 * every typed form above; the character set excludes the indicators that change
 * how the line is read — `:` opening a nested value, `#` after a space opening
 * a comment, tabs, quotes, and flow brackets — so a match is always literal
 * text.
 */
const PLAIN_TEXT = /^[A-Za-z_][A-Za-z0-9 _.'()/,-]*$/

/**
 * Block scalar header: the style indicator and the optional strip flag. The
 * keep indicator (`+`, and any explicit indentation digit) is left out on
 * purpose: a header this pattern rejects falls through to `yaml`, which is the
 * only way to prove what a keep-chomped body keeps.
 */
const BLOCK_HEADER = /^([|>])(-)?$/

/** A complete single-line single-quoted scalar, with `''` as the only escape. */
const SINGLE_QUOTED = /^'((?:[^']|'')*)'$/

/** A complete single-line double-quoted scalar with no escape to decode. */
const DOUBLE_QUOTED = /^"([^"\\]*)"$/

/**
 * The real parser, loaded by the first document this reader cannot prove.
 * Cached after the first load: a rejected load is dropped so a later document
 * can try again instead of inheriting one transient failure.
 */
let yaml: Promise<typeof import('yaml')> | undefined

function loadYaml(): Promise<typeof import('yaml')> {
  yaml ??= import('yaml').catch((error: unknown) => {
    yaml = undefined
    throw error
  })
  return yaml
}

/**
 * Split a document into its frontmatter block and the body that follows it.
 *
 * Pure text, no parsing: the body is the same either way, so a caller that
 * needs only the body — the always-on ruleset, read once at mount — never
 * touches a parser at all.
 * @param source - full file contents.
 * @returns the block's lines and the remaining body.
 */
export function splitFrontmatter(source: string): { readonly block: string, readonly body: string } {
  const text = source.replace(/^\uFEFF/, '')
  const match = FRONTMATTER_BLOCK.exec(text)
  if (match === null) return { block: '', body: text }

  // The body keeps its own bytes apart from line terminators, which are
  // normalized to `\n`.
  return { block: match[1] ?? '', body: text.slice(match[0].length).replace(/\r\n/g, '\n') }
}

/**
 * Parse leading YAML frontmatter from a markdown document.
 * @param source - full file contents.
 * @returns the parsed keys and the remaining body.
 */
export async function parseFrontmatter(source: string): Promise<Frontmatter> {
  const { block, body } = splitFrontmatter(source)
  return { data: await parseBlock(block), body }
}

/**
 * Parse one frontmatter block, tolerating a malformed or non-mapping one.
 * @returns the parsed mapping, or an empty one.
 */
async function parseBlock(block: string): Promise<Record<string, unknown>> {
  if (block.trim() === '') return {}
  const flat = readFlatBlock(block)
  if (flat !== undefined) return flat
  try {
    const { parse } = await loadYaml()
    const data: unknown = parse(block)
    if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
      return data as Record<string, unknown>
    }
  } catch {
    // A malformed block is a skipped skill, not a failed mount.
  }
  return {}
}

/**
 * Read the flat-mapping shape this module understands.
 *
 * Every construct that is not a top-level `key: value` entry with a scalar
 * value — an indented line, an unindented scalar, a duplicate key (which
 * `yaml` rejects), a `__proto__` key (which would set a prototype), a carriage
 * return anywhere (a line break to `yaml`, and one the delimiter regex never
 * promised to place), or a value shape below —
 * returns `undefined` so the caller hands the whole block to `yaml`.
 */
function readFlatBlock(block: string): Record<string, unknown> | undefined {
  // Refused even for `\r\n`: the reader can prove where it splits the block,
  // but not that `yaml` breaks every carriage return in the same place.
  if (block.includes('\r')) return undefined
  // `trimStart` would measure a block scalar's indentation through these, and
  // YAML would not: any of them means the real parser decides.
  if (JS_ONLY_SPACE.test(block)) return undefined
  // A tab is never indentation, and inside a folded body YAML treats a
  // tab-leading content line as more indented: not this reader's to fold.
  if (block.includes('\t')) return undefined

  const lines = block.split(/\r\n|\n/)
  const data: Record<string, unknown> = {}

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line === '') continue
    if (line.startsWith(' ') || line.startsWith('\t')) return undefined

    const entry = PLAIN_KEY.exec(line)
    if (entry === null) return undefined
    const key = entry[1] ?? ''
    // `yaml` rejects a repeated key, resolves a typed word to something other
    // than its own text, and would set a prototype on `__proto__`; the real
    // parser has to say so for all three.
    if (key === '__proto__' || TYPED_WORDS.has(key) || Object.hasOwn(data, key)) return undefined

    // Trailing white space is separation, not content.
    const value = (entry[2] ?? '').replace(/[ \t]+$/, '')
    if (value === '') {
      data[key] = null
      continue
    }

    const header = BLOCK_HEADER.exec(value)
    if (header !== null) {
      const scalar = readBlockScalar(lines, index + 1, header[1] === '|', header[2] === '-')
      if (scalar === undefined) return undefined
      data[key] = scalar.text
      index = scalar.next - 1
      continue
    }

    if (value.startsWith("'")) {
      const quoted = SINGLE_QUOTED.exec(value)
      if (quoted === null) return undefined
      data[key] = (quoted[1] ?? '').replace(/''/g, "'")
      continue
    }
    if (value.startsWith('"')) {
      const quoted = DOUBLE_QUOTED.exec(value)
      if (quoted === null) return undefined
      data[key] = quoted[1] ?? ''
      continue
    }

    if (TYPED_WORDS.has(value)) {
      data[key] = TYPED_WORDS.get(value)
      continue
    }
    if (!PLAIN_TEXT.test(value)) return undefined
    data[key] = value
  }

  return data
}

/**
 * Count the spaces a line starts with. YAML indentation is spaces; a tab or a
 * code point JS would treat as blank is not this reader's to interpret.
 */
function leadingSpaces(line: string): number {
  let count = 0
  while (count < line.length && line.charCodeAt(count) === 32) count += 1
  return count
}

/**
 * Read one block scalar body.
 *
 * Only the shape `yaml` folds without surprises is accepted: every content line
 * indented by the same positive number of spaces, no leading blank line, no
 * tab in the indentation, and no line that is only white space (which keeps its
 * own bytes instead of folding). Trailing blank lines are chomped away by both
 * `|` and `>` without the `+` indicator, so they are dropped here.
 * @param literal - `true` for `|`, `false` for `>`.
 * @param stripped - `true` for the `-` chomping indicator.
 * @returns the scalar text and the index after its body, or `undefined` when
 * `yaml` must decide.
 */
function readBlockScalar(
  lines: readonly string[],
  start: number,
  literal: boolean,
  stripped: boolean,
): { readonly text: string, readonly next: number } | undefined {
  let next = start
  while (next < lines.length) {
    const line = lines[next] ?? ''
    if (line !== '' && !line.startsWith(' ')) break
    next += 1
  }

  const body = lines.slice(start, next)
  while (body.length > 0 && body[body.length - 1] === '') body.pop()

  const first = body[0]
  if (first === undefined) return { text: '', next }

  // Indentation is spaces only: a tab, or anything `yaml` counts as content,
  // means this reader cannot prove where the body starts.
  const indent = leadingSpaces(first)
  if (indent === 0) return undefined

  const content: string[] = []
  for (const line of body) {
    if (line === '') {
      content.push('')
      continue
    }
    const lead = leadingSpaces(line)
    if (lead !== indent || line.length === indent) return undefined
    content.push(line.slice(indent))
  }

  let text = ''
  if (literal) text = content.join('\n')
  else {
    // Folding replaces the break between two content lines with a space, and
    // every run of `blank` blank lines between them with that many newlines.
    let blanks = 0
    for (const line of content) {
      if (line === '') {
        blanks += 1
        continue
      }
      if (text !== '') text += blanks === 0 ? ' ' : '\n'.repeat(blanks)
      blanks = 0
      text += line
    }
  }

  if (text !== '' && !stripped) text += '\n'
  return { text, next }
}
