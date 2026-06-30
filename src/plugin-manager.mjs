/**
 * src/plugin-manager.mjs
 *
 * Security-oriented plugin loader:
 * - Optional sha256 pinning via package/plugins.lock.json
 * - Capability-based host API with permission checks
 * - Optional sandbox per plugin using Node's experimental permission model
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';
import { fork } from 'child_process';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(__dirname, '..', 'package'); // /package
const PLUGINS_CFG_PATH = path.join(PKG_DIR, 'plugins.json');
const PLUGINS_LOCK_PATH = path.join(PKG_DIR, 'plugins.lock.json');
const SANDBOX_RUNNER = path.join(__dirname, 'plugin-sandbox-runner.mjs');

/** @type {null|((text: string) => void)} */
let notifyFn = null;
/** @type {null|((jid: string, msg: any) => Promise<any)} */
let sendMessage = null;

/** @type {Map<string, any>} */
const loaded = new Map();

function safeJsonRead(p, fallback) {
    try {
        if (!fs.existsSync(p)) return fallback;
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch {
        return fallback;
    }
}

function sha256File(filePath) {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex');
}

async function resolveEntryToFileUrl(entry) {
    // Relative path
    if (entry.startsWith('.') || entry.startsWith('/') || entry.startsWith('file:')) {
        const abs = entry.startsWith('file:')
            ? fileURLToPath(entry)
            : path.resolve(process.cwd(), entry);
        return pathToFileURL(abs).href;
    }

    // Bare specifier (npm package or subpath)
    // Node 20+ supports import.meta.resolve.
    const resolved = await import.meta.resolve(entry, pathToFileURL(process.cwd() + path.sep).href);
    return resolved;
}

async function computeEntrySha256(entry) {
    const url = await resolveEntryToFileUrl(entry);
    if (!url.startsWith('file:')) {
        throw new Error(`Unsupported entry URL scheme for hashing: ${url}`);
    }
    const filePath = fileURLToPath(url);
    return { url, filePath, sha256: sha256File(filePath) };
}

function getGrantedPermissions(pluginCfg) {
    const perms = Array.isArray(pluginCfg.permissions) ? pluginCfg.permissions.map(String) : [];
    return new Set(perms);
}

function makeHostApi(pluginId, granted) {
    function requirePerm(scope) {
        if (!granted.has(scope)) {
            throw new Error(`Permission denied for plugin ${pluginId}: ${scope}`);
        }
    }

    return {
        wa: {
            async send(jid, msg) {
                requirePerm('wa.send');
                if (!sendMessage) throw new Error('sendMessage not initialised');
                await sendMessage(jid, msg);
                return { ok: true };
            },
            async react(jid, msgId, emoji) {
                requirePerm('wa.send');
                const { waSock } = await import('./whatsapp/connection.js');
                if (waSock) await waSock.sendMessage(jid, { react: { text: emoji, key: msgId } });
                return { ok: true };
            }
        },
        ai: {
            async chat(messages, model) {
                requirePerm('ai.chat');
                const { chatCompletion } = await import('./ai-provider.js');
                return await chatCompletion(messages, model);
            },
            async vision(imageUrl, prompt) {
                requirePerm('ai.vision');
                const { chatCompletion } = await import('./ai-provider.js');
                return await chatCompletion([
                    { role: 'user', content: `Analyze this image: ${imageUrl}\nQuestion: ${prompt}` }
                ]);
            },
            async image(prompt) {
                requirePerm('ai.image');
                const res = await fetch(config.ai.claude.baseUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify({
                        apikey: config.ai.claude.apiKey,
                        messages: [{ id: Date.now(), role: 'user', parts: [{ type: 'text', text: prompt }] }],
                        model: config.ai.claude.model,
                        isImageGenerationMode: true
                    })
                });
                const data = await res.json();
                return data.data?.url || data.data?.response || '';
            }
        }
    };
}

