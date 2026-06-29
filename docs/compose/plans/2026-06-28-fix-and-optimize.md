# OpenXX Fix & Full Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix critical bugs, decompose the monolithic 1356-line `whatsapp.js` into focused modules, add config caching, and improve reliability.

**Architecture:** Extract WhatsApp logic into `src/whatsapp/` modules by responsibility (connection, message routing, AI processing, file management, queue, commands). Create missing OpenRouter provider. Add config caching layer. Fix all identified bugs.

**Tech Stack:** Node.js ESM, @whiskeysockets/baileys, @openrouter/sdk, node-cron, chalk, pino, qrcode-terminal

## Global Constraints

- All files use ESM (`type: "module"` in package.json)
- Keep existing functionality 100% intact — no feature changes
- Follow existing code style (no comments unless asked, minimal error handling)
- Preserve all WhatsApp message formats and AI tag protocols
- Keep `package/` directory structure for user-facing configs

## File Structure

```
src/
├── whatsapp/
│   ├── connection.js        — WhatsApp socket, QR, reconnect, auto-post
│   ├── message-router.js    — Message routing (status, channels, DMs, groups)
│   ├── ai-processor.js      — askAI() + all [TAG] handlers
│   ├── file-manager.js      — File save/load/delete/rename/list + 5-digit ID
│   ├── queue.js             — AI message queue + background ADB queue
│   ├── sensitive-actions.js — Confirmation tokens, pending actions, execution
│   ├── commands.js          — .personality, .model, file, bg commands
│   ├── mcp-client.js        — callMCPTool() + MCP tag handlers
│   └── helpers.js           — stripMarkdown, generateFileId, etc.
├── providers/
│   ├── openrouter.js        — NEW: OpenRouter provider (currently missing!)
│   └── rest.js              — Moved from package/openx/providers/rest.js
├── ai-provider.js           — Moved from package/openx/ai-provider.js
├── config.js                — Enhanced with caching + MCP URL from env
├── logger.js                — Keep as-is (sync append is fine for this scale)
├── adb-connect.js           — Moved from adb_connect.js
├── adb-helper.js            — Moved from package/adb_helper.js
└── downloader.js            — Moved from package/downloader.js
index.js                     — Updated imports to use src/ modules
```

---

### Task 1: Fix Critical Bugs (No Refactor Yet)

**Covers:** Missing OpenRouter provider, duplicate regex, setInterval leak, config warning, pnpm test

**Files:**
- Create: `package/openx/providers/openrouter.js`
- Modify: `whatsapp.js:518-522` (stripMarkdown duplicate)
- Modify: `whatsapp.js:930-947` (setInterval leak)
- Modify: `config.js:46-49` (REST warning only when REST provider)
- Modify: `package.json:9` (pnpm test script)

**Interfaces:**
- Consumes: `@openrouter/sdk` (already in package.json dependencies)
- Produces: `chatCompletion(messages, model, isComplex)` function matching rest.js signature

- [ ] **Step 1: Create missing OpenRouter provider**

```javascript
// package/openx/providers/openrouter.js
import { config } from "../../../config.js";

let client = null;
let keyIndex = 0;

function getClient() {
    if (client) return client;
    const keys = config.ai?.openrouter?.apiKeys || config.openrouter?.apiKeys || [];
    if (keys.length === 0) throw new Error("No OpenRouter API keys configured");
    const { OpenRouter } = await import("@openrouter/sdk");
    client = new OpenRouter({ apiKey: keys[0] });
    return client;
}

function getNextKey() {
    const keys = config.ai?.openrouter?.apiKeys || config.openrouter?.apiKeys || [];
    if (keys.length === 0) throw new Error("No OpenRouter API keys configured");
    const key = keys[keyIndex % keys.length];
    keyIndex = (keyIndex + 1) % keys.length;
    return key;
}

export async function chatCompletion(messages, model = null, isComplex = false) {
    const keys = config.ai?.openrouter?.apiKeys || config.openrouter?.apiKeys || [];
    if (keys.length === 0) throw new Error("No OpenRouter API keys configured");

    const apiKey = getNextKey();
    const { OpenRouter } = await import("@openrouter/sdk");
    const or = new OpenRouter({ apiKey });

    const targetModel = model || "stepfun/step-3.5-flash:free";
    
    const response = await or.chat.completions.create({
        model: targetModel,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
    });

    return response.choices?.[0]?.message?.content || "";
}
```

