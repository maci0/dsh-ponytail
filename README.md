# dsh-ponytail

**Ponytail, lazy senior dev mode, as a DeepSeek Harness plugin.**

Adapted from [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) (MIT).
"He says nothing. He writes one line. It works."

| Capability | Extension point | Effect |
|---|---|---|
| Always-on ruleset | `ctx.systemPrompt.section()` | While a level other than `off` is active, the mode-filtered ponytail ruleset is part of every request. |
| Six skills | `ctx.skills.registerProvider()` | `ponytail`, `ponytail-review`, `ponytail-audit`, `ponytail-debt`, `ponytail-gain`, `ponytail-help` load through the `skill` tool — and so appear as `/ponytail-review`, `/ponytail-audit`, … in the composer, which is DSH's own command surface for user-invocable skills. |
| Level control | `ctx.tools.register()` + `ctx.commands.register()` + `ctx.on('session/event')` | The model calls the `ponytail` tool; the human types `/ponytail [lite\|full\|ultra\|review\|off]` or just says **stop ponytail** / **normal mode**. |
| Settings card | `ctx.settings.installSection()` + `settings.plugin.item` | A **Ponytail** card in Settings → Plugins → **Plugin configuration**, collapsed like the shipped cards and expanding to an Off/Lite/Full/Ultra picker. |
| Composer chip | `conversation.input.left` | A read-only level chip in the composer tool row, so the active level is visible without opening Settings. Hidden while the level is `off`. |
| Localized copy | `ctx.locale.register()` | The card and the chip ship `en` + `zh` dictionaries under the `ponytail` locale namespace. |

## The ladder

Seven rungs — YAGNI, reuse, stdlib, native platform, already-installed
dependency, one line, then the minimum code that works.
`skills/ponytail/SKILL.md` is the source of truth, and it is the exact text
injected into every request while a level other than `off` is active; this
README deliberately keeps no second copy of it.

Lazy, not negligent: understanding the problem, trust-boundary validation,
data-loss handling, security, and accessibility are never on the chopping block.

## Levels

| Level | Behavior | Persisted |
|---|---|---|
| `lite` | Build what was asked, name the lazier alternative in one line. | yes |
| `full` | The ladder enforced. Default. | yes |
| `ultra` | YAGNI extremist: challenge the requirement before building it. | yes |
| `review` | Over-engineering review; points at the `ponytail-review` skill. | no — session only |
| `off` | No injection. Normal behavior. | yes |

The four persistable levels live in the `ponytail` settings namespace
(`~/.dsh/settings.yaml`), so the card, the chip, the tool, and `/ponytail` all
agree and the choice survives a restart. `review` is session-only because it is
a review mode, not a level a deployment should start in; the tool and
`/ponytail` still accept it.

### Switching from a message

`/ponytail full` is a command. Typing **stop ponytail** or **normal mode** as an
ordinary message is picked up from the durable `user/message` event, which
arrives before the turn's prompt is assembled — so the turn that carried the
command already runs without the ruleset, rather than one turn later.

Only the human's own words count. Injected context (a skill body, a file
reference, replayed history) rides the same event stream and can never toggle
the level, and the message must *be* the command: "add a normal mode toggle" is
left alone.

One deliberate difference from upstream, which clears only the session mode:
this writes the same `off` that `/ponytail off` writes, because in DSH the level
*is* the persisted preference and a session-only override would leave the card
and the chip reporting something the prompt does not do.

## Halves

The plugin is two halves in one package. Its runtime dependencies are declared
at the exact versions the running harness resolves — `@deepseek-ai/dsh-tools`
(the tool DSL), `@deepseek-ai/schemastery` (the settings service serializes the
namespace schema with it), and `yaml` (frontmatter) — never a range: the
`dsh-*` `latest` tag is stale, so a range would install a version the host does
not run.

- **host half** — `lib/index.js`, built from `src/index.ts` by `npm run build` and
  loaded by the Loader from the profile;
- **browser half** — `lib/client.js`, served by the client module system because
  the package declares `dsh.client` and exports `./client`.

## Install

The package declares `dsh.bundle`, so it installs as a profile layer and its own
`cordis.patch.yml` inserts the Loader row:

```sh
dsh plugin --profile web add /path/to/dsh-ponytail
```

That is the whole install: `dsh` appends the package to
`dsh.profile.bundles`, and the row in the package's `cordis.patch.yml` is
applied. Do **not** also paste that row into the profile's own
`cordis.patch.yml` — `insert` does not dedupe ids, and two rows mount the plugin
twice. The profile patch is for the plain-dependency case only: a checkout added
without `dsh.bundle` (or a manual `link:` entry) is not a layer, so it needs

```yaml
- insert:
    - id: ponytail
      name: dsh-ponytail
      config:
        defaultMode: full
```