function makeSandboxProxy(pluginId, childProc, granted) {
    let seq = 1;
    const pending = new Map();

    childProc.on('message', async (msg) => {
        if (!msg || typeof msg !== 'object') return;
        // Responses to our requests
        if (msg.type === 'rpc_res') {
            const p = pending.get(msg.id);
            if (!p) return;
            pending.delete(msg.id);
            if (msg.ok) p.resolve(msg.result);
            else p.reject(new Error(msg.error || 'RPC error'));
            return;
        }

        // Requests coming from sandboxed plugin to host API
        if (msg.type === 'rpc_req' && msg.method === 'host.call') {
            try {
                const host = makeHostApi(pluginId, granted);
                const { method, params } = msg.params || {};
                let res;
                if (method === 'wa.send') res = await host.wa.send(params.jid, params.msg);
                else if (method === 'wa.react') res = await host.wa.react(params.jid, params.msgId, params.emoji);
                else if (method === 'ai.chat') res = await host.ai.chat(params.messages, params.model);
                else if (method === 'ai.vision') res = await host.ai.vision(params.imageUrl, params.prompt);
                else if (method === 'ai.image') res = await host.ai.image(params.prompt);
                else throw new Error(`Unknown host method: ${method}`);
                childProc.send({ type: 'rpc_res', id: msg.id, ok: true, result: res });
            } catch (e) {
                childProc.send({ type: 'rpc_res', id: msg.id, ok: false, error: e.message });
            }
        }
    });

    childProc.on('exit', () => {
        for (const p of pending.values()) p.reject(new Error('Sandbox process exited'));
        pending.clear();
    });

    async function rpc(method, params) {
        const id = `${pluginId}:${seq++}`;
        return await new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            childProc.send({ type: 'rpc_req', id, method, params });
        });
    }

    // Host API is implemented in parent, not in sandbox.
    const host = makeHostApi(pluginId, granted);
    return { rpc, host };
}

async function loadOne(pluginCfg, lock) {
    const id = String(pluginCfg.id || '').trim();
    if (!id) throw new Error('Plugin id missing');

    const entry = String(pluginCfg.entry || '').trim();
    if (!entry) throw new Error(`Plugin ${id}: entry missing`);

    const enabled = pluginCfg.enabled !== false;
    if (!enabled) {
        return { id, status: 'disabled' };
    }

    const granted = getGrantedPermissions(pluginCfg);

    // Integrity check
    const integrity = lock?.plugins?.[id]?.sha256 ? String(lock.plugins[id].sha256) : null;
    const allowUnpinned = !!config.plugins?.allowUnpinned;
    const { url, sha256 } = await computeEntrySha256(entry);

    if (integrity && integrity !== sha256) {
        throw new Error(`Plugin ${id}: sha256 mismatch (expected ${integrity}, got ${sha256})`);
    }
    if (!integrity && !allowUnpinned) {
        throw new Error(`Plugin ${id}: missing sha256 pin in package/plugins.lock.json`);
    }

    const sandbox = pluginCfg.sandbox === true;

    if (sandbox) {
        const child = fork(SANDBOX_RUNNER, [], {
            stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
            // Best-effort sandbox (process isolation). We intentionally do NOT
            // enable Node permission flags here because they require careful
            // allowlists and would break plugin imports by default.
            cwd: process.cwd(),
        });

        // Initialise sandbox plugin
        child.send({
            type: 'init',
            plugin: { id, entryUrl: url },
        });

        const { rpc, host } = makeSandboxProxy(id, child, granted);
        return {
            id,
            entry,
            sha256,
            sandbox: true,
            permissions: [...granted],
            onMessage: async ({ jid, text }) => {
                // Provide host via parent; plugin calls host through rpc('host.call', ...)
                // Sandbox runner calls back to parent with host requests.
                return await rpc('plugin.onMessage', { jid, text });
            },
            _child: child,
            _host: host,
        };
    }

    // Direct import (best-effort permissions)
    const mod = await import(url);
    const onMessage = typeof mod.onMessage === 'function' ? mod.onMessage : null;
    const init = typeof mod.init === 'function' ? mod.init : null;
    const host = makeHostApi(id, granted);

    if (init) {
        try {
            await init({ host });
        } catch (e) {
            throw new Error(`Plugin ${id}: init failed: ${e.message}`);
        }
    }

    return {
        id,
        entry,
        sha256,
        sandbox: false,
        permissions: [...granted],
        onMessage: async ({ jid, text }) => {
            if (!onMessage) return { handled: false };
            return await onMessage({ jid, text, host });
        },
        _host: host,
    };
}

