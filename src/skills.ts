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
import { dirname, join } from 'node:path'
import { parseFrontmatter } from './frontmatter.ts'
import type {
  SkillCandidateLike,
  SkillDefinitionLike,
  SkillLookupOptionsLike,
  SkillProviderLike,
  SkillSummaryLike,
} from './host.ts'

/**
 * Rank matching a harness bundled skill (600), so a project-level or user-level
 * skill of the same name still wins the duplicate.
 */
export const BUNDLED_SKILL_RANK = 600

/** Default provider name inside the skill registry. */
export const DEFAULT_PROVIDER_NAME = 'ponytail'

/** The grammar the registry enforces for skill names. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Instruction file every skill directory must carry. */
const INSTRUCTION_FILE = 'SKILL.md'

/** One parsed bundled skill. */
export interface PonytailSkill {
  /** Kebab-case skill name from frontmatter, or the directory name. */
  readonly name: string
  /** Routing description from frontmatter. */
  readonly description: string
  /** Instruction body with frontmatter removed. */
  readonly content: string
  /** Remaining frontmatter keys (`argument-hint`, `license`, …). */
  readonly metadata: Readonly<Record<string, string>>
  /** Absolute path of the instruction file. */
  readonly path: string
  /** Absolute path of the skill directory, used as the resource base. */
  readonly directory: string
}

/** Options for {@link createSkillProvider}. */
export interface SkillProviderOptions {
  /** Directory holding one subdirectory per skill. */
  readonly skillsDir: string
  /** Provider name in the registry; defaults to {@link DEFAULT_PROVIDER_NAME}. */
  readonly providerName?: string
  /** Receives non-fatal discovery problems instead of throwing. */
  readonly onWarn?: (message: string) => void
  /** Duplicate-resolution rank; defaults to {@link BUNDLED_SKILL_RANK}. */
  readonly rank?: number
}

/**
 * Read every valid skill directory under `skillsDir`.
 *
 * A missing directory, a directory without `SKILL.md`, and a file with a
 * missing description are reported through `onWarn` and skipped: one broken
 * file must not cost the catalog its other skills.
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
    onWarn?.(`cannot read skills directory ${skillsDir}: ${describeError(error)}`)
    return []
  }

  const skills: PonytailSkill[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const path = join(skillsDir, entry.name, INSTRUCTION_FILE)
    let source: string
    try {
      source = await readFile(path, 'utf8')
    } catch {
      continue
    }

    const parsed = parseFrontmatter(source)
    const name = (parsed.data['name'] ?? entry.name).trim()
    const description = (parsed.data['description'] ?? '').trim()

    if (!SKILL_NAME.test(name)) {
      onWarn?.(`skipping ${path}: "${name}" is not a valid kebab-case skill name`)
      continue
    }
    if (description === '') {
      onWarn?.(`skipping ${path}: frontmatter has no description`)
      continue
    }

    const metadata: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed.data)) {
      if (key === 'name' || key === 'description') continue
      metadata[key] = value
    }

    skills.push({
      name,
      description,
      content: parsed.body.trim(),
      metadata,
      path,
      directory: dirname(path),
    })
  }

  return skills.sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * Build the provider the skill registry mounts.
 * @param options - skills directory, provider name, and rank.
 * @returns a provider whose candidates are summaries and whose bodies come from disk.
 */
export function createSkillProvider(options: SkillProviderOptions): SkillProviderLike {
  const providerName = options.providerName ?? DEFAULT_PROVIDER_NAME
  const rank = options.rank ?? BUNDLED_SKILL_RANK

  const summaryOf = (skill: PonytailSkill): SkillSummaryLike => ({
    path: skill.path,
    name: skill.name,
    description: skill.description,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'bundled',
    provider: providerName,
    resourceBase: { kind: 'directory', path: skill.directory },
  })

  return {
    name: providerName,

    async list(_options: SkillLookupOptionsLike): Promise<readonly SkillCandidateLike[]> {
      const skills = await discoverSkills(options.skillsDir, options.onWarn)
      return skills.map((skill) => ({
        ...summaryOf(skill),
        rank,
        locator: skill.path,
        metadata: skill.metadata,
      }))
    },

    async get(
      candidate: SkillCandidateLike,
      _options: SkillLookupOptionsLike,
    ): Promise<SkillDefinitionLike | undefined> {
      if (typeof candidate.locator !== 'string') return undefined

      const skills = await discoverSkills(options.skillsDir, options.onWarn)
      const found = skills.find(
        (skill) => skill.path === candidate.locator && skill.name === candidate.name,
      )
      if (found === undefined) return undefined

      return { ...summaryOf(found), content: found.content, metadata: found.metadata }
    },
  }
}

/**
 * Render an unknown thrown value for a warning line.
 * @param error - caught value.
 * @returns a human-readable description.
 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
