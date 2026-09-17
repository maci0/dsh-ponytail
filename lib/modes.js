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
export const RUNTIME_MODES = ['off', 'lite', 'full', 'ultra'];
/** Every accepted level; `review` is session-only and never a valid default. */
export const VALID_MODES = ['off', 'lite', 'full', 'ultra', 'review'];
/** Level used when neither config nor environment sets one. */
export const DEFAULT_MODE = 'full';
/**
 * Normalize a value to one of `values`, case- and whitespace-insensitively.
 * @param values - the accepted levels.
 * @param value - candidate level from a config field or a command.
 * @returns the canonical level, or `undefined` when unrecognized.
 */
function normalize(values, value) {
    if (typeof value !== 'string')
        return undefined;
    const normalized = value.trim().toLowerCase();
    return values.find((mode) => mode === normalized);
}
/** Normalize a value to a level that may be persisted as a default. */
export function normalizeMode(value) {
    return normalize(RUNTIME_MODES, value);
}
/** Normalize a value to any accepted level, including the session-only `review`. */
export function normalizeCommandMode(value) {
    return normalize(VALID_MODES, value);
}
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
export function isDeactivationCommand(text) {
    const normalized = String(text ?? '').trim().toLowerCase().replace(/[.!?\s]+$/, '');
    return normalized === 'stop ponytail' || normalized === 'normal mode';
}
/**
 * Resolve the level a fresh process starts in.
 *
 * Only runtime levels count, so a stray `review` can never become the default.
 * @param configured - the row's `defaultMode` field, when the row carries one.
 * @returns the resolved startup level.
 */
export function resolveDefaultMode(configured) {
    return normalizeMode(configured) ?? DEFAULT_MODE;
}
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
export function filterSkillBodyForMode(body, mode) {
    const effective = normalizeMode(mode) ?? DEFAULT_MODE;
    return String(body ?? '')
        .split(/\r?\n/)
        .filter((line) => {
        const tableLabel = /^\|\s*\*\*(.+?)\*\*\s*\|/.exec(line);
        if (tableLabel?.[1] !== undefined) {
            const labelMode = normalizeMode(tableLabel[1].trim());
            if (labelMode !== undefined)
                return labelMode === effective;
        }
        const exampleLabel = /^-\s*([^:]+):\s*"/.exec(line);
        if (exampleLabel?.[1] !== undefined) {
            const labelMode = normalizeMode(exampleLabel[1].trim());
            if (labelMode !== undefined)
                return labelMode === effective;
        }
        return true;
    })
        .join('\n');
}
/**
 * Build the exact text the system prompt carries for one level.
 * @param input - the active level and the skill body.
 * @returns the instruction block, or `''` when the level is `off`.
 */
export function buildModeInstructions(input) {
    const { mode } = input;
    if (mode === 'off')
        return '';
    if (mode === 'review') {
        return ('PONYTAIL MODE ACTIVE — level: review. Behavior defined by the `ponytail-review`' +
            ' skill; load it with the skill tool.');
    }
    const effective = normalizeMode(mode) ?? DEFAULT_MODE;
    return 'PONYTAIL MODE ACTIVE — level: ' + effective + '\n\n' +
        filterSkillBodyForMode(input.skillBody, effective);
}