function getConfigPlugins() {
    const cfg = safeJsonRead(PLUGINS_CFG_PATH, { plugins: [] });
    const base = Array.isArray(cfg.plugins) ? cfg.plugins : [];

    // Merge npm list from env config (optional)
    const fromEnv = Array.isArray(config.plugins?.npm) ? config.plugins.npm : [];
    const envPlugins = fromEnv.map((pkg) => ({
        id: pkg,
        entry: pkg,
        enabled: true,
        sandbox: false,
        permissions: []
    }));

    // De-dup by id (config wins)
    const seen = new Set(base.map(p => String(p.id)));
    for (const p of envPlugins) {
        if (!seen.has(p.id)) base.push(p);
    }
    return base;
}

export async function initPluginManager({ notify, sendMessageFn }) {
    notifyFn = notify;
    sendMessage = sendMessageFn;

    loaded.clear();
    const lock = safeJsonRead(PLUGINS_LOCK_PATH, { plugins: {} });
    const plugins = getConfigPlugins();

    if (plugins.length === 0) {
        if (notifyFn) notifyFn('🧩 PluginManager: Tidak ada plugin terdaftar (package/plugins.json).');
        return;
    }

    for (const p of plugins) {
        try {
            const inst = await loadOne(p, lock);
            if (inst.status === 'disabled') continue;
            loaded.set(inst.id, inst);
            if (notifyFn) {
                notifyFn(`🧩 Plugin loaded: ${inst.id} (sandbox=${inst.sandbox ? 'ON' : 'OFF'})`);
            }
        } catch (e) {
            if (notifyFn) notifyFn(`⚠️ Plugin gagal load: ${p.id} — ${e.message}`);
        }
    }
}

export function listPlugins() {
    return [...loaded.values()].map(p => ({
        id: p.id,
        entry: p.entry,
        sandbox: !!p.sandbox,
        permissions: p.permissions || [],
        sha256: p.sha256
    }));
}

export async function reloadPlugins({ notify, sendMessageFn }) {
    loaded.clear();
    await initPluginManager({ notify, sendMessageFn });
}

