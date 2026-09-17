import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { apply, PONYTAIL_SETTINGS_NAMESPACE, type Config } from '../src/index.ts'
import type {
  CommandDefinitionLike,
  HostContext,
  PromptSectionContribution,
  SessionEventLike,
  SettingsSectionHooksLike,
  SkillProviderLike,
} from '../src/host.ts'

interface InstallRecord {
  readonly namespace: string
  readonly schema: unknown
  readonly entry: unknown
  readonly hooks: SettingsSectionHooksLike
}

interface Captured {
  readonly sections: PromptSectionContribution[]
  readonly providers: SkillProviderLike[]
  readonly tools: ToolDefinition[]
  readonly commands: CommandDefinitionLike[]
  readonly installs: InstallRecord[]
  readonly updates: { namespace: string; patch: Record<string, unknown> }[]
}

/** A host that records registrations and emulates the settings document. */
function createHost(
  options: { failUpdate?: boolean; detachSettings?: boolean; updateDelayMs?: number } = {},
): {
  ctx: HostContext
  captured: Captured
  emit: (event: SessionEventLike) => void
} {
  const captured: Captured = {
    sections: [], providers: [], tools: [], commands: [], installs: [], updates: [],
  }
  let base: Record<string, unknown> = {}
  let user: Record<string, unknown> = {}

  const services = {
    systemPrompt: {
      section: (section: PromptSectionContribution): (() => void) => {
        captured.sections.push(section)
        return () => {}
      },
    },
    skills: {
      registerProvider: (create: () => SkillProviderLike): (() => void) => {
        captured.providers.push(create())
        return () => {}
      },
    },
    tools: {
      register: (tool: ToolDefinition): (() => void) => {
        captured.tools.push(tool)
        return () => {}
      },
    },
    commands: {
      register: (command: CommandDefinitionLike): (() => void) => {
        captured.commands.push(command)
        return () => {}
      },
    },
    settings: {
      installSection: (
        _owner: unknown,
        namespace: string,
        schema: unknown,
        entry: unknown,
        hooks: SettingsSectionHooksLike,
      ): void => {
        base = entry as Record<string, unknown>
        captured.installs.push({ namespace, schema, entry, hooks })
        // The real service hands over a thunk reading the resolved layers.
        hooks.setSource(() => ({ ...base, ...user }))
        hooks.onChange()
      },
      update: async (namespace: string, patch: Record<string, unknown>): Promise<void> => {
        if (options.failUpdate === true) throw new Error('settings document is read-only')
        if (options.updateDelayMs !== undefined) {
          await new Promise((resolve) => { setTimeout(resolve, options.updateDelayMs) })
        }
        captured.updates.push({ namespace, patch })
        user = { ...user, ...patch }
      },
    },
  }

  const listeners: Array<(session: unknown, event: SessionEventLike) => void> = []

  const ctx = {
    ...services,
    // The real service disappears from `ctx.get` while its provider is unloaded;
    // `detachSettings` reproduces that without disposing the whole context.
    get: (service: string): unknown =>
      (service === 'settings' && options.detachSettings === true ? undefined : (services as Record<string, unknown>)[service]),
    inject: (_dependencies: readonly string[], callback: (scope: HostContext) => void): void => {
      callback(ctx as unknown as HostContext)
    },
    on: (_event: string, listener: (session: unknown, event: SessionEventLike) => void): (() => void) => {
      listeners.push(listener)
      return () => {}
    },
  }
  return {
    ctx: ctx as unknown as HostContext,
    captured,
    emit: (event: SessionEventLike): void => { for (const listener of listeners) listener({}, event) },
  }
}

function sectionText(section: PromptSectionContribution | undefined): string {
  assert.ok(section)
  return typeof section.text === 'function' ? section.text({}) : section.text
}

async function callTool(
  host: { captured: Captured },
  args: unknown,
  signal: AbortSignal = new AbortController().signal,
): Promise<unknown> {
  const tool = host.captured.tools[0]
  assert.ok(tool)
  // Only `signal` is consulted by this tool body; the rest of the execution
  // identity (call id, agent, deferral hooks) is the registry's business.
  return tool.execute(args, { signal } as ToolRunContext)
}

