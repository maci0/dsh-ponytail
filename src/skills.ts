/**
 * The bundled ponytail skills as a `ctx.skills` provider.
 *
 * Skills are read from this package's `skills/<name>/SKILL.md`, so the same
 * files stay the single source of truth for both the always-on ruleset (which
 * filters the `ponytail` body per level) and the on-demand skills.
 *
 * @module dsh-ponytail/skills
 */

import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { BUNDLED_SKILL_RANK, isSkillName } from '@deepseek-ai/dsh-skill'
import { parseFrontmatter } from './frontmatter.ts'
import type {
  SkillCandidateLike,
  SkillDefinitionLike,
  SkillLookupOptionsLike,
  SkillProviderLike,
  SkillSummaryLike,
} from './host.ts'

/** Provider name inside the skill registry. */
const PROVIDER_NAME = 'ponytail'

/** Instruction file every skill directory must carry. */
const INSTRUCTION_FILE = 'SKILL.md'

/**
 * Frontmatter keys that project onto a summary field rather than provider
 * metadata. `disable-model-invocation`/`user-invocable` resolve into
 * `invocation`, so they never ride along as provider-specific keys.
 */
const INVOCATION_KEYS = new Set([
  'name',
  'description',
  'whenToUse',
  'disable-model-invocation',
  'user-invocable',
])

/** One parsed bundled skill. */
export interface PonytailSkill {
  /** Kebab-case skill name from frontmatter, or the directory name. */
  readonly name: string
  /** Routing description from frontmatter. */
  readonly description: string
  /** Optional extra routing guidance from frontmatter. */
  readonly whenToUse?: string
  /** Resolved model and user invocation controls. */
  readonly invocation: { readonly modelInvocable: boolean; readonly userInvocable: boolean }
  /** Instruction body with frontmatter removed. */
  readonly content: string
  /** Remaining provider-specific keys (`argument-hint`, `license`, …). */
  readonly metadata: Readonly<Record<string, unknown>>
  /** Absolute path of the instruction file. */
  readonly path: string
  /** Absolute path of the skill directory, used as the resource base. */
  readonly directory: string
}

/**
 * Read one frontmatter value as a trimmed string.
 * @param value - YAML-parsed value, of any shape.
 * @returns the trimmed string, or `undefined` when the value is missing or a collection.
 */
function scalar(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  return undefined
}

/** Options for {@link createSkillProvider}. */
export interface SkillProviderOptions {
  /** Directory holding one subdirectory per skill. */
  readonly skillsDir: string
  /** Receives non-fatal discovery problems instead of throwing. */
  readonly onWarn?: (message: string) => void
}

/**
 * Read and parse one skill file. Shared by discovery and direct loads so a
 * single file enforces the name/description/frontmatter rules everywhere.
 * @param path - absolute path of the `SKILL.md` file.
 * @param entryName - directory name fallback when frontmatter omits `name`.
 * @param onWarn - optional non-fatal problem sink.
 * @returns the parsed skill, or `undefined` with a warning when invalid.
 */