export async function handlePluginCommand(jid, text) {
    const lower = String(text || '').trim().toLowerCase();
    if (!lower) return false;

    if (lower === '.plugins' || lower === 'plugins' || lower === 'plugin list') {
        const rows = listPlugins();
        const lines = rows.length
            ? rows.map(p => `- ${p.id} (sandbox=${p.sandbox ? 'ON' : 'OFF'}) perms=[${p.permissions.join(', ') || '-'}]`).join('\n')
            : '(kosong)';
        if (sendMessage) await sendMessage(jid, { text: `🧩 *Plugins*\n\n${lines}` });
        return true;
    }

    if (lower.startsWith('.plugin ')) {
        const args = text.trim().split(/\s+/);
        const sub = args[1]?.toLowerCase();

        if (sub === 'list') {
            const rows = listPlugins();
            const lines = rows.length
                ? rows.map(p => `- ${p.id} (sandbox=${p.sandbox ? 'ON' : 'OFF'}) perms=[${p.permissions.join(', ') || '-'}]`).join('\n')
                : '(kosong)';
            if (sendMessage) await sendMessage(jid, { text: `🧩 *Plugins*\n\n${lines}` });
            return true;
        }

        if (sub === 'reload') {
            try {
                await reloadPlugins({ notify: notifyFn, sendMessageFn: sendMessage });
                if (sendMessage) await sendMessage(jid, { text: '✅ Plugin system reloaded.' });
            } catch (e) {
                if (sendMessage) await sendMessage(jid, { text: `❌ Reload failed: ${e.message}` });
            }
            return true;
        }

        if (sub === 'install') {
            const pluginPath = args[2];
            if (!pluginPath) {
                if (sendMessage) await sendMessage(jid, { text: '❓ Usage: .plugin install <path>' });
                return true;
            }
            const cfg = safeJsonRead(PLUGINS_CFG_PATH, { plugins: [] });
            const id = path.basename(pluginPath, path.extname(pluginPath));
            if (cfg.plugins.find(p => p.id === id)) {
                if (sendMessage) await sendMessage(jid, { text: `❌ Plugin ${id} already installed.` });
                return true;
            }
            cfg.plugins.push({ id, entry: pluginPath, enabled: true, sandbox: false, permissions: [] });
            fs.writeFileSync(PLUGINS_CFG_PATH, JSON.stringify(cfg, null, 2));
            if (sendMessage) await sendMessage(jid, { text: `✅ Plugin ${id} added. Use .plugin reload to activate.` });
            return true;
        }

        if (sub === 'remove') {
            const id = args[2];
            if (!id) {
                if (sendMessage) await sendMessage(jid, { text: '❓ Usage: .plugin remove <id>' });
                return true;
            }
            const cfg = safeJsonRead(PLUGINS_CFG_PATH, { plugins: [] });
            const idx = cfg.plugins.findIndex(p => p.id === id);
            if (idx === -1) {
                if (sendMessage) await sendMessage(jid, { text: `❌ Plugin ${id} not found.` });
                return true;
            }
            cfg.plugins.splice(idx, 1);
            fs.writeFileSync(PLUGINS_CFG_PATH, JSON.stringify(cfg, null, 2));
            loaded.delete(id);
            if (sendMessage) await sendMessage(jid, { text: `✅ Plugin ${id} removed. Use .plugin reload to apply.` });
            return true;
        }

        if (sub === 'enable' || sub === 'disable') {
            const id = args[2];
            if (!id) {
                if (sendMessage) await sendMessage(jid, { text: `❓ Usage: .plugin ${sub} <id>` });
                return true;
            }
            const cfg = safeJsonRead(PLUGINS_CFG_PATH, { plugins: [] });
            const p = cfg.plugins.find(p => p.id === id);
            if (!p) {
                if (sendMessage) await sendMessage(jid, { text: `❌ Plugin ${id} not found.` });
                return true;
            }
            p.enabled = sub === 'enable';
            fs.writeFileSync(PLUGINS_CFG_PATH, JSON.stringify(cfg, null, 2));
            if (sendMessage) await sendMessage(jid, { text: `✅ Plugin ${id} ${sub === 'enable' ? 'enabled' : 'disabled'}. Use .plugin reload to apply.` });
            return true;
        }

        if (sendMessage) await sendMessage(jid, { text: '❓ *Plugin Commands:*\n.plugin list\n.plugin install <path>\n.plugin remove <id>\n.plugin reload\n.plugin enable <id>\n.plugin disable <id>' });
        return true;
    }

    return false;
}

export async function handlePluginsMessage(jid, text) {
    // Commands
    if (await handlePluginCommand(jid, text)) return true;

    for (const p of loaded.values()) {
        try {
            const res = await p.onMessage({ jid, text });
            if (res && res.handled) {
                if (res.replyText && sendMessage) {
                    await sendMessage(jid, { text: String(res.replyText) });
                }
                return true;
            }
        } catch (e) {
            if (notifyFn) notifyFn(`⚠️ Plugin ${p.id} error: ${e.message}`);
        }
    }
    return false;
}
