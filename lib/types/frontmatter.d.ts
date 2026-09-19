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
    readonly data: Readonly<Record<string, unknown>>;
    /** Everything after the closing delimiter, or the whole source when absent. */
    readonly body: string;
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
export declare function splitFrontmatter(source: string): {
    readonly block: string;
    readonly body: string;
};
/**
 * Parse leading YAML frontmatter from a markdown document.
 * @param source - full file contents.
 * @returns the parsed keys and the remaining body.
 */
export declare function parseFrontmatter(source: string): Promise<Frontmatter>;
export {};
