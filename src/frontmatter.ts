/**
 * YAML-frontmatter reader for the bundled `SKILL.md` files.
 *
 * The block between the delimiters is handed to `yaml`, the same parser the
 * upstream filesystem provider uses, so this reader accepts exactly what the
 * registry accepts: plain scalars, quoted scalars, folded (`>`, `>-`) and
 * literal (`|`, `|-`) block scalars, and nested maps. A missing or malformed
 * block yields no keys and leaves the whole source as the body rather than
 * throwing: `discoverSkills` reports the consequence (no description) and
 * keeps every other skill.
 *
 * @module dsh-ponytail/frontmatter
 */

import { parse } from 'yaml'

/** Parsed frontmatter plus the markdown body that follows it. */
export interface Frontmatter {
  /** Frontmatter keys and their YAML-parsed values. */
  readonly data: Readonly<Record<string, unknown>>
  /** Everything after the closing delimiter, or the whole source when absent. */
  readonly body: string
}

const DELIMITER = /^---[ \t]*$/

/**
 * Parse leading YAML frontmatter from a markdown document.
 * @param source - full file contents.
 * @returns the parsed keys and the remaining body.
 */
export function parseFrontmatter(source: string): Frontmatter {
  const text = source.replace(/^\uFEFF/, '')
  const lines = text.split(/\r?\n/)

  if (lines[0] === undefined || !DELIMITER.test(lines[0])) {
    return { data: {}, body: text }
  }

  let closing = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (DELIMITER.test(lines[index] ?? '')) {
      closing = index
      break
    }
  }
  if (closing === -1) {
    return { data: {}, body: text }
  }

  const block = lines.slice(1, closing).join('\n')
  return { data: parseBlock(block), body: lines.slice(closing + 1).join('\n') }
}

/**
 * Parse one frontmatter block, tolerating a malformed or non-mapping one.
 * @param block - frontmatter lines without their delimiters.
 * @returns the parsed mapping, or an empty one.
 */
function parseBlock(block: string): Record<string, unknown> {
  if (block.trim() === '') return {}
  try {
    const data: unknown = parse(block)
    if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
      return data as Record<string, unknown>
    }
  } catch {
    // A malformed block is a skipped skill, not a failed mount.
  }
  return {}
}