There `dsh.profile.bundles` stays untouched, and saving the file remounts the
plugin because that file is what `patchReload: live` watches. A bundle patch is
composed at boot instead, so after `npm run build` restart `dsh` — the profile
patch file is the only live-watched layer.

## Verify

After a `dsh` start that mounts the plugin (and a **page refresh** of the Web client the first time):

- Settings → Plugins → **Plugin configuration** shows the Ponytail card;
- the `skill` tool's catalog lists the six ponytail skills;
- the composer tool row shows a `Ponytail: full` chip until the level is `off`;
- `/ponytail` reports the current level in the composer;
- sending exactly `stop ponytail` in a message turns the chip off and the next
  request carries no ruleset.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `defaultMode` | unset | The composition-layer level. When the row omits it, `PONYTAIL_DEFAULT_MODE` decides, and `full` decides after that. The exported `Config` schema deliberately declares no default, so an absent field is still absent when `apply` resolves the chain. The user's settings namespace overrides it. Must be `off`, `lite`, `full`, or `ultra`. |

An invalid level fails while the plugin loads rather than silently doing the
wrong thing: the schema rejects the row, and `apply` re-checks it.

## Layout

```
src/index.ts        host plugin: section, provider, tool, command, message watcher, settings namespace
src/modes.ts        levels, the mode filter, the injected ruleset, default resolution
src/skills.ts       skills provider over skills/<name>/SKILL.md
src/frontmatter.ts  frontmatter reader over `yaml`
src/host.ts         structural declaration of the host surface
lib/index.js        built host half: what the Loader resolves and loads
lib/types/          its declarations
lib/client.js       browser half: the settings card + the composer chip (loader factory format)
cordis.patch.yml    the Loader row this package's bundle layer applies
skills/             the six skills, verbatim from upstream
tests/              node:test unit + fake-host integration coverage
```

`lib/client.js` is plain JavaScript on purpose. The client module system serves
a package's `exports["./client"]` artifact as a lazy-CJS factory registered on
`window.__ModuleLoader__`; an out-of-tree plugin can author that directly
instead of reproducing the repository's tsdown client preset.

Its chrome is a stylesheet, not inline style objects. The factory appends one
`<style>` tag while it materializes, which the module system claims for this
package and removes on unload. That keeps every state change (card open, pill
selected, disabled) out of React's inline-style diffing — a removed style key
is cleared with an empty string, which decomposes a shorthand set alongside it,
and that is what silently blanked a deselected pill's border in v0.3.1.

## Development

```sh
npm test          # node --test tests/*.test.ts (Node ^22.19 || >=24, no build step)
npm run typecheck # tsc --noEmit
npm run build     # tsc -p tsconfig.build.json -> lib/index.js + lib/types
```

## Uninstall

```sh
dsh plugin --profile web remove dsh-ponytail
```

That removes the dependency and the bundle layer. If it was installed as a plain
dependency instead, delete the `id: ponytail` row from
`~/.dsh/profiles/<profile>/cordis.patch.yml`; saving unmounts it.

## Limits

- **Host source edits need `npm run build` and a restart.** The Loader loads
  `lib/index.js`, and a bundle layer is composed at boot; with `id: hmr` and this
  checkout in `config.root`, a remount still re-runs `apply` from the loaded
  `lib/index.js`, not from `src/`.
- **A browser-half edit needs a page refresh.** The client module system serves
  `exports["./client"]` from the package, so the host half can stay up.
- **The level is process-wide.** The ruleset is a global prompt section and the
  level is one namespace value, so every agent in the process shares it.
- **Two locales.** The card and the chip ship `en` and `zh`; any other active
  locale falls back through the service's own chain.
- **External subagents are out of reach.** In-process children join the parent
  composition and inherit the ruleset, but `subagent-claude-code` and
  `subagent-codex` spawn their own CLI with its own system prompt, and no
  harness extension point wraps a spawn. Upstream covers this with a
  `SubagentStart` hook; DSH has the equivalent of no such hook to register.
- **`emit` modes**: a level change is not announced as a session event; a
  replayed session shows the ruleset each request already carried.

## Attribution and license

MIT. Skill content and mode semantics: © DietrichGebert
([ponytail](https://github.com/DietrichGebert/ponytail)). DSH port: see `LICENSE`.

The six `skills/*/SKILL.md` files are verbatim copies, so they carry upstream's
figures and citations rather than this package's. `/ponytail-gain` therefore
reports the original five-task single-shot benchmark — 80–94% fewer lines,
47–77% cheaper, 3–6× faster — which upstream's own README has since revised to
roughly 54% fewer lines, 20% cheaper and 27% faster on its agentic benchmark;
and its `Source:` line names `benchmarks/`, which this package does not ship.
Both are left as written rather than forked, because a fork re-diverges at every
upstream sync.
