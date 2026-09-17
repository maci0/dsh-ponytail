/**
 * Ponytail's level model: the accepted levels, their normalization, the
 * mode-specific filter over the `ponytail` skill body, and the instruction
 * block the plugin injects into the system prompt.
 *
 * Ported from the reference implementation's `hooks/ponytail-config.js` and
 * `hooks/ponytail-instructions.js` (MIT, © DietrichGebert) so the DSH port
 * speaks the same lite/full/ultra/review vocabulary and filters the same rows.
 * The one addition is `resolveDefaultMode`'s `configured` source, which lets a
 * deployment set the default from this plugin's own config field.
 *
 * @module dsh-ponytail/modes
 */
/** Levels that change the always-on ruleset and may be persisted as a default. */
export declare const RUNTIME_MODES: readonly ['off', 'lite', 'full', 'ultra'];
/** Every accepted level; `review` is session-only and never a valid default. */
export declare const VALID_MODES: readonly ['off', 'lite', 'full', 'ultra', 'review'];
/** A level that selects the always-on ruleset, or turns it off. */
export type RuntimeMode = (typeof RUNTIME_MODES)[number];
/** Any level the plugin accepts, including the independent `review` mode. */
export type PonytailMode = (typeof VALID_MODES)[number];
/** Level used when neither config nor environment sets one. */
export declare const DEFAULT_MODE: RuntimeMode;
/** Normalize a value to a level that may be persisted as a default. */
export declare function normalizeMode(value: unknown): RuntimeMode | undefined;
/** Normalize a value to any accepted level, including the session-only `review`. */
export declare function normalizeCommandMode(value: unknown): PonytailMode | undefined;
/**
 * Whether a whole message is a deactivation command.
 *
 * "stop ponytail" / "normal mode" turn ponytail off, but only as a standalone
 * command: matching the phrase anywhere in a message turned it off mid-task for
 * ordinary requests like "add a normal mode toggle", so the whole trimmed
 * message must be the command, ignoring case and trailing punctuation.
 * @param text - user message text.
 * @returns whether the message is the deactivation command.
 */
export declare function isDeactivationCommand(text: string): boolean;
/**
 * Resolve the level a fresh process starts in.
 *
 * Only runtime levels count, so a stray `review` can never become the default.
 * @param configured - the row's `defaultMode` field, when the row carries one.
 * @returns the resolved startup level.
 */
export declare function resolveDefaultMode(configured?: unknown): RuntimeMode;
/**
 * Drop the intensity-table rows and worked examples that belong to other
 * levels.
 *
 * Only the intensity table rows and worked examples are mode-specific, and both
 * are keyed by a level name. A bullet whose label is not a level — e.g.
 * "No unrequested abstractions: ..." — is a normal rule and stays verbatim; the
 * quoted-value requirement on examples is what keeps a rule that merely starts
 * with a level word from being dropped in every other mode.
 * @param body - markdown of the `ponytail` skill, frontmatter already removed.
 * @param mode - the level to keep.
 * @returns the body with other levels' rows and examples removed.
 */
export declare function filterSkillBodyForMode(body: string, mode: PonytailMode): string;
/** Inputs for {@link buildModeInstructions}. */
interface InstructionInput {
    /** Active level. */
    readonly mode: PonytailMode;
    /** `skills/ponytail/SKILL.md` body with its frontmatter already removed. */
    readonly skillBody: string;
}
/**
 * Build the exact text the system prompt carries for one level.
 * @param input - the active level and the skill body.
 * @returns the instruction block, or `''` when the level is `off`.
 */
export declare function buildModeInstructions(input: InstructionInput): string;
export {};