Note: The `getClient` function has an issue — `await` inside non-async. Let me fix:

```javascript
// package/openx/providers/openrouter.js
import { config } from "../../../config.js";

let keyIndex = 0;

function getNextKey() {
    const keys = config.ai?.openrouter?.apiKeys || config.openrouter?.apiKeys || [];
    if (keys.length === 0) throw new Error("No OpenRouter API keys configured");
    const key = keys[keyIndex % keys.length];
    keyIndex = (keyIndex + 1) % keys.length;
    return key;
}

export async function chatCompletion(messages, model = null, isComplex = false) {
    const keys = config.ai?.openrouter?.apiKeys || config.openrouter?.apiKeys || [];
    if (keys.length === 0) throw new Error("No OpenRouter API keys configured");

    const { OpenRouter } = await import("@openrouter/sdk");
    const or = new OpenRouter({ apiKey: getNextKey() });

    const targetModel = model || "stepfun/step-3.5-flash:free";
    
    const response = await or.chat.completions.create({
        model: targetModel,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
    });

    return response.choices?.[0]?.message?.content || "";
}
```

- [ ] **Step 2: Run test to verify OpenRouter provider works**

Run: `node -e "import('./package/openx/providers/openrouter.js').then(m => console.log('OK:', typeof m.chatCompletion))"`
Expected: `OK: function`

- [ ] **Step 3: Fix duplicate regex in stripMarkdown**

In `whatsapp.js`, line 521-522, remove the duplicate `.replace(/\*\*/g, '')`:

```javascript
// BEFORE (lines 518-531):
function stripMarkdown(text) {
    if (!text) return text;
    return text
        .replace(/\*\*/g, '')    // line 521
        .replace(/\*\*/g, '')    // line 522 — DUPLICATE, remove
        .replace(/__/g, '')
        .replace(/_/g, '')
        .replace(/`/g, '')
        .replace(/\[\]/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/#{1,6}\s/g, '')
        .replace(/\n\s*\n/g, '\n\n')
        .trim();
}