async function callCommand(host: { captured: Captured }, rawInput: string) {
  const command = host.captured.commands[0]
  assert.ok(command)
  return command.handler({ rawInput })
}

test('apply mounts the section, provider, tool, command, and settings namespace', async () => {
  const host = createHost()
  apply(host.ctx, { defaultMode: 'full' })

  assert.equal(host.captured.sections[0]?.name, 'ponytail')
  assert.equal(host.captured.sections[0]?.order, 700)
  assert.equal(host.captured.tools[0]?.name, 'ponytail')
  assert.equal(host.captured.commands[0]?.name, 'ponytail')
  assert.equal(host.captured.providers.length, 1)
  assert.equal((await host.captured.providers[0]?.list())?.length, 6)

  const install = host.captured.installs[0]
  assert.ok(install)
  assert.equal(install.namespace, PONYTAIL_SETTINGS_NAMESPACE)
  assert.deepEqual(install.entry, { mode: 'full' })
  // The settings service serializes `schema.toJSON()` for the browser half, so
  // the namespace must carry a real schemastery schema.
  assert.equal(typeof (install.schema as { toJSON?: unknown }).toJSON, 'function')

  assert.match(sectionText(host.captured.sections[0]), /^PONYTAIL MODE ACTIVE — level: full\n\n/)
})

test('the tool persists a level through the settings document', async () => {
  const host = createHost()
  apply(host.ctx, { defaultMode: 'full' })

  assert.deepEqual(await callTool(host, {}), {
    mode: 'full', previous: 'full', changed: false, active: true,
  })

  const switched = await callTool(host, { mode: 'ultra' })
  assert.deepEqual(switched, { mode: 'ultra', previous: 'full', changed: true, active: true })
  assert.deepEqual(host.captured.updates, [{ namespace: PONYTAIL_SETTINGS_NAMESPACE, patch: { mode: 'ultra' } }])
  assert.match(sectionText(host.captured.sections[0]), /^PONYTAIL MODE ACTIVE — level: ultra\n\n/)

  const off = await callTool(host, { mode: 'off' })
  assert.deepEqual(off, { mode: 'off', previous: 'ultra', changed: true, active: false })
  assert.equal(sectionText(host.captured.sections[0]), '')

  // `defineTool` validates the enum before the body runs, so an unknown level
  // fails as a typed argument error rather than the old hand-rolled message.
  await assert.rejects(
    () => callTool(host, { mode: 'shrug' }),
    /invalid arguments: "mode" must be one of \["off","lite","full","ultra","review"\]/,
  )
})

test('review stays session-local because it is not a persistable level', async () => {
  const host = createHost()
  apply(host.ctx, { defaultMode: 'full' })

  const review = await callTool(host, { mode: 'review' })
  assert.deepEqual(review, { mode: 'review', previous: 'full', changed: true, active: true })
  assert.deepEqual(host.captured.updates, [])
  assert.match(sectionText(host.captured.sections[0]), /^PONYTAIL MODE ACTIVE — level: review\./)

  // A card write is a committed settings change: the service leaves the source
  // thunk alone and signals the commit through `onChange`.
  host.captured.installs[0]?.hooks.setSource(() => ({ mode: 'lite' }))
  host.captured.installs[0]?.hooks.onChange()
  assert.match(sectionText(host.captured.sections[0]), /^PONYTAIL MODE ACTIVE — level: lite\n\n/)
})

