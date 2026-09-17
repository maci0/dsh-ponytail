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
import z from '@deepseek-ai/schemastery';
import { type RuntimeMode } from './modes.ts';
import type { HostContext } from './host.ts';
/** Plugin name as it appears in the loader. */
export declare const name = "ponytail";
/**
 * Settings namespace the browser card edits — the join key between this host
 * half and `lib/client.js`. The card registers into `settings.plugin.item`
 * under the same key, and the tab pairs the two without knowing what it means.
 */
export declare const PONYTAIL_SETTINGS_NAMESPACE = "ponytail";
/**
 * Persisted configuration. `review` is deliberately absent: it is a
 * session-only review mode, not a level a deployment may start in.
 */
export declare const PonytailSettings: z<Schemastery.ObjectS<{
    mode: z<"full" | "lite" | "off" | "ultra", "full" | "lite" | "off" | "ultra">;
}>, Schemastery.ObjectT<{
    mode: z<"full" | "lite" | "off" | "ultra", "full" | "lite" | "off" | "ultra">;
}>>;
/**
 * Configuration accepted from this plugin's row in a profile patch.
 *
 * The level is deliberately **not** defaulted here: a schema default is filled
 * by Cordis before {@link apply} runs, which would make an absent `defaultMode`
 * indistinguishable from an explicit one and hide the documented
 * `PONYTAIL_DEFAULT_MODE` fallback. Absence reaches {@link resolveDefaultMode}
 * instead; an invalid value still fails at load, because the union below
 * rejects it.
 */
export interface Config {
    /** Startup level (`off`, `lite`, `full`, `ultra`). Absent means the chain decides. */
    readonly defaultMode?: RuntimeMode;
}
/** Row schema: an absent level resolves through the environment chain. */
export declare const Config: z<Config>;
/**
 * Mount the plugin.
 * @param ctx - the host context.
 * @param config - optional row configuration.
 */
export declare function apply(ctx: HostContext, config?: Config): void;