// AFTER:
function stripMarkdown(text) {
    if (!text) return text;
    return text
        .replace(/\*\*/g, '')
        .replace(/__/g, '')
        .replace(/_/g, '')
        .replace(/`/g, '')
        .replace(/\[\]/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/#{1,6}\s/g, '')
        .replace(/\n\s*\n/g, '\n\n')
        .trim();
}
```

- [ ] **Step 4: Fix setInterval leak in connection handler**

In `whatsapp.js`, wrap the setInterval in a flag or move it outside the connection handler:

```javascript
// BEFORE (inside connection.update 'open' handler, line 930-947):
            // Interval Auto-Post ke Admin Channels (1 jam)
            setInterval(async () => {
                // ...
            }, 3600000);

// AFTER — track the interval to prevent leaks:
// Add at module scope (near other state variables):
let autoPostInterval = null;

// Replace the setInterval block:
            if (autoPostInterval) clearInterval(autoPostInterval);
            autoPostInterval = setInterval(async () => {
                let waConfig = { adminChannels: [] };
                try { waConfig = JSON.parse(fs.readFileSync("./package/wa_config.json", "utf-8")); } catch(e) {}
                
                if (waConfig.adminChannels && waConfig.adminChannels.length > 0) {
                    for (const channelJid of waConfig.adminChannels) {
                        try {
                            const topicContext = "Buatkan satu post menarik, singkat, random (misal fakta unik, komedi, berita singkat, tips, atau sapaan) untuk disebarkan (broadcast) ke WhatsApp Channel kekinian. Gunakan bahasa gaul lu/gue yang asik tanpa basa-basi.";
                            const postContent = await askAI(topicContext);
                            await waSock.sendMessage(channelJid, { text: stripMarkdown(postContent) });
                            log(`[Cron] Successfully posted random content to WA Channel: ${channelJid}`);
                        } catch (err) {
                            logError(`[Cron] Failed posting to channel ${channelJid}: ${err.message}`);
                        }
                    }
                }
            }, 3600000);
```

- [ ] **Step 5: Fix config warning to only fire for REST provider**

In `config.js`, move the warning inside the config object or wrap it:

```javascript
// BEFORE (lines 46-49):
if (!process.env.OPENX_REST_API_KEY) {
    console.warn('[CONFIG WARNING] OPENX_REST_API_KEY not set! REST API will fail.');
    console.warn('[CONFIG WARNING] Set it in .env or export OPENX_REST_API_KEY="your-api-key"');
}

// AFTER:
if ((process.env.OPENX_AI_PROVIDER || 'openrouter') === 'rest' && !process.env.OPENX_REST_API_KEY) {
    console.warn('[CONFIG WARNING] OPENX_REST_API_KEY not set! REST API will fail.');
    console.warn('[CONFIG WARNING] Set it in .env or export OPENX_REST_API_KEY="your-api-key"');
}
```

- [ ] **Step 6: Fix package.json test script**

```json
// BEFORE:
"test": "npm run scan:secrets"

// AFTER:
"test": "pnpm run scan:secrets"
```

- [ ] **Step 7: Commit**

```bash
git add package/openx/providers/openrouter.js whatsapp.js config.js package.json
git commit -m "fix: add missing OpenRouter provider, fix duplicate regex, setInterval leak, config warning, pnpm test"
```

---

### Task 2: Create src/ Directory Structure & Move Core Modules

**Covers:** Project restructuring foundation

**Files:**
- Create: `src/` directory
- Create: `src/config.js` (enhanced with caching)
- Create: `src/logger.js` (copy from root)
- Create: `src/ai-provider.js` (copy from package/openx/)
- Create: `src/providers/openrouter.js` (copy from package/openx/providers/)
- Create: `src/providers/rest.js` (copy from package/openx/providers/)
- Create: `src/adb-connect.js` (copy from root)
- Create: `src/adb-helper.js` (copy from package/)
- Create: `src/downloader.js` (copy from package/)

**Interfaces:**
- Consumes: existing files from root and package/
- Produces: `src/` module tree with identical exports

- [ ] **Step 1: Create src/ directory**

Run: `mkdir -p src/whatsapp src/providers`

- [ ] **Step 2: Create enhanced config with caching**

```javascript
// src/config.js
import fs from 'fs';
import path from 'path';

function loadDotEnvIfPresent() {
    try {
        const filePath = path.resolve(process.cwd(), '.env');
        if (!fs.existsSync(filePath)) return;
        const raw = fs.readFileSync(filePath, 'utf-8');
        for (const line of raw.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const idx = trimmed.indexOf('=');
            if (idx === -1) continue;
            const key = trimmed.slice(0, idx).trim();
            let val = trimmed.slice(idx + 1).trim();
            if (!key) continue;
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
            }
            if (process.env[key] === undefined) {
                process.env[key] = val;
            }
        }
    } catch {}
}

loadDotEnvIfPresent();

if ((process.env.OPENX_AI_PROVIDER || 'openrouter') === 'rest' && !process.env.OPENX_REST_API_KEY) {
    console.warn('[CONFIG WARNING] OPENX_REST_API_KEY not set! REST API will fail.');
}

function splitCsv(value) {
    return String(value || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
}

function parseHeaders(raw) {
    try { return JSON.parse(raw); } catch { return {}; }
}

// Config cache: { data, mtime }
const configCache = new Map();

export function loadJsonConfig(filePath, fallback = {}) {
    const abs = path.resolve(process.cwd(), filePath);
    try {
        const stat = fs.statSync(abs);
        const cached = configCache.get(abs);
        if (cached && cached.mtime === stat.mtimeMs) return cached.data;
        const data = JSON.parse(fs.readFileSync(abs, 'utf-8'));
        configCache.set(abs, { data, mtime: stat.mtimeMs });
        return data;
    } catch {
        return fallback;
    }
}

export function writeJsonConfig(filePath, data) {
    const abs = path.resolve(process.cwd(), filePath);
    fs.writeFileSync(abs, JSON.stringify(data, null, 2));
    configCache.delete(abs); // invalidate cache
}

export const config = {
    devPhoneNumber: process.env.OPENX_DEV_PHONE_NUMBER || "",
    ai: {
        provider: process.env.OPENX_AI_PROVIDER || "openrouter",
        openrouter: {
            apiKeys: splitCsv(process.env.OPENX_OPENROUTER_API_KEYS),
        },
        rest: {
            baseUrl: process.env.OPENX_REST_BASE_URL || "https://zelapioffciall.dpdns.org/ai/sdk",
            apiKey: process.env.OPENX_REST_API_KEY || "",
            model: process.env.OPENX_REST_MODEL || "deepseek/deepseek-v4-pro",
            method: process.env.OPENX_REST_METHOD || "GET",
            paramName: process.env.OPENX_REST_PARAM_NAME || "text",
            apikeyParam: process.env.OPENX_REST_APIKEY_PARAM || "apikey",
            answerField: process.env.OPENX_REST_ANSWER_FIELD || "response",
            headers: parseHeaders(process.env.OPENX_REST_HEADERS || "{}"),
        },
    },
    openrouter: {
        get apiKeys() { return splitCsv(process.env.OPENX_OPENROUTER_API_KEYS); },
    },
    adbPort: process.env.OPENX_ADB_PORT || "auto",
    mcp: {
        baseUrl: process.env.OPENX_MCP_URL || "http://localhost:8765",
    },
    plugins: {
        npm: splitCsv(process.env.OPENX_PLUGINS_NPM),
        allowUnpinned: (process.env.OPENX_ALLOW_UNPINNED_PLUGINS || "").toLowerCase() === "true",
    }
};
```

- [ ] **Step 3: Copy other modules to src/**

Copy these files, updating their import paths to use `../config.js` etc:
- `logger.js` → `src/logger.js` (no changes needed, self-contained)
- `package/openx/ai-provider.js` → `src/ai-provider.js` (update import path)
- `package/openx/providers/openrouter.js` → `src/providers/openrouter.js` (update import path)
- `package/openx/providers/rest.js` → `src/providers/rest.js` (update import path)
- `adb_connect.js` → `src/adb-connect.js` (no changes needed)
- `package/adb_helper.js` → `src/adb-helper.js` (no changes needed)
- `package/downloader.js` → `src/downloader.js` (no changes needed)

- [ ] **Step 4: Update import paths in copied files**

For `src/ai-provider.js`:
```javascript
import { config } from "./config.js";
// ... rest stays the same
```

For `src/providers/rest.js`:
```javascript
import { config } from "../../config.js";
// ... rest stays the same
```

For `src/providers/openrouter.js`:
```javascript
import { config } from "../../config.js";
// ... rest stays the same
```

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "refactor: create src/ directory structure with config caching and moved modules"
```

---

### Task 3: Extract WhatsApp Helpers

**Covers:** Decompose whatsapp.js helper functions

**Files:**
- Create: `src/whatsapp/helpers.js`
- Modify: `whatsapp.js` (remove extracted functions)

**Interfaces:**
- Consumes: nothing (pure functions)
- Produces: `stripMarkdown()`, `generateFileId()`, `ensureUserDir()`, `saveLocalFile()`, `getLocalFileById()`, `getLocalMeta()`, `setLocalMeta()`, `listLocalFiles()`, `deleteLocalFileById()`, `renameLocalFileById()`

- [ ] **Step 1: Create helpers.js with extracted functions**

```javascript
// src/whatsapp/helpers.js
import fs from 'fs';
import path from 'path';

export function stripMarkdown(text) {
    if (!text) return text;
    return text
        .replace(/\*\*/g, '')
        .replace(/__/g, '')
        .replace(/_/g, '')
        .replace(/`/g, '')
        .replace(/\[\]/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/#{1,6}\s/g, '')
        .replace(/\n\s*\n/g, '\n\n')
        .trim();
}

export function generateFileId() {
    return Math.floor(10000 + Math.random() * 90000).toString();
}

export function ensureUserDir(chatId) {
    const cleanId = String(chatId).split('@')[0];
    const dir = path.join("./caches/files", cleanId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

export function saveLocalFile(chatId, buffer, filename) {
    const dir = ensureUserDir(chatId);
    const savePath = path.join(dir, filename);
    fs.writeFileSync(savePath, buffer);
    
    const metaPath = path.join(dir, "meta.json");
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")); } catch {}
    
    let fileIdNum = generateFileId();
    while (meta[fileIdNum]) fileIdNum = generateFileId();
    
    meta[fileIdNum] = { localPath: savePath, filename, date: new Date().toISOString() };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    return fileIdNum;
}

export function getLocalFileById(chatId, fileIdNum) {
    const dir = path.join("./caches/files", String(chatId).split('@')[0]);
    const metaPath = path.join(dir, "meta.json");
    try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        return meta[fileIdNum] || null;
    } catch {
        return null;
    }
}

export function getLocalMeta(chatId) {
    const dir = path.join("./caches/files", String(chatId).split('@')[0]);
    const metaPath = path.join(dir, "meta.json");
    try {
        return JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    } catch {
        return {};
    }
}

export function setLocalMeta(chatId, meta) {
    const dir = path.join("./caches/files", String(chatId).split('@')[0]);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const metaPath = path.join(dir, "meta.json");
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

export function listLocalFiles(chatId, limit = 15) {
    const meta = getLocalMeta(chatId);
    return Object.entries(meta)
        .map(([id, info]) => ({ id, ...info }))
        .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
        .slice(0, limit);
}

export function deleteLocalFileById(chatId, fileIdNum) {
    const meta = getLocalMeta(chatId);
    const item = meta[fileIdNum];
    if (!item) return { ok: false, reason: "not_found" };
    try {
        if (item.localPath && fs.existsSync(item.localPath)) {
            fs.unlinkSync(item.localPath);
        }
    } catch {}
    delete meta[fileIdNum];
    setLocalMeta(chatId, meta);
    return { ok: true, filename: item.filename || "unknown" };
}

export function renameLocalFileById(chatId, fileIdNum, newName) {
    const safeName = String(newName || '').trim().replace(/[\\/:*?"<>|]/g, '_');
    if (!safeName) return { ok: false, reason: "invalid_name" };
    const meta = getLocalMeta(chatId);
    const item = meta[fileIdNum];
    if (!item) return { ok: false, reason: "not_found" };
    if (!item.localPath || !fs.existsSync(item.localPath)) return { ok: false, reason: "missing_file" };
    const dir = path.dirname(item.localPath);
    const targetPath = path.join(dir, safeName);
    try {
        fs.renameSync(item.localPath, targetPath);
        meta[fileIdNum] = { ...item, localPath: targetPath, filename: safeName, date: new Date().toISOString() };
        setLocalMeta(chatId, meta);
        return { ok: true, filename: safeName };
    } catch {
        return { ok: false, reason: "rename_failed" };
    }
}
```

- [ ] **Step 2: Verify imports work**

Run: `node -e "import('./src/whatsapp/helpers.js').then(m => console.log('Exports:', Object.keys(m).join(', ')))"`
Expected: `Exports: stripMarkdown, generateFileId, ensureUserDir, ...`

- [ ] **Step 3: Commit**

```bash
git add src/whatsapp/helpers.js
git commit -m "refactor: extract file management helpers to src/whatsapp/helpers.js"
```

---

### Task 4: Extract MCP Client

**Covers:** Decompose MCP integration from whatsapp.js

**Files:**
- Create: `src/whatsapp/mcp-client.js`
- Modify: `whatsapp.js` (remove MCP code)

**Interfaces:**
- Consumes: `config.mcp.baseUrl`
- Produces: `callMCPTool(endpoint, params)`, `handleMcpTags(aiResult, from, waSock)`

- [ ] **Step 1: Create mcp-client.js**

```javascript
// src/whatsapp/mcp-client.js
import { config } from '../config.js';
import { log as logFn } from '../logger.js';

export async function callMCPTool(endpoint, params = {}) {
    const baseUrl = config.mcp?.baseUrl || "http://localhost:8765";
    try {
        const res = await fetch(`${baseUrl}/api/${endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
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
        } catch(e) { logFn("MCP_SEARCH failed:", e); }
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
        } catch(e) { logFn("MCP_FILE_READ failed:", e); }
    }
    aiResult = aiResult.replace(mcpFileReadRegex, '');

    // MCP_FILE_WRITE
    const mcpFileWriteRegex = /\[MCP_FILE_WRITE\|(.*?)\|(.*?)\]/g;
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
        } catch(e) { logFn("MCP_FILE_WRITE failed:", e); }
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
        } catch(e) { logFn("MCP_CRON failed:", e); }
    }
    aiResult = aiResult.replace(mcpCronRegex, '');

    // MCP_NOTIFY
    const mcpNotifyRegex = /\[MCP_NOTIFY\|(.*?)\|(.*?)\]/g;
    while ((m = mcpNotifyRegex.exec(aiResult)) !== null) {
        try {
            await callMCPTool("notification", { title: m[1].trim(), content: m[2].trim() });
        } catch(e) { logFn("MCP_NOTIFY failed:", e); }
    }
    aiResult = aiResult.replace(mcpNotifyRegex, '');

    // MCP_DEVICE
    if (/\[MCP_DEVICE\]/.test(aiResult)) {
        try {
            const result = await callMCPTool("device", {});
            if (from && waSock) await waSock.sendMessage(from, { text: extractMcpText(result) }).catch(() => {});
        } catch(e) { logFn("MCP_DEVICE failed:", e); }
    }
    aiResult = aiResult.replace(/\[MCP_DEVICE\]/g, '');

    // MCP_BATTERY
    if (/\[MCP_BATTERY\]/.test(aiResult)) {
        try {
            const result = await callMCPTool("battery", {});
            if (from && waSock) await waSock.sendMessage(from, { text: extractMcpText(result) }).catch(() => {});
        } catch(e) { logFn("MCP_BATTERY failed:", e); }
    }
    aiResult = aiResult.replace(/\[MCP_BATTERY\]/g, '');

    // MCP_NETWORK
    if (/\[MCP_NETWORK\]/.test(aiResult)) {
        try {
            const result = await callMCPTool("network", {});
            if (from && waSock) await waSock.sendMessage(from, { text: extractMcpText(result) }).catch(() => {});
        } catch(e) { logFn("MCP_NETWORK failed:", e); }
    }
    aiResult = aiResult.replace(/\[MCP_NETWORK\]/g, '');

    return aiResult;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/whatsapp/mcp-client.js
