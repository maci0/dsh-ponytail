/**
 * dsh-ponytail — browser half.
 *
 * Renders the Ponytail card in Settings → Plugins → Plugin configuration. The
 * card is keyed on the `ponytail` settings namespace the host half registers,
 * which is the only thing the Plugins tab needs to know about it.
 *
 * This file is plain JavaScript on purpose. The client module system serves a
 * package's `exports["./client"]` artifact as a lazy-CJS factory registered on
 * `window.__ModuleLoader__`, and that is the whole format — an out-of-tree
 * plugin can author it directly instead of reproducing the repository's tsdown
 * client preset. `react` is provided by the module system; nothing else is
 * required here.
 *
 * The chrome mirrors the shipped plugin cards: a `<li>` disclosure whose header
 * button names the plugin, states the current level, and expands the controls
 * in place. Disclosure is card-local state, as it is for every card in the tab.
 */

window.__ModuleLoader__.load({
  id: 'dsh-ponytail',

  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    /** Settings namespace shared with the host half; also this card's slot key. */
    const NAMESPACE = 'ponytail'

    /** Levels a user may persist. `review` is session-only and lives on the command. */
    const LEVELS = [
      { value: 'off', label: 'Off', hint: 'No ruleset injected. Normal behavior.' },
      { value: 'lite', label: 'Lite', hint: 'Build what was asked, and name the lazier alternative in one line.' },
      { value: 'full', label: 'Full', hint: 'The ladder enforced: YAGNI, reuse, stdlib, native platform, one line, then the minimum that works.' },
      { value: 'ultra', label: 'Ultra', hint: 'Challenge whether the requirement needs to exist before building it.' },
    ]

    const S = {
      card: {
        listStyle: 'none',
        border: '0.5px solid var(--dsw-alias-border-l4)',
        borderRadius: '16px',
        background: 'var(--dsw-alias-bg-layer-3)',
        transition: 'border-color .16s, background .16s',
      },
      cardOpen: {
        background: 'var(--dsw-alias-bg-layer-2)',
        borderColor: 'var(--dsw-alias-label-dimmed)',
      },
      header: {
        width: '100%',
        appearance: 'none',
        border: 0,
        background: 'none',
        font: 'inherit',
        color: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '14px 16px',
        borderRadius: '12px',
      },
      headText: { flex: '1', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' },
      name: { fontSize: '15px', fontWeight: 600, lineHeight: 1.4, color: 'var(--dsw-alias-label-primary)' },
      description: { fontSize: '13px', lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' },
      chevron: {
        flex: 'none',
        width: '7px',
        height: '7px',
        marginTop: '-3px',
        borderRight: '1.5px solid var(--dsw-alias-label-tertiary)',
        borderBottom: '1.5px solid var(--dsw-alias-label-tertiary)',
        transition: 'transform .16s',
        transform: 'rotate(45deg)',
      },
      chevronOpen: { transform: 'rotate(225deg)', marginTop: '3px' },
      body: {
        borderTop: '0.5px solid var(--dsw-alias-border-l2)',
        margin: '0 16px',
        padding: '12px 0 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      },
      row: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
      pill: {
        appearance: 'none',
        font: 'inherit',
        fontSize: '13px',
        lineHeight: 1.5,
        padding: '5px 14px',
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-secondary)',
        background: 'none',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: '999px',
      },
      pillSelected: {
        color: 'var(--dsw-alias-label-primary)',
        borderColor: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-4)',
      },
      pillDisabled: { cursor: 'default', opacity: 0.5 },
      hint: { fontSize: '12px', lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' },
      status: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '12px',
        lineHeight: 1.5,
        color: 'var(--dsw-alias-label-tertiary)',
      },
      reset: {
        appearance: 'none',
        font: 'inherit',
        fontSize: '12px',
        lineHeight: 1.5,
        padding: '3px 10px',
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-secondary)',
        background: 'none',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: '8px',
      },
      error: { fontSize: '12px', lineHeight: 1.5, color: 'var(--dsw-alias-label-error)' },
    }

    /**
     * Build the card component over one bound settings scope.
     * @param scope - the scope bound to the ponytail namespace.
     * @returns the component the slot renders.
     */
    function createCard(scope) {
      const subscribe = (listener) => scope.subscribe(listener)
      const getSnapshot = () => scope.getSnapshot()

      return function PonytailCard() {
        const snapshot = React.useSyncExternalStore(subscribe, getSnapshot)
        const [open, setOpen] = React.useState(false)
        const [error, setError] = React.useState(null)

        // A namespace this deployment does not serve renders no trace of itself.
        if (snapshot.status !== 'ready') return null

        const value = snapshot.value !== null && typeof snapshot.value === 'object' ? snapshot.value : {}
        const user = snapshot.user !== null && typeof snapshot.user === 'object' ? snapshot.user : {}
        const current = typeof value.mode === 'string' ? value.mode : 'full'
        const overridden = Object.prototype.hasOwnProperty.call(user, 'mode')
        const disabled = !snapshot.writable
        const selected = LEVELS.filter((level) => level.value === current)[0] ?? LEVELS[2]

        const report = (cause) => {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
        const write = (run) => {
          setError(null)
          Promise.resolve(run()).catch(report)
        }

        return React.createElement(
          'li',
          { style: open ? { ...S.card, ...S.cardOpen } : S.card },
          React.createElement(
            'button',
            {
              type: 'button',
              style: S.header,
              'aria-expanded': open,
              'aria-label': `${open ? 'Collapse' : 'Expand'}: Ponytail`,
              onClick: () => { setOpen(!open) },
            },
            React.createElement(
              'span',
              { style: S.headText },
              React.createElement('span', { style: S.name }, 'Ponytail'),
              React.createElement(
                'span',
                { style: S.description },
                `Lazy senior dev mode — level: ${current}${overridden ? ' (overridden)' : ''}.`,
              ),
            ),
            React.createElement('span', {
              style: open ? { ...S.chevron, ...S.chevronOpen } : S.chevron,
              'aria-hidden': true,
            }),
          ),
          open
            ? React.createElement(
              'div',
              { style: S.body },
              React.createElement(
                'div',
                { style: S.row, role: 'radiogroup', 'aria-label': 'Ponytail level' },
                LEVELS.map((level) => React.createElement(
                  'button',
                  {
                    key: level.value,
                    type: 'button',
                    role: 'radio',
                    'aria-checked': current === level.value,
                    disabled,
                    style: current === level.value
                      ? { ...S.pill, ...S.pillSelected, ...(disabled ? S.pillDisabled : {}) }
                      : disabled ? { ...S.pill, ...S.pillDisabled } : S.pill,
                    onClick: () => { write(() => scope.set('mode', level.value)) },
                  },
                  level.label,
                )),
              ),
              React.createElement('div', { style: S.hint }, selected.hint),
              React.createElement(
                'div',
                { style: S.status },
                snapshot.writable
                  ? 'Applies to every request and persists in your settings.'
                  : 'Read-only: settings are not persisted in this deployment.',
                overridden
                  ? React.createElement(
                    'button',
                    {
                      type: 'button',
                      style: S.reset,
                      disabled,
                      onClick: () => { write(() => scope.unset('mode')) },
                    },
                    'Reset',
                  )
                  : null,
              ),
              error === null ? null : React.createElement('div', { style: S.error }, error),
            )
            : null,
        )
      }
    }

    /**
     * Mount the card into the Plugins section's per-namespace slot.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      const scope = ctx.settingsScope.bind({ namespace: NAMESPACE })
      const Card = createCard(scope)
      // The tab declares the slot; injecting waits for it to exist, so this
      // registration does not depend on plugin load order.
      ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
        name: 'settings.plugin.item',
        key: NAMESPACE,
      }, Card))
    }

    exports.apply = apply
    exports.inject = ['slots', 'settingsScope']
    return module.exports
  },
})
