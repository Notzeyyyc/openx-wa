import fs from 'fs';

const FILE = './package/analytics.jsonl';

// ponytail: full-file scan on .stats; split into daily files if this grows big
function readEvents() {
    try {
        return fs.readFileSync(FILE, 'utf-8').split('\n').filter(Boolean).map(l => {
            try { return JSON.parse(l); } catch { return null; }
        }).filter(Boolean);
    } catch { return []; }
}

function track(event, chatId, extra = {}) {
    try {
        fs.appendFileSync(FILE, JSON.stringify({ event, chatId, ts: Date.now(), ...extra }) + '\n');
    } catch {}
}

export function trackMessage(chatId, isGroup) {
    track('message_received', chatId, { isGroup });
}

export function trackAIResponse(chatId, responseTimeMs, model) {
    track('ai_response', chatId, { responseTimeMs, model });
}

export function trackCommand(chatId, command) {
    track('command_used', chatId, { command });
}

export function getStatsSummary() {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const events = readEvents();
    const today = events.filter(e => e.ts >= now - day);
    const week = events.filter(e => e.ts >= now - 7 * day);

    const aiEvents = today.filter(e => e.event === 'ai_response');
    const avgResponseTime = aiEvents.length > 0
        ? aiEvents.reduce((sum, e) => sum + (e.responseTimeMs || 0), 0) / aiEvents.length
        : 0;

    const commandCounts = {};
    for (const e of today) {
        if (e.event === 'command_used') commandCounts[e.command || 'unknown'] = (commandCounts[e.command || 'unknown'] || 0) + 1;
    }
    const topCommands = Object.entries(commandCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    return {
        today: {
            messages: today.filter(e => e.event === 'message_received').length,
            aiCalls: aiEvents.length,
            commands: today.filter(e => e.event === 'command_used').length,
            avgResponseTime: Math.round(avgResponseTime),
        },
        week: {
            messages: week.filter(e => e.event === 'message_received').length,
            aiCalls: week.filter(e => e.event === 'ai_response').length,
        },
        topCommands
    };
}