export async function readSkillFile(
  path: string,
  onWarn?: (message: string) => void,
  entryName?: string,
): Promise<PonytailSkill | undefined> {
  let source: string
  try {
    source = await readFile(path, 'utf8')
  } catch {
    return undefined
  }

  let parsed: ReturnType<typeof parseFrontmatter>
  try {
    parsed = parseFrontmatter(source)
  } catch (error) {
    onWarn?.(`skipping ${path}: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }

  const fallback = entryName ?? basename(path)
  const name = scalar(parsed.data['name']) ?? fallback
  const description = scalar(parsed.data['description']) ?? ''
  const whenToUse = scalar(parsed.data['whenToUse'])

  if (!isSkillName(name)) {
    onWarn?.(`skipping ${path}: "${name}" is not a valid kebab-case skill name`)
    return undefined
  }
  if (description === '') {
    onWarn?.(`skipping ${path}: frontmatter has no description`)
    return undefined
  }

  const metadata: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed.data)) {
    if (INVOCATION_KEYS.has(key)) continue
    metadata[key] = value
  }

  return {
    name,
    ...(whenToUse === undefined ? {} : { whenToUse }),
    description,
    // Only the literal `true` disables the model surface and only the literal
    // `false` disables the human one: an absent or malformed flag keeps the
    // permissive default, so a typo advertises a skill instead of hiding it.
    invocation: {
      modelInvocable: parsed.data['disable-model-invocation'] !== true,
      userInvocable: parsed.data['user-invocable'] !== false,
    },
    content: parsed.body.trim(),
    metadata,
    path,
    directory: dirname(path),
  }
}

/**
 * Read every valid skill directory under `skillsDir`.
 *
 * A missing directory, a directory without `SKILL.md`, a file with unreadable
 * frontmatter, and a file with a missing description are reported through
 * `onWarn` and skipped: one broken file must not cost the catalog its other
 * skills.
 * @param skillsDir - directory holding one subdirectory per skill.
 * @param onWarn - optional non-fatal problem sink.
 * @returns the parsed skills, sorted by name.
 */
export async function discoverSkills(
  skillsDir: string,
  onWarn?: (message: string) => void,
): Promise<readonly PonytailSkill[]> {
  let entries
  try {
    entries = await readdir(skillsDir, { withFileTypes: true })
  } catch (error) {
    onWarn?.(`cannot read skills directory ${skillsDir}: ${error instanceof Error ? error.message : String(error)}`)
    return []
  }

  const skills: PonytailSkill[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const path = join(skillsDir, entry.name, INSTRUCTION_FILE)
    const skill = await readSkillFile(path, onWarn, entry.name)
    if (skill !== undefined) skills.push(skill)
  }

  return skills.sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * Build the provider the skill registry mounts.
 * @param options - skills directory and the non-fatal problem sink.
 * @returns a provider whose candidates are summaries and whose bodies come from disk.
 */
export function createSkillProvider(options: SkillProviderOptions): SkillProviderLike {
  const summaryOf = (skill: PonytailSkill): SkillSummaryLike => ({
    path: skill.path,
    name: skill.name,
    description: skill.description,
    ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
    invocation: skill.invocation,
    source: 'bundled',
    provider: PROVIDER_NAME,
    resourceBase: { kind: 'directory', path: skill.directory },
  })

  return {
    name: PROVIDER_NAME,

    // The packaged skills are immutable in place, so there is nothing to
    // invalidate and no watcher to own. `list`/`get` honor the caller's abort
    // signal only at their own await boundaries: a caller that aborts mid-read
    // gets no candidates rather than a later answer it stopped waiting for.
    async list(lookup: SkillLookupOptionsLike = {}): Promise<readonly SkillCandidateLike[]> {
      if (lookup.signal?.aborted) return []
      const skills = await discoverSkills(options.skillsDir, options.onWarn)
      if (lookup.signal?.aborted) return []
      return skills.map((skill) => ({
        ...summaryOf(skill),
        rank: BUNDLED_SKILL_RANK,
        locator: skill.path,
        metadata: skill.metadata,
      }))
    },

    async get(candidate: SkillCandidateLike, lookup: SkillLookupOptionsLike = {}): Promise<SkillDefinitionLike | undefined> {
      if (typeof candidate.locator !== 'string') return undefined
      if (lookup.signal?.aborted) return undefined

      // Read the locator directly: one file instead of a full re-discovery.
      // The name check keeps a stale candidate (path reused by another skill)
      // from loading under the wrong identity.
      const skill = await readSkillFile(candidate.locator, options.onWarn)
      if (lookup.signal?.aborted) return undefined
      if (skill === undefined || skill.name !== candidate.name) return undefined

      return { ...summaryOf(skill), content: skill.content, metadata: skill.metadata }
    },
  }
}
