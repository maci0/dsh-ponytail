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
export const RUNTIME_MODES = ['off', 'lite', 'full', 'ultra'] as const

/** Every accepted level; `review` is session-only and never a valid default. */
export const VALID_MODES = ['off', 'lite', 'full', 'ultra', 'review'] as const

/** A level that selects the always-on ruleset, or turns it off. */
export type RuntimeMode = (typeof RUNTIME_MODES)[number]

/** Any level the plugin accepts, including the independent `review` mode. */
export type PonytailMode = (typeof VALID_MODES)[number]

/** Level used when neither config nor environment sets one. */
export const DEFAULT_MODE: RuntimeMode = 'full'

/**
 * Normalize a value to a level that may be persisted as a default.
 * @param value - candidate level from a config field, environment, or command.
 * @returns the canonical runtime level, or `undefined` when unrecognized.
 */
export function normalizeMode(value: unknown): RuntimeMode | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return RUNTIME_MODES.find((mode) => mode === normalized)
}

/**
 * Normalize a value to any accepted level, including the session-only `review`.
 * @param value - candidate level.
 * @returns the canonical level, or `undefined` when unrecognized.
 */
export function normalizeConfigMode(value: unknown): PonytailMode | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return VALID_MODES.find((mode) => mode === normalized)
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
export function isDeactivationCommand(text: string): boolean {
  const normalized = String(text ?? '').trim().toLowerCase().replace(/[.!?\s]+$/, '')
  return normalized === 'stop ponytail' || normalized === 'normal mode'
}

/** Inputs for {@link resolveDefaultMode}, all injectable for tests. */
export interface DefaultModeSources {
  /** Deployment default from this plugin's config field; wins over everything. */
  readonly configured?: string | undefined
  /** Environment lookup; defaults to `process.env`. */
  readonly env?: Record<string, string | undefined> | undefined
}

/**
 * Resolve the level a fresh process starts in.
 *
 * Order: this plugin's config field, then `PONYTAIL_DEFAULT_MODE`, then `full`.
 * Only runtime levels count, so a stray `review` can never become the default.
 * @param sources - injectable overrides for tests.
 * @returns the resolved startup level.
 */
export function resolveDefaultMode(sources: DefaultModeSources = {}): RuntimeMode {
  const configured = normalizeMode(sources.configured)
  if (configured !== undefined) return configured

  const envMode = normalizeMode((sources.env ?? process.env)['PONYTAIL_DEFAULT_MODE'])
  if (envMode !== undefined) return envMode

  return DEFAULT_MODE
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
export function filterSkillBodyForMode(body: string, mode: PonytailMode): string {
  const effective = normalizeMode(mode) ?? DEFAULT_MODE

  return String(body ?? '')
    .split(/\r?\n/)
    .filter((line) => {
      const tableLabel = /^\|\s*\*\*(.+?)\*\*\s*\|/.exec(line)
      if (tableLabel?.[1] !== undefined) {
        const labelMode = normalizeMode(tableLabel[1].trim())
        if (labelMode !== undefined) return labelMode === effective
      }

      const exampleLabel = /^-\s*([^:]+):\s*"/.exec(line)
      if (exampleLabel?.[1] !== undefined) {
        const labelMode = normalizeMode(exampleLabel[1].trim())
        if (labelMode !== undefined) return labelMode === effective
      }

      return true
    })
    .join('\n')
}

/** Inputs for {@link buildModeInstructions}. */
export interface InstructionInput {
  /** Active level. */
  readonly mode: PonytailMode
  /** `skills/ponytail/SKILL.md` body with its frontmatter already removed. */
  readonly skillBody: string
}

/**
 * Build the exact text the system prompt carries for one level.
 * @param input - the active level and the skill body.
 * @returns the instruction block, or `''` when the level is `off`.
 */
export function buildModeInstructions(input: InstructionInput): string {
  const { mode } = input
  if (mode === 'off') return ''

  if (mode === 'review') {
    return (
      'PONYTAIL MODE ACTIVE — level: review. Behavior defined by the `ponytail-review`' +
      ' skill; load it with the skill tool.'
    )
  }

  const effective = normalizeMode(mode) ?? DEFAULT_MODE
  return 'PONYTAIL MODE ACTIVE — level: ' + effective + '\n\n' +
    filterSkillBodyForMode(input.skillBody, effective)
}
