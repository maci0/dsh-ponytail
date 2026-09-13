/**
 * dsh-ponytail — Ponytail, lazy senior dev mode, as a DeepSeek Harness plugin.
 *
 * Four capabilities, all mounted through public Cordis extension points:
 *
 * - the bundled skills (`ponytail`, `-review`, `-audit`, `-debt`, `-gain`,
 *   `-help`) become one `ctx.skills` provider;
 * - while a level other than `off` is active, the mode-filtered ruleset is
 *   contributed to the system prompt on every assembly;
 * - the level is switchable from the model (`ponytail` tool) and the human
 *   (`/ponytail` command);
 * - the `ponytail` settings namespace makes the level persistent and pairs with
 *   this package's browser half, which renders the card in the Web client's
 *   Plugins → Plugin configuration tab.
 *
 * Skill content is adapted from the reference implementation
 * (https://github.com/DietrichGebert/ponytail, MIT, © DietrichGebert).
 *
 * @module dsh-ponytail
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'
import {
  buildModeInstructions,
  DEFAULT_MODE,
  isDeactivationCommand,
  normalizeConfigMode,
  normalizeMode,
  resolveDefaultMode,
  RUNTIME_MODES,
  VALID_MODES,
  type PonytailMode,
} from './modes.ts'
import { createSkillProvider, DEFAULT_PROVIDER_NAME } from './skills.ts'
import type {
  CommandInvocationLike,
  CommandResultLike,
  HostContext,
  SettingsServiceLike,
  ToolDefinitionLike,
} from './host.ts'

/** Plugin name as it appears in the loader. */
export const name = 'ponytail'

/**
 * Settings namespace the browser card edits — the join key between this host
 * half and `lib/client.js`. The card registers into `settings.plugin.item`
 * under the same key, and the tab pairs the two without knowing what it means.
 */
export const PONYTAIL_SETTINGS_NAMESPACE = 'ponytail'

/**
 * Persisted configuration. `review` is deliberately absent: it is a
 * session-only review mode, not a level a deployment may start in.
 */
export const PonytailSettings = z.object({
  mode: z.union([...RUNTIME_MODES]).default(DEFAULT_MODE),
})

/**
 * Configuration accepted from this plugin's row in a profile patch.
 *
 * No Schemastery `Config` schema is exported: the loader would require a
 * Standard Schema for it, and this plugin validates its own row instead so the
 * loader never has to. The runtime import of `@deepseek-ai/schemastery` is for
 * {@link PonytailSettings}, whose `toJSON()` the settings service serializes
 * for browser-side rehydration.
 */
export interface Config {
  /** Startup level (`off`, `lite`, `full`, `ultra`). Defaults to `PONYTAIL_DEFAULT_MODE`, then the config file, then `full`. */
  readonly defaultMode?: string
  /** System-prompt position of the ruleset; lower is earlier. Defaults to 700. */
  readonly promptOrder?: number
  /** Skill directory override; defaults to this package's `skills/`. */
  readonly skillsDir?: string
  /** Provider name in the skill registry; defaults to `ponytail`. */
  readonly providerName?: string
}

/** Default system-prompt position: after the persona prefix, before tool guidance. */
const DEFAULT_PROMPT_ORDER = 700

/** Section name of the injected ruleset. */
const SECTION_NAME = 'ponytail'

/**
 * Mount the plugin.
 * @param ctx - the host context.
 * @param config - optional row configuration.
 */
