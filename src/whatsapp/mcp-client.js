import { config } from '../config.js';
import { error as logError } from '../logger.js';

export async function callMCPTool(endpoint, params = {}) {
    const baseUrl = config.mcp?.baseUrl || "http://localhost:8765";
    const headers = { "Content-Type": "application/json" };
    if (config.mcp?.apiKey) {
        headers["Authorization"] = `Bearer ${config.mcp.apiKey}`;
    }
    try {
        const res = await fetch(`${baseUrl}/api/${endpoint}`, {
            method: "POST",
            headers,
            body: JSON.stringify(params),
            signal: AbortSignal.timeout(55000)
        });
        if (!res.ok) {
            const err = await res.text();
            return { error: `MCP ${endpoint} failed (${res.status}): ${err}` };
        }
        return await res.json();
    } catch (e) {
        return { error: `MCP ${endpoint} unreachable: ${e.message}` };
    }
}

function extractMcpText(result) {
    if (typeof result === "string") return result;
    return result.content?.[0]?.text || JSON.stringify(result);
}

export async function handleMcpTags(aiResult, from, waSock) {
    // MCP_SEARCH
    const mcpSearchRegex = /\[MCP_SEARCH\|(.*?)\]/g;
    let m;
    while ((m = mcpSearchRegex.exec(aiResult)) !== null) {
        const query = m[1].trim();
        try {
            const result = await callMCPTool("search", { query });
            if (result.error) {
                if (from && waSock) await waSock.sendMessage(from, { text: `Search error: ${result.error}` }).catch(() => {});
            } else {
                if (from && waSock) await waSock.sendMessage(from, { text: extractMcpText(result) }).catch(() => {});
            }
        } catch(e) { logError("MCP_SEARCH failed:", e); }
    }
    aiResult = aiResult.replace(mcpSearchRegex, '');

    // MCP_FILE_READ
    const mcpFileReadRegex = /\[MCP_FILE_READ\|(.*?)\]/g;
    while ((m = mcpFileReadRegex.exec(aiResult)) !== null) {
        const filePath = m[1].trim();
        try {
            const result = await callMCPTool("file/read", { path: filePath });
            if (result.error) {
                if (from && waSock) await waSock.sendMessage(from, { text: `File read error: ${result.error}` }).catch(() => {});
            } else {
                if (from && waSock) await waSock.sendMessage(from, { text: extractMcpText(result) }).catch(() => {});
            }
        } catch(e) { logError("MCP_FILE_READ failed:", e); }
    }
    aiResult = aiResult.replace(mcpFileReadRegex, '');

    // MCP_FILE_WRITE
    const mcpFileWriteRegex = /\[MCP_FILE_WRITE\|([^\]]*?)\|([\s\S]*?)\]/g;
    while ((m = mcpFileWriteRegex.exec(aiResult)) !== null) {
        const filePath = m[1].trim();
        const content = m[2].trim();
        try {
            const result = await callMCPTool("file/write", { path: filePath, content });
            if (result.error) {
                if (from && waSock) await waSock.sendMessage(from, { text: `File write error: ${result.error}` }).catch(() => {});
            } else {
                if (from && waSock) await waSock.sendMessage(from, { text: `File written: ${filePath}` }).catch(() => {});
            }
        } catch(e) { logError("MCP_FILE_WRITE failed:", e); }
    }
    aiResult = aiResult.replace(mcpFileWriteRegex, '');

    // MCP_CRON
    const mcpCronRegex = /\[MCP_CRON\|(.*?)\|(.*?)\|(.*?)\]/g;
    while ((m = mcpCronRegex.exec(aiResult)) !== null) {
        const id = m[1].trim();
        const schedule = m[2].trim();
        const command = m[3].trim();
        try {
            const result = await callMCPTool("cron", { id, schedule, command });
            if (result.error) {
                if (from && waSock) await waSock.sendMessage(from, { text: `Cron error: ${result.error}` }).catch(() => {});
            } else {
                if (from && waSock) await waSock.sendMessage(from, { text: `Cron set: ${id} (${schedule})` }).catch(() => {});
            }
        } catch(e) { logError("MCP_CRON failed:", e); }
    }
    aiResult = aiResult.replace(mcpCronRegex, '');

    // MCP_NOTIFY
    const mcpNotifyRegex = /\[MCP_NOTIFY\|(.*?)\|(.*?)\]/g;
    while ((m = mcpNotifyRegex.exec(aiResult)) !== null) {
        try {
            await callMCPTool("notification", { title: m[1].trim(), content: m[2].trim() });
        } catch(e) { logError("MCP_NOTIFY failed:", e); }
    }
    aiResult = aiResult.replace(mcpNotifyRegex, '');

    // MCP_DEVICE
    if (/\[MCP_DEVICE\]/.test(aiResult)) {
        try {
            const result = await callMCPTool("device", {});
            if (from && waSock) await waSock.sendMessage(from, { text: extractMcpText(result) }).catch(() => {});
        } catch(e) { logError("MCP_DEVICE failed:", e); }
    }
    aiResult = aiResult.replace(/\[MCP_DEVICE\]/g, '');

    // MCP_BATTERY
    if (/\[MCP_BATTERY\]/.test(aiResult)) {
        try {
            const result = await callMCPTool("battery", {});
            if (from && waSock) await waSock.sendMessage(from, { text: extractMcpText(result) }).catch(() => {});
        } catch(e) { logError("MCP_BATTERY failed:", e); }
    }
    aiResult = aiResult.replace(/\[MCP_BATTERY\]/g, '');

    // MCP_NETWORK
    if (/\[MCP_NETWORK\]/.test(aiResult)) {
        try {
            const result = await callMCPTool("network", {});
            if (from && waSock) await waSock.sendMessage(from, { text: extractMcpText(result) }).catch(() => {});
        } catch(e) { logError("MCP_NETWORK failed:", e); }
    }
    aiResult = aiResult.replace(/\[MCP_NETWORK\]/g, '');

    return aiResult;
}
