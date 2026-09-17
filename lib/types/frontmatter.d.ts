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
/** Parsed frontmatter plus the markdown body that follows it. */
interface Frontmatter {
    /** Frontmatter keys and their YAML-parsed values. */
    readonly data: Readonly<Record<string, unknown>>;
    /** Everything after the closing delimiter, or the whole source when absent. */
    readonly body: string;
}
/**
 * Parse leading YAML frontmatter from a markdown document.
 * @param source - full file contents.
 * @returns the parsed keys and the remaining body.
 */
export declare function parseFrontmatter(source: string): Frontmatter;
export {};
