/**
 * src/plugin-sandbox-runner.mjs
 *
 * Child process runner for sandboxed plugins.
 * Uses IPC RPC:
 * - Parent -> Child: {type:'rpc_req', id, method, params}
 * - Child  -> Parent: {type:'rpc_res', id, ok, result|error}
 *
 * Child calls back to parent for privileged operations via rpc('host.call', ...)
 */

let plugin = null;
let pluginId = null;
let pluginMod = null;

function rpcRes(id, ok, payload) {
    if (!process.send) return;
    process.send({ type: 'rpc_res', id, ok, ...(ok ? { result: payload } : { error: String(payload?.message || payload) }) });
}

async function rpcHostCall(method, params) {
    // Send a host call request to parent and await response
    const id = `host:${Math.random().toString(36).slice(2)}`;
    return await new Promise((resolve, reject) => {
        const onMsg = (m) => {
            if (!m || m.type !== 'rpc_res' || m.id !== id) return;
            process.off('message', onMsg);
            if (m.ok) resolve(m.result);
            else reject(new Error(m.error || 'host call failed'));
        };
        process.on('message', onMsg);
        process.send?.({ type: 'rpc_req', id, method: 'host.call', params: { method, params } });
    });
}

function makeHost() {
    return {
        wa: {
            async send(jid, msg) {
                return await rpcHostCall('wa.send', { jid, msg });
            },
            async react(jid, msgId, emoji) {
                return await rpcHostCall('wa.react', { jid, msgId, emoji });
            }
        },
        ai: {
            async chat(messages, model) {
                return await rpcHostCall('ai.chat', { messages, model });
            },
            async vision(imageUrl, prompt) {
                return await rpcHostCall('ai.vision', { imageUrl, prompt });
            },
            async image(prompt) {
                return await rpcHostCall('ai.image', { prompt });
            }
        }
    };
}

process.on('message', async (msg) => {
    try {
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'init') {
            plugin = msg.plugin;
            pluginId = String(plugin?.id || '').trim();
            const entryUrl = String(plugin?.entryUrl || '').trim();
            if (!pluginId || !entryUrl) throw new Error('Invalid init payload');
            pluginMod = await import(entryUrl);
            if (typeof pluginMod.init === 'function') {
                await pluginMod.init({ host: makeHost() });
            }
            return;
        }

        if (msg.type !== 'rpc_req') return;

        if (msg.method === 'plugin.onMessage') {
            if (!pluginMod || typeof pluginMod.onMessage !== 'function') {
                return rpcRes(msg.id, true, { handled: false });
            }
            const res = await pluginMod.onMessage({
                jid: msg.params?.jid,
                text: msg.params?.text,
                host: makeHost()
            });
            return rpcRes(msg.id, true, res || { handled: false });
        }

        // host.call handled by parent only
        if (msg.method === 'host.call') {
            return rpcRes(msg.id, false, new Error('host.call not supported in child'));
        }

        return rpcRes(msg.id, false, new Error(`Unknown method: ${msg.method}`));
    } catch (e) {
        if (msg?.type === 'rpc_req') return rpcRes(msg.id, false, e);
        // init errors are fatal
        process.exitCode = 1;
    }
});
