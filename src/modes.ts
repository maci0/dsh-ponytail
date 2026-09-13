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

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Levels that change the always-on ruleset and may be persisted as a default. */
export const RUNTIME_MODES = ['off', 'lite', 'full', 'ultra'] as const

/** Every accepted level; `review` is session-only and never a valid default. */
export const VALID_MODES = ['off', 'lite', 'full', 'ultra', 'review'] as const

/** A level that selects the always-on ruleset, or turns it off. */
export type RuntimeMode = (typeof RUNTIME_MODES)[number]

/** Any level the plugin accepts, including the independent `review` mode. */
export type PonytailMode = (typeof VALID_MODES)[number]

/** Level used when neither config, environment, nor config file sets one. */
export const DEFAULT_MODE: RuntimeMode = 'full'

/**
 * Modes whose behavior is defined by their own skill rather than by the ladder
 * ruleset. They inject a pointer, not the filtered skill body.
 */
const INDEPENDENT_MODES: ReadonlySet<string> = new Set(['review'])

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
 * Normalize a value that may name either kind of level.
 * @param value - candidate level.
 * @returns the canonical level, or `undefined` when unrecognized.
 */
export function normalizePersistedMode(value: unknown): PonytailMode | undefined {
  return normalizeMode(value) ?? normalizeConfigMode(value)
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

/** Platform config directory, matching the reference implementation. */
export function getConfigDir(): string {
  if (process.env['XDG_CONFIG_HOME']) {
    return join(process.env['XDG_CONFIG_HOME'], 'ponytail')
  }
  if (process.platform === 'win32') {
    return join(process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'), 'ponytail')
  }
  return join(homedir(), '.config', 'ponytail')
}

/** Absolute path of the optional `config.json` the reference implementation reads. */
export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json')
}

/** Inputs for {@link resolveDefaultMode}, all injectable for tests. */
export interface DefaultModeSources {
  /** Deployment default from this plugin's config field; wins over everything. */
  readonly configured?: string | undefined
  /** Environment lookup; defaults to `process.env`. */
  readonly env?: Record<string, string | undefined> | undefined
  /** Config-file path; defaults to {@link getConfigPath}. */
  readonly configPath?: string | undefined
  /** File reader seam; defaults to reading UTF-8 from disk. */
  readonly readFile?: ((path: string) => string) | undefined
}

/**
 * Resolve the level a fresh process starts in.
 *
 * Order: this plugin's config field, then `PONYTAIL_DEFAULT_MODE`, then the
 * `defaultMode` field of `~/.config/ponytail/config.json`, then `full`. Only
 * runtime levels count, so a stray `review` can never become the default.
 * @param sources - injectable overrides for tests.
 * @returns the resolved startup level.
 */
export function resolveDefaultMode(sources: DefaultModeSources = {}): RuntimeMode {
  const configured = normalizeMode(sources.configured)
  if (configured !== undefined) return configured

  const envMode = normalizeMode((sources.env ?? process.env)['PONYTAIL_DEFAULT_MODE'])
  if (envMode !== undefined) return envMode

  const readFile = sources.readFile ?? ((path: string): string => readFileSync(path, 'utf8'))
  try {
    const raw = readFile(sources.configPath ?? getConfigPath()).replace(/^\uFEFF/, '')
    const parsed: unknown = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const fileMode = normalizeMode((parsed as Record<string, unknown>)['defaultMode'])
      if (fileMode !== undefined) return fileMode
    }
  } catch {
    // Missing or invalid config file: fall through to the built-in default.
  }
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
 * @param body - raw markdown of the `ponytail` skill, frontmatter included.
 * @param mode - the level to keep.
 * @returns the body with other levels' rows and examples removed.
 */
export function filterSkillBodyForMode(body: string, mode: PonytailMode): string {
  const effective = normalizeMode(mode) ?? DEFAULT_MODE
  const withoutFrontmatter = String(body ?? '').replace(/^---[\s\S]*?---\s*/, '')

  return withoutFrontmatter
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

/**
 * Standalone ruleset used when the bundled `ponytail` skill body cannot be
 * read. Verbatim from the reference implementation so a broken install still
 * carries the full policy rather than a truncated one.
 * @param mode - the active level.
 * @returns the complete fallback instruction block.
 */
export function getFallbackInstructions(mode: RuntimeMode): string {
  return 'PONYTAIL MODE ACTIVE — level: ' + mode + '\n\n' +
    'You are a lazy senior developer. Lazy means efficient, not careless. The best code is the code you never wrote.\n\n' +
    '## Persistence\n\n' +
    'ACTIVE EVERY RESPONSE. No drift back to over-building. Still active if unsure. Off only: "stop ponytail" / "normal mode".\n\n' +
    'Current level: **' + mode + '**. Switch: `/ponytail lite|full|ultra`.\n\n' +
    '## The ladder\n\n' +
    'Before any code, stop at the first rung that holds (the ladder runs after you understand the problem, not instead of it — read the code it touches and trace the real flow first):\n' +
    '1. Does this need to be built at all? (YAGNI)\n' +
    '2. Does it already exist in this codebase? Reuse what is already here, do not re-write it.\n' +
    '3. Does the standard library do this? Use it.\n' +
    '4. Does a native platform feature cover it? Use it.\n' +
    '5. Does an already-installed dependency solve it? Use it.\n' +
    '6. Can this be one line? Make it one line.\n' +
    '7. Only then: write the minimum code that works.\n\n' +
    'Bug fix = root cause, not symptom: grep every caller of the function you touch and fix the shared function once (a smaller diff than one guard per caller); patching only the path the ticket names leaves a sibling caller broken.\n\n' +
    '## Rules\n\n' +
    'No abstractions that were not requested. No avoidable dependencies. No boilerplate nobody asked for. ' +
    'Deletion over addition. Boring over clever. Fewest files possible. ' +
    'Ship the lazy version and question the complex request in the same response — never stall. ' +
    'Between two same-size stdlib options, pick the one correct on edge cases. ' +
    'Mark deliberate simplifications that cut a real corner with a known ceiling, using a `ponytail:` comment that names the ceiling and upgrade path.\n\n' +
    '## Output\n\n' +
    'Code first. Then at most three short lines: what was skipped, when to add it. ' +
    'If the explanation is longer than the code, delete the explanation. ' +
    'Explanation the user explicitly asked for is not debt, give it in full.\n\n' +
    '## When NOT to be lazy\n\n' +
    'Never simplify away: understanding the problem (read it fully and trace the real flow before picking a rung — a small diff you do not understand is just laziness dressed up as efficiency), input validation at trust boundaries, error handling that prevents data loss, ' +
    'security measures, accessibility basics, the calibration real hardware needs (the platform is never the spec ideal), anything the user explicitly asked to keep. ' +
    'Lazy code without its check is unfinished: non-trivial logic leaves ONE runnable check behind (assert-based demo/self-check or one small test file; no frameworks). Trivial one-liners need no test.\n\n' +
    '## Boundaries\n\n' +
    'Ponytail governs what you build, not how you talk. "stop ponytail" or "normal mode": revert. Level persists until changed or session end.'
}

/** Inputs for {@link buildModeInstructions}. */
export interface InstructionInput {
  /** Active level. */
  readonly mode: PonytailMode
  /** Raw `skills/ponytail/SKILL.md` body; omitted falls back to the embedded ruleset. */
  readonly skillBody?: string | undefined
}

/**
 * Build the exact text the system prompt carries for one level.
 * @param input - the active level and the optional skill body.
 * @returns the instruction block, or `''` when the level is `off`.
 */
export function buildModeInstructions(input: InstructionInput): string {
  const { mode } = input
  if (mode === 'off') return ''

  if (INDEPENDENT_MODES.has(mode)) {
    return (
      'PONYTAIL MODE ACTIVE — level: ' + mode + '. Behavior defined by the `ponytail-' + mode +
      '` skill; load it with the skill tool.'
    )
  }

  const effective = normalizeMode(mode) ?? DEFAULT_MODE
  const body = input.skillBody
  const ruleset = body === undefined || body.trim() === ''
    ? getFallbackInstructions(effective)
    : filterSkillBodyForMode(body, effective)

  return 'PONYTAIL MODE ACTIVE — level: ' + effective + '\n\n' + ruleset
}
