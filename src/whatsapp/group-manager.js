import { loadJsonConfig, writeJsonConfig } from '../config.js';

const GROUPS_FILE = './package/groups.json';
const messageTracker = new Map(); // key: jid:sender -> [{text, ts}]

function loadGroups() {
    return loadJsonConfig(GROUPS_FILE, {});
}

export function getGroup(jid) {
    const groups = loadGroups();
    return groups[jid] || null;
}

export function setGroup(jid, data) {
    const groups = loadGroups();
    groups[jid] = { ...(groups[jid] || {}), ...data };
    writeJsonConfig(GROUPS_FILE, groups);
    return groups[jid];
}

export function checkSpam(jid, sender, text) {
    const key = `${jid}:${sender}`;
    const now = Date.now();
    if (!messageTracker.has(key)) messageTracker.set(key, []);
    const msgs = messageTracker.get(key);
    msgs.push({ text, ts: now });

    // Clean old entries (>60s)
    while (msgs.length > 0 && now - msgs[0].ts > 60000) msgs.shift();

    // Flood: 5+ in 1 min
    if (msgs.length >= 5) return { spam: true, reason: 'flood' };

    // Duplicate: 3+ same text in 10 sec
    const recent = msgs.filter(m => now - m.ts < 10000 && m.text === text);
    if (recent.length >= 3) return { spam: true, reason: 'duplicate' };

    return { spam: false };
}

const autoReplies = {
    'menu': '📋 Menu:\n1. Play music\n2. AI chat\n3. Help',
    'help': 'Ketik .openx <pertanyaan> untuk chat AI',
    'ping': 'Pong! 🏓'
};

export function checkAutoReply(text) {
    const lower = text.toLowerCase().trim();
    for (const [keyword, reply] of Object.entries(autoReplies)) {
        if (lower === keyword || lower.startsWith(keyword + ' ')) return reply;
    }
    return null;
}

export function setupGroupParticipants(waSock) {
    waSock.ev.on('group-participants.update', async (update) => {
        try {
            if (update.action === 'add') {
                const group = getGroup(update.jid);
                if (group?.welcome_enabled) {
                    for (const participant of update.participants) {
                        await waSock.sendMessage(update.jid, {
                            text: group.welcome_message.replace('{user}', `@${participant.split('@')[0]}`),
                            mentions: [participant]
                        });
                    }
                }
            }
        } catch (err) {
            // silent fail on welcome messages
        }
    });
}
