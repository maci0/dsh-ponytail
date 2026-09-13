import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const bundlePath = join(packageRoot, 'lib', 'client.js')

interface Element {
  type: unknown
  props: Record<string, unknown>
  children: unknown[]
}

/** Minimal React stub with stateful hooks, so a click can be re-rendered. */
function createReactStub() {
  const hooks: unknown[] = []
  let cursor = 0
  return {
    reset: (): void => { cursor = 0 },
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element => ({
      type,
      props: props ?? {},
      children: children.flat(),
    }),
    useSyncExternalStore: (_subscribe: () => void, getSnapshot: () => unknown): unknown => getSnapshot(),
    useState: (initial: unknown): [unknown, (next: unknown) => void] => {
      const slot = cursor
      cursor += 1
      if (hooks.length <= slot) hooks[slot] = initial
      return [hooks[slot], (next: unknown) => {
        hooks[slot] = typeof next === 'function' ? (next as (prev: unknown) => unknown)(hooks[slot]) : next
      }]
    },
  }
}

type ReactStub = ReturnType<typeof createReactStub>

interface Snapshot {
  status: string
  value: unknown
  user: unknown
  writable: boolean
}

/** Load the bundle the way the client module system does and return its exports. */
function loadBundle(snapshot: Snapshot, calls: { set: unknown[][]; unset: unknown[][] }) {
  const react = createReactStub()
  const scope = {
    subscribe: (): (() => void) => () => {},
    getSnapshot: (): Snapshot => snapshot,
    set: async (field: string, value: unknown): Promise<void> => { calls.set.push([field, value]) },
    unset: async (field: string): Promise<void> => { calls.unset.push([field]) },
  }

  const bound: Record<string, unknown>[] = []
  const injected: string[] = []
  const registered: { entry: Record<string, unknown>; component: () => Element | null }[] = []
  const ctx = {
    settingsScope: { bind: (spec: Record<string, unknown>) => { bound.push(spec); return scope } },
    slots: {
      inject: (name: string, callback: () => unknown): void => { injected.push(name); callback() },
      register: (entry: Record<string, unknown>, component: () => Element | null) => {
        registered.push({ entry, component })
        return () => {}
      },
    },
  }

  let loaded: { id: string; factory: (require: (id: string) => unknown) => Record<string, unknown> } | undefined
  const windowStub = { __ModuleLoader__: { load: (registration: typeof loaded): void => { loaded = registration } } }
  const requireFn = (id: string): unknown => {
    assert.equal(id, 'react', `the bundle may only require react, got ${id}`)
    return react
  }

  // The bundle is plain JavaScript in the loader's factory format.
  new Function('window', 'require', readFileSync(bundlePath, 'utf8'))(windowStub, requireFn)
  assert.ok(loaded, 'the bundle registered itself on window.__ModuleLoader__')
  assert.equal(loaded.id, 'dsh-ponytail')

  const exported = loaded.factory(requireFn)
  ;(exported['apply'] as (ctx: unknown) => void)(ctx)
  return { exported, bound, injected, registered, react }
}

/** Collect every element in a rendered tree. */
function walk(node: unknown, found: Element[] = []): Element[] {
  if (node === null || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    for (const child of node) walk(child, found)
    return found
  }
  const element = node as Element
  if ('props' in element && 'type' in element) {
    found.push(element)
    for (const child of element.children) walk(child, found)
  }
  return found
}

/** Render one component through the stub, resetting its hook cursor. */
function render(react: ReactStub, component: () => Element | null): Element[] {
  react.reset()
  return walk(component())
}

function buttons(tree: Element[]): Element[] {
  return tree.filter((element) => element.type === 'button')
}

function radios(tree: Element[]): Element[] {
  return tree.filter((element) => element.props['role'] === 'radio')
}

/** Expand the collapsed card and render it open. */
function expand(react: ReactStub, component: () => Element | null): Element[] {
  const collapsed = render(react, component)
  ;(buttons(collapsed)[0]?.props['onClick'] as () => void)()
  return render(react, component)
}

