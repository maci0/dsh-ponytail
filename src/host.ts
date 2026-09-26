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

import type {
  SkillCandidate,
  SkillDefinition,
  SkillLookupOptions,
  SkillProvider,
} from '@deepseek-ai/dsh-skill'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

/** Disposer returned by every host registration. */
type Disposable = () => void

/** One contributed system-prompt section. */
export interface PromptSectionContribution {
  /** Unique section name across the composition. */
  readonly name: string
  /** Ascending concatenation position. */
  readonly order: number
  /** Static text, or a provider evaluated at each assembly (empty text is dropped). */
  readonly text: string | ((context: unknown) => string)
}

/**
 * A {@link SkillProvider} whose catalog is always one complete plain array and
 * whose lookup may be omitted, which is how this plugin's own provider is
 * called.
 */
export type SkillProviderLike = Omit<SkillProvider, 'list' | 'get'> & {
  list(options?: SkillLookupOptions): Promise<readonly SkillCandidate[]>
  get(candidate: SkillCandidate, options?: SkillLookupOptions): Promise<SkillDefinition | undefined>
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
  on(event: 'session/event', listener: (session: unknown, event: SessionEventLike) => void): Disposable
  on(event: 'loader/volatile-update', listener: () => void): Disposable
  /** Owning fiber, present once the loader mounted this plugin. */
  readonly fiber?: { readonly entry?: { readonly options?: { readonly id?: string } } }
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

/** The slice of the settings service this plugin uses. */
export interface SettingsServiceLike {
  /**
   * Merge fields into one profile entry. `ns` is the entry id.
   * @param ns - profile entry id.
   * @param patch - fields to write.
   */
  update(ns: string, patch: Record<string, unknown>): Promise<void>
}