git commit -m "refactor: extract MCP client to src/whatsapp/mcp-client.js"
```

---

### Task 5: Extract AI Processor

**Covers:** Decompose askAI function and all tag handlers

**Files:**
- Create: `src/whatsapp/ai-processor.js`
- Modify: `whatsapp.js` (remove askAI and tag handlers)

**Interfaces:**
- Consumes: `src/ai-provider.js`, `src/whatsapp/mcp-client.js`, `src/adb-helper.js`, `src/config.js`
- Produces: `askAI(userMessage, from, isComplex)`

- [ ] **Step 1: Create ai-processor.js**

This file contains the `askAI` function with all `[TAG]` handlers extracted from whatsapp.js lines 109-514. The function builds context, calls AI, then processes tags sequentially.

Key structure:
```javascript
// src/whatsapp/ai-processor.js
import fs from 'fs';
import path from 'path';
import { chatCompletion } from '../ai-provider.js';
import { loadJsonConfig } from '../config.js';
import { handleMcpTags } from './mcp-client.js';
import { log, error as logError } from '../logger.js';
import {
    getDeviceInfo, getAppList, takeScreenshot, sendNotification,
    getHealthStatus, launchApp, tapByText, tapByResourceId,
    scrollScreen, pressBack, pressHome, dumpUiHierarchy, runUiFlow
} from '../adb-helper.js';
import { downloadMedia } from '../downloader.js';
import { queueSensitiveAction, sendSensitiveConfirmationPrompt } from './sensitive-actions.js';
import { enqueueBgFlow, processAdbBgQueue } from './queue.js';

