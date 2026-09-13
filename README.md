# dsh-ponytail

**Ponytail, lazy senior dev mode, as a DeepSeek Harness plugin.**

Adapted from [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) (MIT).
"He says nothing. He writes one line. It works."

| Capability | Extension point | Effect |
|---|---|---|
| Always-on ruleset | `ctx.systemPrompt.section()` | While a level other than `off` is active, the mode-filtered ponytail ruleset is part of every request. |
| Six skills | `ctx.skills.registerProvider()` | `ponytail`, `ponytail-review`, `ponytail-audit`, `ponytail-debt`, `ponytail-gain`, `ponytail-help` load through the `skill` tool. |
| Level control | `ctx.tools.register()` + `ctx.commands.register()` | The model calls the `ponytail` tool; the human types `/ponytail [lite\|full\|ultra\|review\|off]`. |
| Settings card | `ctx.settings.installSection()` + `settings.plugin.item` | A **Ponytail** card in Settings → Plugins → **Plugin configuration**, collapsed like the shipped cards and expanding to an Off/Lite/Full/Ultra picker. |

## The ladder

Before writing code, stop at the first rung that holds:

1. Does this need to exist at all? (YAGNI)
2. Already in this codebase? Reuse it.
3. Stdlib does it? Use it.
4. Native platform feature? Use it.
5. Already-installed dependency? Use it.
6. One line? One line.
7. Only then: the minimum code that works.

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
(`~/.dsh/settings.yaml`), so the card, the tool, and `/ponytail` all agree and
the choice survives a restart. `review` is session-only because it is a review
mode, not a level a deployment should start in; the tool and `/ponytail` still
accept it.

## Install

The plugin is two halves in one package and has no runtime dependencies beyond
`@deepseek-ai/schemastery` (the settings service serializes the namespace
schema with it):

- **host half** — `src/index.ts`, loaded by the Loader from the profile;
- **browser half** — `lib/client.js`, served by the client module system because
  the package declares `dsh.client` and exports `./client`.

### Every profile at once

```sh
node scripts/install.mjs            # add --dry-run to preview
```

The script adds the package as a dependency of each profile and appends the
plugin row to that profile's `cordis.patch.yml` (idempotently). Restart a
profile that is already running: a profile's patch layer reloads live, but a
package it has just started to resolve is safest picked up from a clean boot.

### By hand, one profile

```sh
dsh plugin --profile web add /path/to/dsh-ponytail
```

then add this row to `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: ponytail
      name: 'dsh-ponytail'
      config:
        defaultMode: full
```

`name` must stay the bare package specifier: the client module system resolves
the Loader entry's package, reads its `dsh.client` manifest, and serves
`exports["./client"]`.

### Why not `dsh plugin add` as a bundle?

The package deliberately does **not** declare `dsh.bundle`. `dsh plugin add`
would then append `dsh-ponytail` to `dsh.profile.bundles`, and a bundle list is
read at boot — a running profile would need a restart, and a profile that also
kept the patch row would insert the plugin twice. A plain dependency plus the
row applies on the next reload and stays idempotent. (`dsh plugin add` prints a
`declares no dsh.bundle` warning for that reason; it is expected.)

### Verify

After a restart of the profile and a **page refresh** of the Web client:

- Settings → Plugins → **Plugin configuration** shows the Ponytail card;
- the `skill` tool's catalog lists the six ponytail skills;
- `/ponytail` reports the current level in the composer.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `defaultMode` | `PONYTAIL_DEFAULT_MODE`, then `~/.config/ponytail/config.json`, then `full` | The composition-layer level. The user's settings namespace overrides it. Must be `off`, `lite`, `full`, or `ultra`. |
| `promptOrder` | `700` | System-prompt position of the ruleset (after the persona prefix, before tool guidance). |
| `skillsDir` | this package's `skills/` | Skill directory override. |
| `providerName` | `ponytail` | Provider name in the skill registry. |

Invalid configuration fails while the plugin loads rather than silently doing
the wrong thing.

## Layout

```
src/index.ts        host plugin: section, provider, tool, command, settings namespace
src/modes.ts        levels, the mode filter, the injected ruleset, default resolution
src/skills.ts       skills provider over skills/<name>/SKILL.md
src/frontmatter.ts  minimal frontmatter reader (plain, `>`, `|`, quoted scalars)
src/host.ts         structural declaration of the host surface
lib/client.js       browser half: the Ponytail settings card (loader factory format)
skills/             the six skills, verbatim from upstream
scripts/install.mjs wire the plugin into every profile
tests/              node:test unit + fake-host integration coverage
```

`lib/client.js` is plain JavaScript on purpose. The client module system serves
a package's `exports["./client"]` artifact as a lazy-CJS factory registered on
`window.__ModuleLoader__`; an out-of-tree plugin can author that directly
instead of reproducing the repository's tsdown client preset.

## Development

```sh
npm test          # node --test tests/*.test.ts (Node >= 22.6, no build step)
npm run typecheck # tsc --noEmit
```

## Limits

- **A plugin source edit needs a profile restart.** The Loader imports plugin
  modules with ESM semantics, so a live patch reload re-runs `apply` from the
  module already in memory. Changing `index.ts` means restarting the profile.
- **The level is process-wide.** The ruleset is a global prompt section and the
  level is one namespace value, so every agent in the process shares it.
- **One browser half, English copy.** The card renders its own chrome and labels
  and registers no locale dictionary, so its text is not translated.
- **`emit` modes**: a level change is not announced as a session event; a
  replayed session shows the ruleset each request already carried.

## Attribution and license

MIT. Skill content and mode semantics: © DietrichGebert
([ponytail](https://github.com/DietrichGebert/ponytail)). DSH port: see `LICENSE`.
