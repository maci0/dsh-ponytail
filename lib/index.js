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
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { buildModeInstructions, DEFAULT_MODE, isDeactivationCommand, normalizeCommandMode, normalizeMode, resolveDefaultMode, RUNTIME_MODES, VALID_MODES, } from './modes.js';
import { createSkillProvider } from './skills.js';
import { parseFrontmatter } from './frontmatter.js';
/** Plugin name as it appears in the loader. */
export const name = 'ponytail';
/**
 * Settings namespace the browser card edits — the join key between this host
 * half and `lib/client.js`. The card registers into `settings.plugin.item`
 * under the same key, and the tab pairs the two without knowing what it means.
 */
export const PONYTAIL_SETTINGS_NAMESPACE = 'ponytail';
/**
 * Persisted configuration. `review` is deliberately absent: it is a
 * session-only review mode, not a level a deployment may start in.
 */
export const PonytailSettings = z.object({
    mode: z.union([...RUNTIME_MODES]).default(DEFAULT_MODE),
});
/** Row schema: an absent level resolves through the environment chain. */
export const Config = z.object({
    defaultMode: z.union([...RUNTIME_MODES]),
});
/**
 * Mount the plugin.
 * @param ctx - the host context.
 * @param config - optional row configuration.
 */
export function apply(ctx, config = {}) {
    // Reject configuration that would silently do the wrong thing.
    if (config.defaultMode !== undefined && normalizeMode(config.defaultMode) === undefined) {
        throw new Error(`[ponytail] defaultMode must be one of ${RUNTIME_MODES.join(', ')}; got ${JSON.stringify(config.defaultMode)}`);
    }
    // `<package>/skills`, resolved from this module's own location.
    const skillsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');
    const startup = resolveDefaultMode({ configured: config.defaultMode });
    // Parsed once, at load: the ruleset is filtered per assembly, so the
    // frontmatter must not have to be re-read for every request. A missing body
    // means a broken install: fail while loading rather than injecting a silently
    // truncated ruleset.
    const skillBody = parseFrontmatter(readFileSync(join(skillsDir, 'ponytail', 'SKILL.md'), 'utf8')).body.trimStart();
    // Owned by this mount, so a reload cannot read another instance's blocks.
    const instructionCache = new Map();
    const warn = (message) => {
        console.warn(`[ponytail] ${message}`);
    };
    /** Session-local level, used when the settings document cannot hold the write. */
    let override;
    /** Authoritative configuration source: the settings scope once attached, else the row. */
    let source = () => ({ mode: startup });
    const configuredMode = () => {
        const value = source();
        if (value === null || typeof value !== 'object')
            return undefined;
        return normalizeMode(value.mode);
    };
    const activeMode = () => override ?? configuredMode() ?? startup;
    /** The mounted settings service, or `undefined` while none is attached. */
    const settingsService = () => {
        const service = ctx.get('settings');
        return service === undefined || service === null ? undefined : service;
    };
    /**
     * Persist a level through the settings document; false when it cannot hold it.
     *
     * The service is queried at the use site rather than captured from the
     * `inject` callback: the callback's fiber disposes when the settings service
     * unloads, and a captured reference would then let a later write reach a
     * detached service.
     * @param next - the level to commit.
     * @param signal - caller cancellation; an aborted call commits nothing.
     * @returns whether the document accepted the level.
     */
    const persist = async (next, signal) => {
        const settings = settingsService();
        if (settings === undefined || normalizeMode(next) === undefined)
            return false;
        try {
            await abortable(settings.update(PONYTAIL_SETTINGS_NAMESPACE, { mode: next }), signal);
            return true;
        }
        catch (error) {
            warn(`could not persist level "${next}": ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    };
    const setMode = async (next, signal) => {
        const previous = activeMode();
        override = (await persist(next, signal)) ? undefined : next;
        const mode = activeMode();
        return { previous, mode, changed: mode !== previous };
    };
    /**
     * Turn the level off because the human's own message was a deactivation
     * command.
     *
     * The override is set before the settings write is awaited: the durable
     * `user/message` event arrives before the turn's prompt is assembled, and
     * awaiting the document would let that same turn assemble with the ruleset
     * still injected — the one turn the user just asked to end. A committed
     * document then becomes the source of truth again, so the card and the
     * prompt cannot disagree.
     */
    const deactivateFromMessage = () => {
        if (activeMode() === 'off')
            return;
        override = 'off';
        void persist('off').then((persisted) => {
            if (persisted)
                override = undefined;
        });
    };
    ctx.inject(['settings'], (scope) => {
        // The section is an effect on this callback's fiber, so it unregisters with
        // it; the service itself is re-queried at each use site instead of captured.
        scope.settings.installSection(ctx, PONYTAIL_SETTINGS_NAMESPACE, PonytailSettings, { mode: startup }, {
            setSource: (current) => {
                source = current;
            },
            // Fires at attach and after every committed change. A settings change
            // supersedes a session-local override; the ruleset itself is re-read at
            // each assembly, so there is nothing else to re-judge here.
            onChange: () => {
                override = undefined;
            },
        });
    });
    ctx.inject(['systemPrompt'], (scope) => {
        scope.systemPrompt.section({
            name: 'ponytail',
            order: 700, // after the persona prefix, before tool guidance
            // Evaluated at each assembly, so a level change lands on the next request.
            // `off` returns empty text, which assembly drops.
            text: () => buildModeInstructions({ mode: activeMode(), skillBody }, instructionCache),
        });
    });
    ctx.inject(['skills'], (scope) => {
        scope.skills.registerProvider(() => createSkillProvider({ skillsDir, onWarn: warn }));
    });
    ctx.inject(['tools'], (scope) => {
        scope.tools.register(createModeTool(activeMode, setMode));
    });
    ctx.inject(['commands'], (scope) => {
        scope.commands.register({
            name: 'ponytail',
            description: '✂ Set the ponytail level (lite, full, ultra, review, off) or report the current one.',
            input: { hint: 'lite | full | ultra | review | off' },
            handler: async (invocation) => handleModeCommand(invocation, activeMode, setMode),
        });
    });
    // "stop ponytail" / "normal mode" typed as an ordinary message, given the
    // same effect as `/ponytail off`. The command path is unaffected: this only
    // claims messages that are exactly the command and come from the human.
    ctx.on('session/event', (_session, event) => {
        if (event.type !== 'user/message')
            return;
        const text = userMessageText(event.data);
        if (text === undefined || !isDeactivationCommand(text))
            return;
        deactivateFromMessage();
    });
}
/**
 * Read the plain text of a genuine user message.
 *
 * Injected context (skill bodies, file references, replayed history) rides the
 * same event stream, so a message only counts when the harness marks it as the
 * user's own; an injected instruction that happened to read "normal mode" must
 * never toggle the level.
 * @param data - the `user/message` event payload.
 * @returns the concatenated text blocks, or `undefined` when this is not the
 * human's own text.
 */
function userMessageText(data) {
    if (data === null || typeof data !== 'object')
        return undefined;
    const message = data;
    if (message.source?.kind !== 'user')
        return undefined;
    if (!Array.isArray(message.content))
        return undefined;
    const text = message.content
        .map((block) => (block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
        .join('\n');
    return text.trim() === '' ? undefined : text;
}
/**
 * Await `work`, settling early when `signal` aborts.
 *
 * The settings write is not interruptible from here, so the abandoned promise
 * still settles on its own; only its rejection is absorbed, and the tool call
 * returns before the write it no longer waits for.
 * @param work - the in-flight write.
 * @param signal - caller cancellation.
 * @returns the write's result once it settles.
 */
function abortable(work, signal) {
    if (signal === undefined || signal.aborted)
        return work;
    return new Promise((resolve, reject) => {
        const onAbort = () => reject(new Error('aborted'));
        signal.addEventListener('abort', onAbort, { once: true });
        work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
}
/**
 * Build the model-facing level tool.
 * @param getMode - reads the active level.
 * @param setMode - applies and persists a level.
 * @returns the registered tool definition.
 */
function createModeTool(getMode, setMode) {
    return defineTool({
        name: 'ponytail',
        // The `enum` below already names every level, and the injected ruleset
        // explains what each one does; repeating both here only costs tokens.
        description: 'Set or report the ponytail level, which governs how much code is written. '
            + 'The level persists in the user settings document. '
            + 'Call with no arguments to report the current level.',
        parameters: {
            mode: {
                type: 'string',
                enum: [...VALID_MODES],
                description: 'Level to activate. Omit to report the current level.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    mode: { type: 'string', enum: [...VALID_MODES], required: true },
                    previous: { type: 'string', enum: [...VALID_MODES], required: true },
                    changed: { type: 'boolean', required: true },
                    active: { type: 'boolean', required: true },
                },
            },
            render: (_args, value) => [{ type: 'text', text: renderModeResult(value) }],
        },
        async execute(args, exec) {
            const requested = readModeArgument(args);
            const previous = getMode();
            if (requested === undefined) {
                return { mode: previous, previous, changed: false, active: previous !== 'off' };
            }
            const applied = await setMode(requested, exec.signal);
            return {
                mode: applied.mode,
                previous: applied.previous,
                changed: applied.changed,
                active: applied.mode !== 'off',
            };
        },
    });
}
/**
 * Read the optional `mode` argument.
 *
 * `defineTool` already rejected a value outside the enum, so this is the
 * narrow read for argument shapes that reach the body without that gate (the
 * plugin's own tests, and any host that registers the definition directly).
 * @param args - losslessly snapshotted model arguments.
 * @returns the requested level, or `undefined` for a status query.
 */
function readModeArgument(args) {
    if (args === null || typeof args !== 'object')
        return undefined;
    const raw = args['mode'];
    if (raw === undefined || raw === null || raw === '')
        return undefined;
    const mode = normalizeCommandMode(raw);
    if (mode === undefined) {
        throw new Error(`Unknown ponytail level ${JSON.stringify(raw)}. Use one of: ${VALID_MODES.join(', ')}.`);
    }
    return mode;
}
/**
 * Phrase one level outcome. Shared by the model-facing tool and the human
 * command, which report the same three transitions.
 * @param mode - the level now active.
 * @param previous - the level before the call.
 * @param changed - whether the call moved the level.
 * @returns the sentence both surfaces start from.
 */
function modeSentence(mode, previous, changed) {
    if (!changed)
        return `Ponytail level: ${mode}.`;
    return mode === 'off'
        ? `Ponytail off (was ${previous}). Normal behavior.`
        : `Ponytail level: ${mode} (was ${previous}).`;
}
/**
 * Render the canonical tool value for the model.
 * @param value - the canonical value returned by `execute`.
 * @returns model-facing prose.
 */
function renderModeResult(value) {
    const record = (value ?? {});
    const mode = typeof record['mode'] === 'string' ? record['mode'] : 'unknown';
    const previous = typeof record['previous'] === 'string' ? record['previous'] : mode;
    const changed = record['changed'] === true;
    const active = record['active'] === true;
    if (!changed && !active)
        return 'Ponytail is off. Normal behavior.';
    const sentence = modeSentence(mode, previous, changed);
    return active ? `${sentence} The ruleset is injected into every request.` : sentence;
}
/**
 * Handle the human `/ponytail [level]` command.
 * @param invocation - the command invocation.
 * @param getMode - reads the active level.
 * @param setMode - applies and persists a level.
 * @returns the direct-UI result.
 */
async function handleModeCommand(invocation, getMode, setMode) {
    const input = invocation.rawInput.trim().toLowerCase();
    if (input === '')
        return { kind: 'success', text: modeSentence(getMode(), getMode(), false) };
    const requested = isDeactivationCommand(input) ? 'off' : normalizeCommandMode(input);
    if (requested === undefined) {
        return {
            kind: 'error',
            text: `Unknown ponytail level "${invocation.rawInput.trim()}". Use one of: ${VALID_MODES.join(', ')}.`,
        };
    }
    const { previous, mode, changed } = await setMode(requested);
    return { kind: 'success', text: modeSentence(mode, previous, changed) };
}
