/**
 * dsh-ponytail — browser half.
 *
 * Two surfaces read one settings namespace:
 *
 * - the Ponytail card in Settings → Plugins → Plugin configuration, keyed on the
 *   `ponytail` namespace the host half registers; and
 * - a read-only level chip in the composer tool row (`conversation.input.left`),
 *   so the active level is visible without opening Settings.
 *
 * Both bind `ctx.settingsScope`, so they cannot disagree, and both take their
 * copy from the `ponytail` locale namespace registered here (en/zh), which is
 * also why every label has an English and a Chinese entry.
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

    /** Locale namespace for this plugin's copy: both surfaces read one dictionary. */
    const LOCALE_NS = 'ponytail'

    const en = {
      description: 'Lazy senior dev mode — level: {level}{overridden}.',
      overridden: ' (overridden)',
      expand: 'Expand',
      collapse: 'Collapse',
      levelGroup: 'Ponytail level',
      indicator: 'Ponytail: {level}',
      levelOff: 'Off',
      levelLite: 'Lite',
      levelFull: 'Full',
      levelUltra: 'Ultra',
      hintOff: 'No ruleset injected. Normal behavior.',
      hintLite: 'Build what was asked, and name the lazier alternative in one line.',
      hintFull: 'The ladder enforced: YAGNI, reuse, stdlib, native platform, one line, then the minimum that works.',
      hintUltra: 'Challenge whether the requirement needs to exist before building it.',
      persists: 'Applies to every request and persists in your settings.',
      readOnly: 'Read-only: settings are not persisted in this deployment.',
      reset: 'Reset',
    }

    const zh = {
      description: '懒人资深开发模式 — 级别：{level}{overridden}。',
      overridden: '（已覆盖）',
      expand: '展开',
      collapse: '收起',
      levelGroup: 'Ponytail 级别',
      indicator: 'Ponytail：{level}',
      levelOff: '关闭',
      levelLite: '轻量',
      levelFull: '完整',
      levelUltra: '极端',
      hintOff: '不注入任何规则集，行为如常。',
      hintLite: '按要求实现，并用一行指出更省的做法。',
      hintFull: '强制执行阶梯：YAGNI、复用、标准库、平台原生、已装依赖、一行，然后才是能用的最少代码。',
      hintUltra: '动手之前先质疑这个需求是否必须存在。',
      persists: '对每个请求生效，并保存在你的设置中。',
      readOnly: '只读：此部署不会持久化设置。',
      reset: '重置',
    }

    /** Levels a user may persist. `review` is session-only and lives on the command. */
    const LEVELS = [
      { value: 'off', label: 'levelOff', hint: 'hintOff' },
      { value: 'lite', label: 'levelLite', hint: 'hintLite' },
      { value: 'full', label: 'levelFull', hint: 'hintFull' },
      { value: 'ultra', label: 'levelUltra', hint: 'hintUltra' },
    ]

    /**
     * Localized name of a level, falling back to the raw value for one this card
     * does not offer (a hand-edited document, a future level).
     * @param t - translate function bound to this plugin's namespace.
     * @param mode - level value.
     * @returns the display name.
     */
    function levelLabel(t, mode) {
      const level = LEVELS.filter((candidate) => candidate.value === mode)[0]
      return level === undefined ? mode : t(level.label)
    }

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
        // Same `border` property as `card`, never `borderColor`: React clears a
        // removed longhand against a set shorthand, which decomposes it.
        border: '0.5px solid var(--dsw-alias-label-dimmed)',
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
        // Same `border` property as `pill`, never `borderColor`: React clears a
        // removed longhand against a set shorthand, which decomposes it and
        // wipes the pill's border on deselect.
        border: '1px solid var(--dsw-alias-label-primary)',
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
      // Read-only level chip for the composer tool row: the same state the card
      // edits, visible without opening Settings.
      chip: {
        display: 'inline-flex',
        alignItems: 'center',
        height: '24px',
        padding: '0 10px',
        maxWidth: '180px',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
        fontSize: '12px',
        lineHeight: 1.4,
        color: 'var(--dsw-alias-label-secondary)',
        background: 'var(--dsw-alias-bg-module-platform)',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: '999px',
      },
    }

    /**
     * Build the card component over one bound settings scope.
     * @param scope - the scope bound to the ponytail namespace.
     * @param t - translate function bound to this plugin's locale namespace.
     * @returns the component the slot renders.
     */
    function createCard(scope, t) {
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
              'aria-label': `${t(open ? 'collapse' : 'expand')}: Ponytail`,
              onClick: () => { setOpen(!open) },
            },
            React.createElement(
              'span',
              { style: S.headText },
              React.createElement('span', { style: S.name }, 'Ponytail'),
              React.createElement(
                'span',
                { style: S.description },
                t('description', {
                  level: levelLabel(t, current),
                  overridden: overridden ? t('overridden') : '',
                }),
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
                { style: S.row, role: 'radiogroup', 'aria-label': t('levelGroup') },
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
                  t(level.label),
                )),
              ),
              React.createElement('div', { style: S.hint }, t(selected.hint)),
              React.createElement(
                'div',
                { style: S.status },
                snapshot.writable ? t('persists') : t('readOnly'),
                overridden
                  ? React.createElement(
                    'button',
                    {
                      type: 'button',
                      style: S.reset,
                      disabled,
                      onClick: () => { write(() => scope.unset('mode')) },
                    },
                    t('reset'),
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
     * Build the read-only level chip for the composer tool row.
     *
     * It reads the same settings scope the card edits, so the two surfaces can
     * never disagree; it renders nothing while the namespace is unavailable or
     * the level is `off`, where a chip would only say "nothing is injected".
     * @param scope - the scope bound to the ponytail namespace.
     * @param t - translate function bound to this plugin's locale namespace.
     * @returns the component the composer slot renders.
     */
    function createIndicator(scope, t) {
      const subscribe = (listener) => scope.subscribe(listener)
      const getSnapshot = () => scope.getSnapshot()

      return function PonytailIndicator() {
        const snapshot = React.useSyncExternalStore(subscribe, getSnapshot)
        if (snapshot.status !== 'ready') return null

        const value = snapshot.value !== null && typeof snapshot.value === 'object' ? snapshot.value : {}
        const current = typeof value.mode === 'string' ? value.mode : 'full'
        if (current === 'off') return null

        const text = t('indicator', { level: levelLabel(t, current) })
        return React.createElement('span', { style: S.chip, title: text }, text)
      }
    }

    /**
     * Mount both browser surfaces: the Plugins card and the composer chip.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(LOCALE_NS)
      ctx.effect(
        () => ctx.locale.register(LOCALE_NS, { en, zh }),
        'dsh-ponytail: locale dictionary',
      )

      const scope = ctx.settingsScope.bind({ namespace: NAMESPACE })
      const Card = createCard(scope, t)
      const Indicator = createIndicator(scope, t)

      // Each owner declares its own slot; injecting waits for it to exist, so
      // these registrations do not depend on plugin load order.
      ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
        name: 'settings.plugin.item',
        key: NAMESPACE,
      }, Card))

      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left',
        id: 'ponytail-level',
        order: 20,
      }, Indicator))
    }

    exports.apply = apply
    exports.inject = ['slots', 'settingsScope', 'locale']
    return module.exports
  },
})
