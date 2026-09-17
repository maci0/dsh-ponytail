/**
 * The slice of the DeepSeek Harness host surface this plugin uses, declared
 * structurally.
 *
 * These interfaces describe the exact contracts the plugin calls; the host
 * types remain authoritative, and every service is reached through
 * `ctx.inject([...])`, so a composition that does not mount one simply omits
 * that capability.
 *
 * @module dsh-ponytail/host
 */
export {};
