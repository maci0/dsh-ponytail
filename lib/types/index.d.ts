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
 * Configuration accepted from this plugin's row in a profile patch.
 *
 * The level is defaulted in the schema below, so the loader fills an absent
 * `defaultMode` with `full` before {@link apply} runs; an invalid value still
 * fails at load, because the union rejects it.
 */
export interface Config {
    /** Startup level (`off`, `lite`, `full`, `ultra`). */
    readonly defaultMode?: RuntimeMode;
}
/** Row schema: an absent level is filled by the loader before `apply`. */
export declare const Config: z<Config>;
/**
 * Mount the plugin.
 * @param ctx - the host context.
 * @param config - optional row configuration.
 */
export declare function apply(ctx: HostContext, config?: Config): void;