test('a refused settings write still applies the level for this session', async () => {
  const host = createHost({ failUpdate: true })
  apply(host.ctx, { defaultMode: 'full' })

  const warnings: string[] = []
  const originalWarn = console.warn
  console.warn = (message?: unknown): void => { warnings.push(String(message)) }
  try {
    const applied = await callTool(host, { mode: 'lite' })
    assert.deepEqual(applied, { mode: 'lite', previous: 'full', changed: true, active: true })
  } finally {
    console.warn = originalWarn
  }

  assert.equal(warnings.length, 1)
  assert.match(warnings[0] ?? '', /could not persist level "lite": settings document is read-only/)
  assert.match(sectionText(host.captured.sections[0]), /^PONYTAIL MODE ACTIVE — level: lite\n\n/)
})

test('the command switches and reports through the UI', async () => {
  const host = createHost()
  apply(host.ctx, { defaultMode: 'full' })

  assert.deepEqual(await callCommand(host, ''), { kind: 'success', text: 'Ponytail level: full.' })
  assert.deepEqual(await callCommand(host, ' lite '), {
    kind: 'success', text: 'Ponytail level: lite (was full).',
  })
  assert.deepEqual(host.captured.updates, [{ namespace: PONYTAIL_SETTINGS_NAMESPACE, patch: { mode: 'lite' } }])

  assert.deepEqual(await callCommand(host, 'normal mode'), {
    kind: 'success', text: 'Ponytail off (was lite). Normal behavior.',
  })
  assert.equal(sectionText(host.captured.sections[0]), '')

  assert.deepEqual(await callCommand(host, 'full'), {
    kind: 'success', text: 'Ponytail level: full (was off).',
  })

  const rejected = await callCommand(host, 'turbo')
  assert.equal(rejected.kind, 'error')
  assert.match(rejected.kind === 'error' ? rejected.text : '', /Unknown ponytail level "turbo"/)
})

test('the tool renders its canonical value for the model', async () => {
  const host = createHost()
  apply(host.ctx, { defaultMode: 'lite' })
  const tool = host.captured.tools[0]
  assert.ok(tool)

  const value = await callTool(host, { mode: 'full' })
  assert.deepEqual(tool.output.render({ mode: 'full' } as JsonValue, value as JsonValue), [
    { type: 'text', text: 'Ponytail level: full (was lite). The ruleset is injected into every request.' },
  ])

  assert.deepEqual(
    tool.output.render({} as JsonValue, { mode: 'off', previous: 'full', changed: true, active: false }),
    [{ type: 'text', text: 'Ponytail off (was full). Normal behavior.' }],
  )
})

test('apply fails loudly on configuration it cannot honor', () => {
  const host = createHost()
  // A row arrives as untyped YAML: the exported schema rejects this level while
  // the plugin loads, and this hand check is the backstop for a host that
  // mounts the plugin without validating the row.
  assert.throws(
    () => apply(host.ctx, { defaultMode: 'review' } as unknown as Config),
    /defaultMode must be one of off, lite, full, ultra/,
  )
})

test('an absent defaultMode still resolves through PONYTAIL_DEFAULT_MODE', () => {
  const host = createHost()
  const previous = process.env['PONYTAIL_DEFAULT_MODE']
  process.env['PONYTAIL_DEFAULT_MODE'] = 'ultra'
  try {
    // The exported schema declares no `.default()`, so an absent field reaches
    // `resolveDefaultMode` instead of being pre-filled to `full` by Cordis.
    apply(host.ctx)
    assert.deepEqual(host.captured.installs[0]?.entry, { mode: 'ultra' })
    assert.match(sectionText(host.captured.sections[0]), /^PONYTAIL MODE ACTIVE — level: ultra\n\n/)
  } finally {
    if (previous === undefined) delete process.env['PONYTAIL_DEFAULT_MODE']
    else process.env['PONYTAIL_DEFAULT_MODE'] = previous
  }
})