export function apply(ctx: HostContext, config: Config = {}): void {
  validateConfig(config)

  const skillsDir = config.skillsDir ?? defaultSkillsDir()
  const promptOrder = config.promptOrder ?? DEFAULT_PROMPT_ORDER
  const providerName = config.providerName ?? DEFAULT_PROVIDER_NAME
  const startup = resolveDefaultMode({ configured: config.defaultMode })
  const skillBody = readIfPresent(join(skillsDir, 'ponytail', 'SKILL.md'))

  const warn = (message: string): void => {
    console.warn(`[ponytail] ${message}`)
  }

  /** Session-local level, used when the settings document cannot hold the write. */
  let override: PonytailMode | undefined
  /** Authoritative configuration source: the settings scope once attached, else the row. */
  let source: () => unknown = () => ({ mode: startup })
  let settings: SettingsServiceLike | undefined

  const configuredMode = (): PonytailMode | undefined => {
    const value = source()
    if (value === null || typeof value !== 'object') return undefined
    return normalizeMode((value as { mode?: unknown }).mode)
  }

  const activeMode = (): PonytailMode => override ?? configuredMode() ?? startup

  /** Persist a level through the settings document; false when it cannot hold it. */
  const persist = async (next: PonytailMode): Promise<boolean> => {
    if (settings === undefined || normalizeMode(next) === undefined) return false
    try {
      await settings.update(PONYTAIL_SETTINGS_NAMESPACE, { mode: next })
      return true
    } catch (error) {
      warn(`could not persist level "${next}": ${describeError(error)}`)
      return false
    }
  }

  const setMode = async (
    next: PonytailMode,
  ): Promise<{ previous: PonytailMode; mode: PonytailMode; changed: boolean }> => {
    const previous = activeMode()
    override = (await persist(next)) ? undefined : next
    const mode = activeMode()
    return { previous, mode, changed: mode !== previous }
  }

  ctx.inject(['settings'], (scope) => {
    settings = scope.settings
    settings.installSection(
      ctx,
      PONYTAIL_SETTINGS_NAMESPACE,
      PonytailSettings,
      { mode: startup },
      {
        setSource: (current) => {
          source = current
        },
        // Fires at attach and after every committed change. A settings change
        // supersedes a session-local override; the ruleset itself is re-read at
        // each assembly, so there is nothing else to re-judge here.
        onChange: () => {
          override = undefined
        },
      },
    )
  })

  ctx.inject(['systemPrompt'], (scope) => {
    scope.systemPrompt.section({
      name: SECTION_NAME,
      order: promptOrder,
      // Evaluated at each assembly, so a level change lands on the next request.
      // `off` returns empty text, which assembly drops.
      text: () => buildModeInstructions({ mode: activeMode(), skillBody }),
    })
  })

  ctx.inject(['skills'], (scope) => {
    scope.skills.registerProvider((_control) =>
      createSkillProvider({ skillsDir, providerName, onWarn: warn }),
    )
  })

  ctx.inject(['tools'], (scope) => {
    scope.tools.register(createModeTool(activeMode, setMode))
  })

  ctx.inject(['commands'], (scope) => {
    scope.commands.register({
      name: 'ponytail',
      description: 'Set the ponytail level (lite, full, ultra, review, off) or report the current one.',
      input: { hint: 'lite | full | ultra | review | off' },
      handler: async (invocation) => handleModeCommand(invocation, activeMode, setMode),
    })
  })
}

/**
 * Reject configuration that would silently do the wrong thing.
 * @param config - the row configuration.
 */
function validateConfig(config: Config): void {
  if (config.promptOrder !== undefined && !Number.isFinite(config.promptOrder)) {
    throw new Error('[ponytail] promptOrder must be a finite number')
  }
  if (config.skillsDir !== undefined && config.skillsDir.trim() === '') {
    throw new Error('[ponytail] skillsDir must not be empty')
  }
  if (config.defaultMode !== undefined && normalizeMode(config.defaultMode) === undefined) {
    throw new Error(
      `[ponytail] defaultMode must be one of ${RUNTIME_MODES.join(', ')}; got ${JSON.stringify(config.defaultMode)}`,
    )
  }
}

/**
 * Absolute path of the bundled skills directory.
 * @returns `<package>/skills`, resolved from this module's location.
 */
function defaultSkillsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')
}

/**
 * Read a file, treating absence or unreadability as "not available".
 * @param path - file to read.
 * @returns the UTF-8 contents, or `undefined`.
 */