// ... getCurrentModel, buildStorageContext, askAI function ...
```

The `askAI` function body stays identical, just importing from the new module paths. All tag handlers (`[ADB_CMD]`, `[ADD_SCHEDULE]`, `[ADB_SCREENSHOT]`, etc.) remain in this file since they're tightly coupled to the AI response processing flow.

- [ ] **Step 2: Verify module loads**

Run: `node -e "import('./src/whatsapp/ai-processor.js').then(m => console.log('OK:', typeof m.askAI))"`
Expected: `OK: function`

- [ ] **Step 3: Commit**

```bash
git add src/whatsapp/ai-processor.js
git commit -m "refactor: extract AI processor with tag handlers to src/whatsapp/ai-processor.js"
```

---

### Task 6: Extract Queue & Sensitive Actions

**Covers:** Decompose queue management and confirmation flow

**Files:**
- Create: `src/whatsapp/queue.js`
- Create: `src/whatsapp/sensitive-actions.js`

**Interfaces:**
- Consumes: `src/adb-helper.js`, `src/logger.js`
- Produces: Queue functions + Sensitive action functions

- [ ] **Step 1: Create queue.js**

```javascript
// src/whatsapp/queue.js
import { runUiFlow } from '../adb-helper.js';
import { log as logFn, error as logError } from '../logger.js';

