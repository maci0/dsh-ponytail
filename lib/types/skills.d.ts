/**
 * The bundled ponytail skills as a `ctx.skills` provider.
 *
 * Skills are read from this package's `skills/<name>/SKILL.md`, so the same
 * files stay the single source of truth for both the always-on ruleset (which
 * filters the `ponytail` body per level) and the on-demand skills.
 *
 * @module dsh-ponytail/skills
 */
import type { SkillProviderLike } from './host.ts';
/** One parsed bundled skill. */
interface PonytailSkill {
    /** Kebab-case skill name from frontmatter, or the directory name. */
    readonly name: string;
    /** Routing description from frontmatter. */
    readonly description: string;
    /** Optional extra routing guidance from frontmatter. */
    readonly whenToUse?: string;
    /** Resolved model and user invocation controls. */
    readonly invocation: {
        readonly modelInvocable: boolean;
        readonly userInvocable: boolean;
    };
    /** Instruction body with frontmatter removed. */
    readonly content: string;
    /** Remaining provider-specific keys (`argument-hint`, `license`, …). */
    readonly metadata: Readonly<Record<string, unknown>>;
    /** Absolute path of the instruction file. */
    readonly path: string;
    /** Absolute path of the skill directory, used as the resource base. */
    readonly directory: string;
}
/** Options for {@link createSkillProvider}. */
interface SkillProviderOptions {
    /** Directory holding one subdirectory per skill. */
    readonly skillsDir: string;
    /** Receives non-fatal discovery problems instead of throwing. */
    readonly onWarn?: (message: string) => void;
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
export declare function discoverSkills(skillsDir: string, onWarn?: (message: string) => void): Promise<readonly PonytailSkill[]>;
/**
 * Build the provider the skill registry mounts.
 * @param options - skills directory and the non-fatal problem sink.
 * @returns a provider whose candidates are summaries and whose bodies come from disk.
 */
export declare function createSkillProvider(options: SkillProviderOptions): SkillProviderLike;
export {};