test('the card binds the ponytail namespace and registers into the plugins tab', () => {
  const calls = { set: [] as unknown[][], unset: [] as unknown[][] }
  const { exported, bound, injected, registered } = loadBundle(
    { status: 'ready', value: { mode: 'lite' }, user: { mode: 'lite' }, writable: true },
    calls,
  )

  assert.deepEqual(exported['inject'], ['slots', 'settingsScope'])
  assert.deepEqual(bound, [{ namespace: 'ponytail' }])
  assert.deepEqual(injected, ['settings.plugin.item'])
  assert.equal(registered.length, 1)
  assert.equal(registered[0]?.entry['name'], 'settings.plugin.item')
  assert.equal(registered[0]?.entry['key'], 'ponytail')
})

test('the card renders collapsed, naming the plugin and the current level', () => {
  const calls = { set: [] as unknown[][], unset: [] as unknown[][] }
  const { registered, react } = loadBundle(
    { status: 'ready', value: { mode: 'lite' }, user: {}, writable: true },
    calls,
  )

  const component = registered[0]?.component
  assert.ok(component)
  const tree = render(react, component)

  assert.equal(tree.filter((element) => element.type === 'li').length, 1)
  assert.equal(buttons(tree).length, 1)
  const header = buttons(tree)[0]
  assert.ok(header)
  assert.equal(header.props['aria-expanded'], false)
  assert.equal(header.props['aria-label'], 'Expand: Ponytail')
  assert.deepEqual(radios(tree), [])

  const text = tree
    .filter((element) => typeof element.children[0] === 'string' && element.children.length === 1)
    .map((element) => element.children[0])
  assert.deepEqual(text, ['Ponytail', 'Lazy senior dev mode — level: lite.'])
})

test('expanding reveals one radio per persisted level and writes the chosen one', () => {
  const calls = { set: [] as unknown[][], unset: [] as unknown[][] }
  const { registered, react } = loadBundle(
    { status: 'ready', value: { mode: 'full' }, user: {}, writable: true },
    calls,
  )

  const component = registered[0]?.component
  assert.ok(component)
  const open = expand(react, component)

  assert.equal(buttons(open)[0]?.props['aria-expanded'], true)
  assert.equal(buttons(open)[0]?.props['aria-label'], 'Collapse: Ponytail')
  const levels = radios(open)
  assert.deepEqual(levels.map((radio) => radio.children[0]), ['Off', 'Lite', 'Full', 'Ultra'])
  assert.deepEqual(levels.map((radio) => radio.props['aria-checked']), [false, false, true, false])

  ;(levels[3]?.props['onClick'] as () => void)()
  assert.deepEqual(calls.set, [['mode', 'ultra']])
})

test('an overridden level is called out and offers a reset', () => {
  const calls = { set: [] as unknown[][], unset: [] as unknown[][] }
  const { registered, react } = loadBundle(
    { status: 'ready', value: { mode: 'ultra' }, user: { mode: 'ultra' }, writable: true },
    calls,
  )

  const component = registered[0]?.component
  assert.ok(component)
  const open = expand(react, component)

  const text = open.map((element) => element.children[0])
  assert.ok(text.includes('Lazy senior dev mode — level: ultra (overridden).'))

  const reset = buttons(open).find((button) => button.children[0] === 'Reset')
  assert.ok(reset, 'the reset control renders while the field is overridden')
  ;(reset.props['onClick'] as () => void)()
  assert.deepEqual(calls.unset, [['mode']])
})

test('the card disables its controls when the host document is not writable', () => {
  const calls = { set: [] as unknown[][], unset: [] as unknown[][] }
  const { registered, react } = loadBundle(
    { status: 'ready', value: { mode: 'full' }, user: {}, writable: false },
    calls,
  )

  const component = registered[0]?.component
  assert.ok(component)
  const open = expand(react, component)

  const levels = radios(open)
  assert.equal(levels.length, 4)
  for (const level of levels) assert.equal(level.props['disabled'], true)
})

test('an unavailable namespace renders no trace of the card', () => {
  const calls = { set: [] as unknown[][], unset: [] as unknown[][] }
  const { registered, react } = loadBundle(
    { status: 'loading', value: undefined, user: undefined, writable: false },
    calls,
  )

  const component = registered[0]?.component
  assert.ok(component)
  react.reset()
  assert.equal(component(), null)
})