export const aiQueue = [];
let isProcessingQueue = false;

export const adbBgQueue = [];
let isProcessingAdbBgQueue = false;
export let activeBgTask = null;
let bgTaskSeq = 1;
const bgTaskHistory = [];

export function enqueueBgFlow(flow, from) {
    const task = {
        id: `BG${String(bgTaskSeq++).padStart(4, '0')}`,
        flow, from, status: 'queued',
        createdAt: Date.now(), startedAt: null, finishedAt: null,
        cancelRequested: false, logs: []
    };
    adbBgQueue.push(task);
    return task;
}

export function cancelBgTask(selector = 'last') {
    // ... same logic as whatsapp.js lines 759-794
}

export function getBgStatusText() {
    // ... same logic as whatsapp.js lines 796-803
}

export async function processAdbBgQueue(waSock) {
    // ... same logic, accepts waSock as param instead of using module-level
}

export async function processQueue(waSock, askAI, stripMarkdown) {
    // ... same logic, accepts dependencies as params
}
```

- [ ] **Step 2: Create sensitive-actions.js**

```javascript
// src/whatsapp/sensitive-actions.js
import { exec } from 'child_process';
import { promisify } from 'util';
const execPromise = promisify(exec);

export const pendingSensitiveActions = new Map();
const SENSITIVE_TTL_MS = 2 * 60 * 1000;

