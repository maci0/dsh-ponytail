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
 * Chrome is a stylesheet, not inline style objects: the module system claims
 * every `<style>` tag a factory appends while it materializes and removes it
 * when the package unloads, so the tags cost nothing to own. It also keeps
 * state changes out of React's inline-style diffing, which is what silently
 * blanked a deselected pill's border (a longhand removed against a set
 * shorthand decomposes the shorthand).
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

    /** Every class is `dp-`-prefixed: the sheet lands in the page's own document. */
    const CSS = [
      '.dp-card{list-style:none;border:0.5px solid var(--dsw-alias-border-l4);border-radius:16px;background:var(--dsw-alias-bg-layer-3);transition:border-color .16s,background .16s}',
      '.dp-card-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}',
      '.dp-header{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px}',
      '.dp-head{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}',
      '.dp-name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}',
      '.dp-desc{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.dp-chevron{flex:none;width:7px;height:7px;margin-top:-3px;border-right:1.5px solid var(--dsw-alias-label-tertiary);border-bottom:1.5px solid var(--dsw-alias-label-tertiary);transition:transform .16s;transform:rotate(45deg)}',
      '.dp-chevron-open{transform:rotate(225deg);margin-top:3px}',
      '.dp-body{border-top:0.5px solid var(--dsw-alias-border-l2);margin:0 16px;padding:12px 0 8px;display:flex;flex-direction:column;gap:10px}',
      '.dp-row{display:flex;flex-wrap:wrap;gap:8px}',
      '.dp-pill{appearance:none;font:inherit;font-size:13px;line-height:1.5;padding:5px 14px;cursor:pointer;color:var(--dsw-alias-label-secondary);background:none;border:1px solid var(--dsw-alias-border-l2);border-radius:999px}',
      '.dp-pill-selected{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-4)}',
      '.dp-pill:disabled{cursor:default;opacity:.5}',
      '.dp-hint{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.dp-status{display:flex;align-items:center;gap:8px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.dp-reset{appearance:none;font:inherit;font-size:12px;line-height:1.5;padding:3px 10px;cursor:pointer;color:var(--dsw-alias-label-secondary);background:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}',
      '.dp-error{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-error)}',
      '.dp-chip{display:inline-flex;align-items:center;height:24px;padding:0 10px;max-width:180px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:12px;line-height:1.4;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);border-radius:999px}',
    ].join('')

    // Appended while the factory materializes: the module system claims the tag
    // for this package and disposes it on unload. Guarded because the node unit
    // tests evaluate this file without a DOM.
    if (typeof document !== 'undefined') {
      const style = document.createElement('style')
      style.textContent = CSS
      document.head.append(style)
    }

    /** Plugin version, shown in the card header. Bump with package.json. */
    const VERSION = '0.10.0'

    const en = {
      description: 'Lazy senior dev mode — level: {level}{overridden}.',
      version: 'v{version}',
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
      version: 'v{version}',
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

    /**
     * Bind one scope to a React subscription.
     * @param scope - a scope bound to the ponytail settings namespace.
     * @returns a hook reading that scope's current snapshot.
     */
    function useScope(scope) {
      const subscribe = (listener) => scope.subscribe(listener)
      const getSnapshot = () => scope.getSnapshot()
      return () => React.useSyncExternalStore(subscribe, getSnapshot)
    }

    /**
     * Read a snapshot's level. A namespace the deployment does not serve reports
     * no value, which every surface renders as nothing.
     * @param snapshot - the settings scope snapshot.
     * @returns the active level value, or `undefined` when unreadable.
     */
    function modeOf(snapshot) {
      if (snapshot.status !== 'ready') return undefined
      const value = snapshot.value !== null && typeof snapshot.value === 'object' ? snapshot.value : {}
      return typeof value.mode === 'string' ? value.mode : 'full'
    }

    /**
     * Build the card component over one bound settings scope.
     * @param scope - the scope bound to the ponytail namespace.
     * @param t - translate function bound to this plugin's locale namespace.
     * @returns the component the slot renders.
     */
    function createCard(scope, t) {
      const usePonytail = useScope(scope)

      return function PonytailCard() {
        const snapshot = usePonytail()
        const [open, setOpen] = React.useState(false)
        const [error, setError] = React.useState(null)

        const current = modeOf(snapshot)
        // A namespace this deployment does not serve renders no trace of itself.
        if (current === undefined) return null

        const user = snapshot.user !== null && typeof snapshot.user === 'object' ? snapshot.user : {}
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
          { className: `dp-card${open ? ' dp-card-open' : ''}` },
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dp-header',
              'aria-expanded': open,
              'aria-label': `${t(open ? 'collapse' : 'expand')}: Ponytail ${t('version', { version: VERSION })}`,
              onClick: () => { setOpen(!open) },
            },
            React.createElement(
              'span',
              { className: 'dp-head' },
              React.createElement('span', { className: 'dp-name' }, `Ponytail ${t('version', { version: VERSION })}`),
              React.createElement(
                'span',
                { className: 'dp-desc' },
                t('description', {
                  level: levelLabel(t, current),
                  overridden: overridden ? t('overridden') : '',
                }),
              ),
            ),
            React.createElement('span', {
              className: open ? 'dp-chevron dp-chevron-open' : 'dp-chevron',
              'aria-hidden': true,
            }),
          ),
          open
            ? React.createElement(
              'div',
              { className: 'dp-body' },
              React.createElement(
                'div',
                { className: 'dp-row', role: 'radiogroup', 'aria-label': t('levelGroup') },
                LEVELS.map((level) => React.createElement(
                  'button',
                  {
                    key: level.value,
                    type: 'button',
                    role: 'radio',
                    'aria-checked': current === level.value,
                    disabled,
                    className: `dp-pill${current === level.value ? ' dp-pill-selected' : ''}`,
                    onClick: () => { write(() => scope.set('mode', level.value)) },
                  },
                  t(level.label),
                )),
              ),
              React.createElement('div', { className: 'dp-hint' }, t(selected.hint)),
              React.createElement(
                'div',
                { className: 'dp-status' },
                snapshot.writable ? t('persists') : t('readOnly'),
                overridden
                  ? React.createElement(
                    'button',
                    {
                      type: 'button',
                      className: 'dp-reset',
                      disabled,
                      onClick: () => { write(() => scope.unset('mode')) },
                    },
                    t('reset'),
                  )
                  : null,
              ),
              error === null ? null : React.createElement('div', { className: 'dp-error' }, error),
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
      const usePonytail = useScope(scope)

      return function PonytailIndicator() {
        const current = modeOf(usePonytail())
        if (current === undefined || current === 'off') return null

        const text = t('indicator', { level: levelLabel(t, current) })
        return React.createElement('span', { className: 'dp-chip', title: text }, text)
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
        // The card's own copy, so the framework's `t` seat reads it from the
        // dictionary this plugin registered above.
        locale: LOCALE_NS,
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
