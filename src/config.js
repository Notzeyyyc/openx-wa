import fs from 'fs';
import path from 'path';
import { ENV_FILE } from './paths.js';

function loadDotEnvIfPresent() {
    try {
        process.loadEnvFile(ENV_FILE);
    } catch {}
}

loadDotEnvIfPresent();

export const config = {
    ai: {
        openai: {
            baseUrl: process.env.OPENX_OPENAI_BASE_URL || "https://ai.sumopod.com",
            apiKey: process.env.OPENX_OPENAI_API_KEY || "",
            model: process.env.OPENX_OPENAI_MODEL || "gpt-4o-mini",
        },
    },
    // FGSi endpoints for .search / .img (not OpenAI-compatible APIs)
    fgsi: {
        baseUrl: process.env.OPENX_FGSI_BASE_URL || "https://fgsi.dpdns.org/api/ai/claude",
        apiKey: process.env.OPENX_FGSI_API_KEY || "",
    },
};

// Config cache: path -> { data, mtime }
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
    configCache.delete(abs);
}