test('the tool declares the published argument schema', () => {
  const host = createHost()
  apply(host.ctx, { defaultMode: 'full' })
  const tool = host.captured.tools[0]
  assert.ok(tool)

  // The `defineTool` DSL compiles an implicit *open* object root, so unlike the
  // raw schema this replaces it declares no `additionalProperties`.
  assert.deepEqual(tool.parameters, {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        description: 'Level to activate. Omit to report the current level.',
        enum: ['off', 'lite', 'full', 'ultra', 'review'],
      },
    },
  })
  assert.deepEqual(tool.output.schema, {
    type: 'object',
    additionalProperties: false,
    properties: {
      mode: { type: 'string', enum: ['off', 'lite', 'full', 'ultra', 'review'] },
      previous: { type: 'string', enum: ['off', 'lite', 'full', 'ultra', 'review'] },
      changed: { type: 'boolean' },
      active: { type: 'boolean' },
    },
    required: ['mode', 'previous', 'changed', 'active'],
  })
})

test('a detached settings service is not written to', async () => {
  const host = createHost({ detachSettings: true })
  apply(host.ctx, { defaultMode: 'full' })

  // `ctx.get('settings')` is queried per call, so an unmounted service makes
  // the level session-local instead of reaching a detached one.
  const applied = await callTool(host, { mode: 'lite' })
  assert.deepEqual(applied, { mode: 'lite', previous: 'full', changed: true, active: true })
  assert.deepEqual(host.captured.updates, [])
})

test('the tool settles when the caller aborts a slow settings write', async () => {
  const host = createHost({ updateDelayMs: 50 })
  apply(host.ctx, { defaultMode: 'full' })

  const controller = new AbortController()
  const pending = callTool(host, { mode: 'ultra' }, controller.signal)
  controller.abort()

  const started = Date.now()
  const applied = await pending
  assert.ok(Date.now() - started < 40, 'the call settled before the write did')
  assert.deepEqual(applied, { mode: 'ultra', previous: 'full', changed: true, active: true })
})

/** Let the fire-and-forget settings write settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => { setTimeout(resolve, 0) })
}

/** One durable user message event carrying `text`. */
function userEvent(text: string, kind = 'user'): SessionEventLike {
  return { type: 'user/message', data: { source: { kind }, content: [{ type: 'text', text }] } }
}

test('a "stop ponytail" message turns the level off before the turn assembles', async () => {
  const host = createHost()
  apply(host.ctx, { defaultMode: 'full' })
  assert.match(sectionText(host.captured.sections[0]), /level: full/)

  host.emit(userEvent('stop ponytail'))

  // Synchronous: the turn that carried the command already assembles without
  // the ruleset, which is the whole point of watching the durable message.
  assert.equal(sectionText(host.captured.sections[0]), '')

  await settle()
  assert.deepEqual(host.captured.updates, [
    { namespace: PONYTAIL_SETTINGS_NAMESPACE, patch: { mode: 'off' } },
  ])
  // The committed document, not the session-local override, now says off.
  assert.equal(sectionText(host.captured.sections[0]), '')
})

test('"normal mode" works the same way', async () => {
  const host = createHost()
  apply(host.ctx, { defaultMode: 'ultra' })

  host.emit(userEvent('  Normal Mode! '))
  assert.equal(sectionText(host.captured.sections[0]), '')

  await settle()
  assert.deepEqual(host.captured.updates, [
    { namespace: PONYTAIL_SETTINGS_NAMESPACE, patch: { mode: 'off' } },
  ])
})

test('only the human\'s own words may deactivate', async () => {
  const host = createHost()
  apply(host.ctx, { defaultMode: 'full' })

  // Injected context rides the same event stream: a skill body or reference
  // that happens to read "normal mode" must not toggle the level.
  host.emit(userEvent('normal mode', 'skill-invocation'))
  // A message that merely mentions the phrase is not the command.
  host.emit(userEvent('add a normal mode toggle'))
  host.emit({ type: 'assistant/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'stop ponytail' }] } })
  host.emit({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'image' }] } })

  await settle()
  assert.deepEqual(host.captured.updates, [])
  assert.match(sectionText(host.captured.sections[0]), /level: full/)
})

test('an already-off level is not written again', async () => {
  const host = createHost()
  apply(host.ctx, { defaultMode: 'off' })

  host.emit(userEvent('stop ponytail'))
  await settle()

  assert.deepEqual(host.captured.updates, [])
})
