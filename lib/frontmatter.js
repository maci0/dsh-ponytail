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
import { parse } from 'yaml';
const FRONTMATTER_BLOCK = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
/**
 * Parse leading YAML frontmatter from a markdown document.
 * @param source - full file contents.
 * @returns the parsed keys and the remaining body.
 */
export function parseFrontmatter(source) {
    const text = source.replace(/^\uFEFF/, '');
    const match = FRONTMATTER_BLOCK.exec(text);
    if (match === null)
        return { data: {}, body: text };
    // The body keeps its own bytes apart from line terminators, which are
    // normalized to `\n`.
    const body = text.slice(match[0].length).replace(/\r\n/g, '\n');
    return { data: parseBlock(match[1] ?? ''), body };
}
/**
 * Parse one frontmatter block, tolerating a malformed or non-mapping one.
 * @param block - frontmatter lines without their delimiters.
 * @returns the parsed mapping, or an empty one.
 */
function parseBlock(block) {
    if (block.trim() === '')
        return {};
    try {
        const data = parse(block);
        if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
            return data;
        }
    }
    catch {
        // A malformed block is a skipped skill, not a failed mount.
    }
    return {};
}
