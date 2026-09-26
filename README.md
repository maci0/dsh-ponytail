# dsh-ponytail

Your agent adds a cache class, a config flag, and a factory for one product. This
plugin makes it stop and write the one line that works instead.

The ladder: question whether the thing needs to exist, reuse what is already in
the repo, then the standard library, then the platform, then an installed
dependency, then one line. Stop at the first rung that holds.

Adapted from [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) (MIT).
"He says nothing. He writes one line. It works."

## What you get

- **The ladder on every request.** While any level except `off` is active, the
  mode-filtered ruleset joins the system prompt.
- **Six skills** the `skill` tool can load, so they also appear as
  `/ponytail-review`, `/ponytail-audit`, … in the composer: `ponytail`,
  `ponytail-review`, `ponytail-audit`, `ponytail-debt`, `ponytail-gain`,
  `ponytail-help`.
- **Two ways to switch level.** The model calls the `ponytail` tool; you type
  `/ponytail <level>` or just say **stop ponytail**.
- **A settings card and a composer chip**, so the level is visible without opening Settings.
- **No unrequested abstractions, no boilerplate.** Deletion over addition, boring
  over clever.

## Install

```sh
dsh plugin --profile web add github:maci0/dsh-ponytail   # untagged spec tracks main
```

The package declares `dsh.bundle`, so `dsh plugin add` appends it to
`dsh.profile.bundles` and the row in its own `cordis.patch.yml` applies as a
layer. Bundle layers compose at boot, so **restart `dsh web`**. To pick up a newer
commit later, run `dsh plugin --profile web update dsh-ponytail` and restart again.

Do **not** also paste that `id: ponytail` row into your profile's own
`cordis.patch.yml`: `insert` does not dedupe ids, and a second row mounts the
plugin twice.

## Try it

```
/ponytail ultra   -> Ponytail level: ultra (was full).
/ponytail         -> Ponytail level: ultra.
/ponytail off     -> Ponytail off (was ultra). Normal behavior.
```

Then ask for the work. This is the `full` example from the skill itself:

```
> Add a cache for these API responses.

`@lru_cache(maxsize=1000)` on the fetch function. Skipped custom cache class,
add when lru_cache measurably falls short.
```

Model side, the tool takes one optional argument: `{"mode": "lite"}` sets and
persists a level, and calling it with no argument reports the current one.

Typing **stop ponytail** or **normal mode** as an ordinary message has the same
effect as `/ponytail off`, and it lands on the turn that carried it. Only the
human's own words count — injected context riding the same event stream cannot
toggle the level, and the message must *be* the command: "add a normal mode
toggle" is left alone.

## Levels

| Level | Behavior | Persisted |
|---|---|---|
| `lite` | Build what was asked, name the lazier alternative in one line. | yes |
| `full` | The ladder enforced. Default. | yes |
| `ultra` | YAGNI extremist: challenge the requirement before building it. | yes |
| `review` | Over-engineering review; points at the `ponytail-review` skill. | no — session only |
| `off` | No injection. Normal behavior. | yes |

The four persistable levels live in the `ponytail` settings namespace, so the
card, the chip, the tool, and `/ponytail` always agree and the choice survives a
restart. `review` stays session-only because it is a review mode, not a level a
deployment should start in; the tool and the command still accept it.

Lazy is not negligent. Understanding the problem, trust-boundary validation,
data-loss handling, security, and accessibility are never on the chopping block.

## Configure

| Field | Default | Meaning |
|---|---|---|
| `defaultMode` | `full` | Startup level. Must be `off`, `lite`, `full`, or `ultra`. |

The exported `Config` schema defaults the field, so a row that omits `defaultMode`
starts in `full`. The user's settings namespace overrides it once a level is chosen
in the card or by `/ponytail`. An invalid level fails while the plugin loads rather
than quietly doing the wrong thing: the loader validates the row against the
exported schema.

To set the startup level from the environment, override the row in your profile's
`cordis.patch.yml` with a `!!js` expression (same `id`, which replaces the row's
whole `config`):

```yaml
- id: ponytail
  config:
    defaultMode: !!js process.env.PONYTAIL_DEFAULT_MODE ?? 'full'
```

## How it works

The host half mounts through public Cordis extension points — `systemPrompt.section`,
`skills.registerProvider`, `tools.register`, `commands.register`,
`loader/volatile-update` (the settings document writes the row's volatile
`defaultMode`), and `session/event` for the message switch. The browser half draws
its card into the public `plugins.row.config` slot from `configForms`, registers its
copy through `locale.register`, and draws its chip into `conversation.input.left`, so
this plugin needs no client change of its own.

The entry point is the built `lib/index.js` (declarations in `lib/types/`); `npm run
build` regenerates it from `src/`. `lib/client.js` is hand-authored plain JavaScript —
the client module system serves it as a lazy-CJS factory on `window.__ModuleLoader__`
because the package exports `./client`, and it is not built. Skills come from
`skills/<name>/SKILL.md` with frontmatter parsed by `yaml`; the provider takes its rank
and name grammar from `@deepseek-ai/dsh-skill`, projects `disable-model-invocation`,
`user-invocable`, and `whenToUse`, and settles on the lookup's abort signal. Tools use
`defineTool` from `@deepseek-ai/dsh-tools` and forward `exec.signal`. Only
`skills/ponytail/SKILL.md` is the source of truth for the ruleset; this README keeps no
second copy.

## What it does not do

- **It does not skip comprehension.** The ladder shortens the solution, never the
  reading. The skill says so in its own text.
- **The level is process-wide.** One prompt section, one namespace value: every
  agent in the process shares it.
- **External subagents ignore it.** In-process children inherit the ruleset, but
  `subagent-claude-code` and `subagent-codex` spawn their own CLI with its own
  system prompt, and no harness extension point wraps a spawn.
- **Two locales.** The card and the chip ship `en` and `zh`; any other locale
  falls back through the service's own chain.
- **Host source edits need `npm run build` and a restart**, because the Loader
  loads `lib/index.js` and a bundle layer composes at boot.
- **Browser-half edits need a page refresh.**
- **A level change is not a session event.** A replayed session shows the ruleset
  each request already carried.

## Development

```sh
npm install         # real install
npm run build       # tsc -p tsconfig.build.json -> lib/index.js + lib/types/
npm test            # node --test tests/*.test.ts (Node ^22.19 || >=24, no build step)
npm run typecheck   # tsc -p tsconfig.json
```

The suite covers level normalization and filtering, the fake-host surface, the skills
provider, the client card, and a real Cordis composition mount next to the real skill
registry. To uninstall, run `dsh plugin --profile web remove dsh-ponytail`; that removes
the dependency and the bundle layer together.

## Attribution and license

MIT. Skill content and mode semantics: © DietrichGebert
([ponytail](https://github.com/DietrichGebert/ponytail)). DSH port: see `LICENSE`.

The six `skills/*/SKILL.md` files are verbatim copies, so they carry upstream's figures
and citations rather than this package's. `/ponytail-gain` therefore reports the original
five-task single-shot benchmark — 80–94% fewer lines, 47–77% cheaper, 3–6× faster —
which upstream's own README has since revised to roughly 54% fewer lines, 20% cheaper
and 27% faster on its agentic benchmark; and its `Source:` line names `benchmarks/`,
which this package does not ship.