export function createSensitiveToken() {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function queueSensitiveAction(chatId, actionType, payload, summary) {
    const token = createSensitiveToken();
    pendingSensitiveActions.set(String(chatId), {
        token, actionType, payload, summary, createdAt: Date.now()
    });
    return token;
}

export async function sendSensitiveConfirmationPrompt(waSock, jid, title, token) {
    // ... same logic as whatsapp.js lines 673-696
}

export async function executeSensitiveAction(pending, from, waSock) {
    // ... same logic as whatsapp.js lines 698-741
}
```

- [ ] **Step 3: Commit**

```bash
git add src/whatsapp/queue.js src/whatsapp/sensitive-actions.js
git commit -m "refactor: extract queue and sensitive action modules"
```

---

### Task 7: Extract Commands & Message Router

**Covers:** Decompose command handlers and message routing

**Files:**
- Create: `src/whatsapp/commands.js`
- Create: `src/whatsapp/message-router.js`

**Interfaces:**
- Consumes: `src/config.js`, `src/whatsapp/helpers.js`, `src/logger.js`
- Produces: Command handlers + Message routing logic

- [ ] **Step 1: Create commands.js**

Contains `.personality`, `.model`, `.plugins`, file management commands, bg status/cancel, and confirm/cancel confirm handlers.

- [ ] **Step 2: Create message-router.js**

Contains the message routing logic: status broadcast handling, channel monitoring, DM/group routing, media handling, and the main message dispatch.

- [ ] **Step 3: Commit**

```bash
git add src/whatsapp/commands.js src/whatsapp/message-router.js
git commit -m "refactor: extract commands and message router"
```

---

### Task 8: Create WhatsApp Connection Module

**Covers:** WhatsApp socket connection, QR display, reconnect logic

**Files:**
- Create: `src/whatsapp/connection.js`

**Interfaces:**
- Consumes: `@whiskeysockets/baileys`, `src/config.js`, `src/logger.js`
- Produces: `connectToWhatsApp()`, `waSock` export

- [ ] **Step 1: Create connection.js**

This module handles:
- WhatsApp socket creation with baileys
- QR code display
- Connection state management (open/close/reconnect)
- Credential saving
- Plugin manager initialization
- Auto-post interval (with leak prevention)

- [ ] **Step 2: Commit**

```bash
git add src/whatsapp/connection.js
git commit -m "refactor: extract WhatsApp connection to src/whatsapp/connection.js"
```

---

### Task 9: Rewrite index.js & Update Imports

**Covers:** Wire everything together through new module structure

**Files:**
- Modify: `index.js` (update imports to src/)
- Verify: All cross-module imports resolve correctly

**Interfaces:**
- Consumes: all `src/` modules
- Produces: Working entry point

- [ ] **Step 1: Update index.js**

```javascript
// index.js
import { config } from "./src/config.js";
import fs from "fs";
import { log, error as logError } from "./src/logger.js";
import { connectToWhatsApp } from "./src/whatsapp/connection.js";
import cron from "node-cron";
import { exec } from 'child_process';
import util from 'util';
const execPromise = util.promisify(exec);
import { detectAdbPort } from './src/adb-connect.js';

// ... rest of index.js stays the same, just updated imports
```

- [ ] **Step 2: Verify full app loads**

Run: `node -e "import('./index.js')" 2>&1 | head -5`
Expected: No import errors (may fail at WhatsApp connect without credentials, but no module resolution errors)

- [ ] **Step 3: Commit**

```bash
git add index.js
git commit -m "refactor: update index.js imports to use src/ module structure"
```

---

### Task 10: Final Cleanup & Verification

**Covers:** Remove old files, verify everything works

**Files:**
- Delete: Old root-level files that moved to src/
- Verify: `pnpm test` passes

**Interfaces:**
- Consumes: all previous tasks
- Produces: Clean project structure

- [ ] **Step 1: Remove old files from root**

Keep in root: `index.js`, `config.js` (now just re-exports from src/config.js or deleted), `logger.js` (same), `package.json`, `.env.example`, `.gitignore`, `README.md`, `LICENSE`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`

Remove from root: `adb_connect.js` (moved to src/)

Remove from package/: `package/openx/ai-provider.js`, `package/openx/providers/`, `package/adb_helper.js`, `package/downloader.js`

Keep in package/: `plugins/`, `plugins.json`, `plugins.lock.json`, `model.json`, `personalities.json`, `wa_config.json`, `schedules.json`, `context.json`, `storage/`

- [ ] **Step 2: Run secret scanner**

Run: `pnpm test`
Expected: `[secret-scan] OK: no obvious secrets found.`

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "refactor: complete module decomposition, remove old files"
```
