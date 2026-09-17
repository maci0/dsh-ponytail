/**
 * The slice of the DeepSeek Harness host surface this plugin uses, declared
 * structurally.
 *
 * These interfaces describe the exact contracts the plugin calls; the host
 * types remain authoritative, and every service is reached through
 * `ctx.inject([...])`, so a composition that does not mount one simply omits
 * that capability.
 *
 * @module dsh-ponytail/host
 */

import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

/** Disposer returned by every host registration. */
export type Disposable = () => void

/** One contributed system-prompt section. */
export interface PromptSectionContribution {
  /** Unique section name across the composition. */
  readonly name: string
  /** Ascending concatenation position. */
  readonly order: number
  /** Static text, or a provider evaluated at each assembly (empty text is dropped). */
  readonly text: string | ((context: unknown) => string)
}

/** Invocation controls carried by every skill summary. */
export interface SkillInvocationPolicyLike {
  /** Whether model-facing catalogs and the `skill` tool include this skill. */
  readonly modelInvocable: boolean
  /** Whether human-facing command catalogs include this skill. */
  readonly userInvocable: boolean
}

/** Invocation-neutral skill metadata. */
export interface SkillSummaryLike {
  /** Absolute instruction file path, when the provider has one. */
  readonly path?: string
  /** Kebab-case identifier. */
  readonly name: string
  /** Short routing description. */
  readonly description: string
  /** Optional extra routing guidance, carried through from frontmatter. */
  readonly whenToUse?: string
  /** Resolved invocation controls. */
  readonly invocation: SkillInvocationPolicyLike
  /** Discovery source bucket. */
  readonly source: string
  /** Owning provider name. */
  readonly provider: string
  /** Base for resources referenced by the loaded body. */
  readonly resourceBase?: { readonly kind: 'directory'; readonly path: string }
}

/** Caller context the registry borrows while a provider lists or loads. */
export interface SkillLookupOptionsLike {
  /** Workspace selector for the current lookup. */
  readonly cwd?: string | undefined
  /** Aborts discovery or loading work for the current caller. */
  readonly signal?: AbortSignal | undefined
}

/** Provider catalog entry the registry merges and later loads. */
export interface SkillCandidateLike extends SkillSummaryLike {
  /** Lower ranks win duplicate names before provider registration order. */
  readonly rank: number
  /** Opaque provider-owned handle passed back to `get()`. */
  readonly locator: unknown
  /** Parsed provider-specific frontmatter. */
  readonly metadata?: Readonly<Record<string, unknown>>
}

/** Complete skill definition including the loaded body. */
export interface SkillDefinitionLike extends SkillSummaryLike {
  /** Instruction body after frontmatter removal. */
  readonly content: string
  /** Parsed provider-specific frontmatter. */
  readonly metadata?: Readonly<Record<string, unknown>>
}

/** One source of skills. */
export interface SkillProviderLike {
  /** Unique provider name in the registry. */
  readonly name: string
  /** List candidates for the current lookup. */
  list(options?: SkillLookupOptionsLike): Promise<readonly SkillCandidateLike[]>
  /** Load a winning candidate's body, or `undefined` when it is gone. */
  get(candidate: SkillCandidateLike, options?: SkillLookupOptionsLike): Promise<SkillDefinitionLike | undefined>
}

/** Invocation handed to a registered human command. */
export interface CommandInvocationLike {
  /** Text following the command name, including separator whitespace. */
  readonly rawInput: string
}

/** Direct-UI outcome of a human command. */
export type CommandResultLike =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** A plugin-owned human command. */
export interface CommandDefinitionLike {
  /** Lowercase command name without the leading slash. */
  readonly name: string
  /** Summary used in discovery UI. */
  readonly description: string
  /** Optional free-form input hint. */
  readonly input?: { readonly hint: string }
  /** Execute against the receiving agent without a model message. */
  handler(invocation: CommandInvocationLike): CommandResultLike | Promise<CommandResultLike>
}

/**
 * The slice of a durable session message the deactivation watcher reads.
 *
 * `source.kind === 'user'` is what separates the human's own words from the
 * context the harness injects into the same event stream (skill bodies,
 * references, replayed history).
 */
export interface SessionMessageLike {
  /** Content blocks; only `text` blocks carry words. */
  readonly content?: readonly { readonly type?: string; readonly text?: string }[] | undefined
  /** Provenance of the message. */
  readonly source?: { readonly kind?: string } | undefined
}

/** One durable session event, as `session/event` delivers it. */
export interface SessionEventLike {
  /** Event discriminator, e.g. `user/message`. */
  readonly type?: string
  /** Event payload; a {@link SessionMessageLike} for `user/message`. */
  readonly data?: unknown
}

/**
 * Structural view of the Cordis context the plugin uses.
 *
 * Members are only reached inside the matching `inject` callback, where the
 * host guarantees the service is present, or through {@link HostContext.get}
 * at the use site.
 */
export interface HostContext {
  /** Run `callback` once the named services are available; the return is a fiber. */
  inject(dependencies: readonly string[], callback: (scope: HostContext) => void): unknown
  /** Query a mounted service, or `undefined` while none is mounted. */
  get(service: string): unknown
  /** Subscribe to a host event; the returned disposer removes the listener. */
  on(
    event: 'session/event',
    listener: (session: unknown, event: SessionEventLike) => void,
  ): Disposable
  readonly systemPrompt: {
    section(section: PromptSectionContribution): Disposable
  }
  readonly skills: {
    registerProvider(create: () => SkillProviderLike): Disposable
  }
  readonly tools: {
    register(definition: ToolDefinition): Disposable
  }
  readonly commands: {
    register(definition: CommandDefinitionLike): Disposable
  }
  readonly settings: SettingsServiceLike
}

/** Hooks a consumer hands to `settings.installSection`. */
export interface SettingsSectionHooksLike {
  /**
   * Receive the active configuration source: the resolved settings scope while
   * one is attached, the composition entry otherwise. Called before the
   * matching `onChange` at attach and at detach.
   */
  setSource(current: () => unknown): void
  /** Re-judge anything derived from the source after an attach, detach, or commit. */
  onChange(): void
}

/** The slice of the settings service this plugin uses. */
export interface SettingsServiceLike {
  /**
   * Register a namespace with the plugin's composition entry as the `base`
   * layer, falling back to that entry when no provider is mounted.
   */
  installSection(
    owner: unknown,
    namespace: string,
    schema: unknown,
    entry: unknown,
    hooks: SettingsSectionHooksLike,
  ): void
  /**
   * Deep-merge a plain-object patch into the namespace's user layer and persist it.
   * @param namespace - a namespace this plugin registered.
   * @param patch - fields to write; only the user layer is touched.
   */
  update(namespace: string, patch: Record<string, unknown>): Promise<void>
}