function readIfPresent(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
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

/**
 * Build the model-facing level tool.
 * @param getMode - reads the active level.
 * @param setMode - applies and persists a level.
 * @returns the raw tool definition.
 */
function createModeTool(
  getMode: () => PonytailMode,
  setMode: (next: PonytailMode) => Promise<{ previous: PonytailMode; mode: PonytailMode; changed: boolean }>,
): ToolDefinitionLike {
  return {
    name: 'ponytail',
    description: [
      'Set or report the ponytail level, which governs how much code is written.',
      'lite: build what was asked and name the lazier alternative in one line.',
      'full (default): enforce the ladder — YAGNI, reuse, stdlib, native platform, installed dependency, one line, then the minimum that works.',
      'ultra: challenge whether the requirement needs to exist before building it.',
      'review: over-engineering-only review that lists what to delete.',
      'off: deactivate and behave normally.',
      'The level is persisted in the user settings document, so it survives a restart.',
      'Call with no arguments to report the current level.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: [...VALID_MODES],
          description: 'Level to activate. Omit to report the current level.',
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: [...VALID_MODES] },
          previous: { type: 'string', enum: [...VALID_MODES] },
          changed: { type: 'boolean' },
          active: { type: 'boolean' },
        },
        required: ['mode', 'previous', 'changed', 'active'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: renderModeResult(value) }],
    },
    async execute(args) {
      const requested = readModeArgument(args)
      const previous = getMode()
      if (requested === undefined) {
        return { mode: previous, previous, changed: false, active: previous !== 'off' }
      }

      const applied = await setMode(requested)
      return {
        mode: applied.mode,
        previous: applied.previous,
        changed: applied.changed,
        active: applied.mode !== 'off',
      }
    },
  }
}

/**
 * Read the optional `mode` argument, validating it because raw definitions own
 * their input validation.
 * @param args - losslessly snapshotted model arguments.
 * @returns the requested level, or `undefined` for a status query.
 */
function readModeArgument(args: unknown): PonytailMode | undefined {
  if (args === null || typeof args !== 'object') return undefined

  const raw = (args as Record<string, unknown>)['mode']
  if (raw === undefined || raw === null || raw === '') return undefined

  const mode = normalizeConfigMode(raw)
  if (mode === undefined) {
    throw new Error(
      `Unknown ponytail level ${JSON.stringify(raw)}. Use one of: ${VALID_MODES.join(', ')}.`,
    )
  }
  return mode
}

/**
 * Render the canonical tool value for the model.
 * @param value - the canonical value returned by `execute`.
 * @returns model-facing prose.
 */
function renderModeResult(value: unknown): string {
  const record = (value ?? {}) as Record<string, unknown>
  const mode = typeof record['mode'] === 'string' ? record['mode'] : 'unknown'
  const previous = typeof record['previous'] === 'string' ? record['previous'] : mode
  const changed = record['changed'] === true
  const active = record['active'] === true

  if (!changed) {
    return active
      ? `Ponytail level: ${mode}. The ruleset is injected into every request.`
      : 'Ponytail is off. Normal behavior.'
  }
  if (!active) return `Ponytail off (was ${previous}). Normal behavior.`
  return `Ponytail level: ${mode} (was ${previous}). The ruleset is injected into every request.`
}

/**
 * Handle the human `/ponytail [level]` command.
 * @param invocation - the command invocation.
 * @param getMode - reads the active level.
 * @param setMode - applies and persists a level.
 * @returns the direct-UI result.
 */
async function handleModeCommand(
  invocation: CommandInvocationLike,
  getMode: () => PonytailMode,
  setMode: (next: PonytailMode) => Promise<{ previous: PonytailMode; mode: PonytailMode; changed: boolean }>,
): Promise<CommandResultLike> {
  const input = invocation.rawInput.trim().toLowerCase()

  if (input === '') {
    return { kind: 'success', text: `Ponytail level: ${getMode()}.` }
  }

  const requested = isDeactivationCommand(input) ? 'off' : normalizeConfigMode(input)
  if (requested === undefined) {
    return {
      kind: 'error',
      text: `Unknown ponytail level "${invocation.rawInput.trim()}". Use one of: ${VALID_MODES.join(', ')}.`,
    }
  }

  const { previous, mode, changed } = await setMode(requested)
  if (!changed) return { kind: 'success', text: `Ponytail level: ${mode}.` }
  return {
    kind: 'success',
    text: mode === 'off'
      ? `Ponytail off (was ${previous}). Normal behavior.`
      : `Ponytail level: ${mode} (was ${previous}).`,
  }
}
