/**
 * Meta AI-style response formatter
 * Balanced, clean, and interactive
 */

/**
 * Detect content type from AI response
 */
function detectContentType(text) {
    if (/```[\s\S]*?```/.test(text)) return 'code';
    if (/\|.*\|.*\|/.test(text) && /\n.*\|.*\|/.test(text)) return 'table';
    if (/^\s*[-*]\s+.+/m.test(text) && text.split('\n').filter(l => /^\s*[-*]\s+/.test(l)).length >= 3) return 'list';
    if (/^\s*\d+\.\s+.+/m.test(text) && text.split('\n').filter(l => /^\s*\d+\.\s+/.test(l)).length >= 3) return 'numbered';
    return 'text';
}

/**
 * Balance text length — split if too long, pad if too short
 */
function balanceText(text, maxLen = 2000) {
    if (!text) return text;

    // Clean up excessive newlines
    text = text.replace(/\n{3,}/g, '\n\n').trim();

    // If within limit, return as-is
    if (text.length <= maxLen) return text;

    // Split at paragraph boundaries
    const paragraphs = text.split('\n\n');
    let result = '';
    for (const para of paragraphs) {
        if ((result + '\n\n' + para).length > maxLen) break;
        result += (result ? '\n\n' : '') + para;
    }
    return result || text.slice(0, maxLen);
}

/**
 * Format code block response
 */
function formatCodeBlock(text) {
    const codeMatch = text.match(/```(\w+)?\n([\s\S]*?)```/);
    if (!codeMatch) return null;

    const lang = codeMatch[1] || 'text';
    const code = codeMatch[2].trim();
    const before = text.slice(0, text.indexOf('```')).trim();
    const after = text.slice(text.lastIndexOf('```') + 3).trim();

    return {
        disclaimerText: '💻 Code',
        headerText: before || undefined,
        code,
        language: lang,
        footerText: after || undefined
    };
}

/**
 * Format table response
 */
function formatTable(text) {
    const lines = text.split('\n').filter(l => l.trim());
    const tableRows = [];
    let caption = '';

    for (const line of lines) {
        if (line.includes('|') && line.trim().startsWith('|')) {
            const cells = line.split('|').map(c => c.trim()).filter(c => c);
            if (cells.length > 0) tableRows.push(cells);
        } else {
            caption += line + '\n';
        }
    }

    if (tableRows.length < 2) return null;

    return {
        disclaimerText: '📊 Table',
        title: caption.trim() || undefined,
        table: tableRows,
        footerText: 'OpenXX'
    };
}

/**
 * Random thinking phrases
 */
const THINKING_PHRASES = [
    'Analyzing your message...',
    'Processing your request...',
    'Thinking about this...',
    'Let me work on that...',
    'Working on it...',
    'Computing response...',
    'Generating answer...',
    'Reading context...',
    'Understanding intent...',
    'Preparing response...'
];

/**
 * Random step descriptions
 */
const STEP_DESCRIPTIONS = [
    ['Reading your message...', 'Understanding context...', 'Generating response...'],
    ['Processing request...', 'Analyzing data...', 'Formulating answer...'],
    ['Thinking...', 'Checking knowledge...', 'Composing reply...'],
    ['Analyzing...', 'Finding best approach...', 'Writing response...'],
    ['Loading context...', 'Processing...', 'Almost done...']
];

function getRandomPhrase() {
    return THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)];
}

function getRandomSteps() {
    return STEP_DESCRIPTIONS[Math.floor(Math.random() * STEP_DESCRIPTIONS.length)];
}

/**
 * Send thinking indicator with live updates (Meta AI style)
 * Returns an object with update() and done() methods
 */
export async function sendThinkingIndicator(waSock, jid) {
    const phrase = getRandomPhrase();
    const steps = getRandomSteps();

    // Send initial message
    const sentMsg = await waSock.sendMessage(jid, {
        text: `_${phrase}_\n\n○ ${steps[0]}\n○ ${steps[1]}\n○ ${steps[2]}`
    }).catch(() => null);

    if (!sentMsg?.key?.id) return { update: async () => {}, done: async () => {} };

    const msgId = sentMsg.key.id;
    let stepIndex = 0;

    return {
        // Update to next step
        update: async () => {
            stepIndex++;
            if (stepIndex >= steps.length) return;

            let text = `_${phrase}_\n`;
            for (let i = 0; i < steps.length; i++) {
                if (i < stepIndex) {
                    text += `✓ ${steps[i]}\n`;
                } else if (i === stepIndex) {
                    text += `○ ${steps[i]}\n`;
                } else {
                    text += `○ ${steps[i]}\n`;
                }
            }

            await waSock.sendMessage(jid, {
                text,
                edit: { remoteJid: jid, id: msgId, fromMe: true }
            }).catch(() => {});
        },
        // Mark as done
        done: async () => {
            let text = '';
            for (const step of steps) {
                text += `✓ ${step}\n`;
            }
            text += '\n✨ Generating response...';

            await waSock.sendMessage(jid, {
                text,
                edit: { remoteJid: jid, id: msgId, fromMe: true }
            }).catch(() => {});
        }
    };
}

/**
 * Delete thinking indicator (legacy, now just deletes the message)
 */
export async function deleteThinkingIndicator(waSock, jid, placeholder) {
    if (!placeholder?.msgId) return;
    try {
        await waSock.sendMessage(jid, { delete: { remoteJid: jid, id: placeholder.msgId, fromMe: true } });
    } catch {}
}

/**
 * Send formatted AI response (Meta AI style)
 */
export async function sendFormattedResponse(waSock, jid, text, quoted, options = {}) {
    if (!text || text.length === 0) {
        await waSock.sendMessage(jid, { text: '🤔 Hmm, I could not generate a response.' }, { quoted });
        return;
    }

    // Balance text length
    text = balanceText(text);

    const contentType = detectContentType(text);
    let richContent = null;

    if (contentType === 'code') {
        richContent = formatCodeBlock(text);
    } else if (contentType === 'table') {
        richContent = formatTable(text);
    }

    // Try rich message first
    if (richContent) {
        try {
            await waSock.sendMessage(jid, {
                ...richContent,
                footer: '✨ OpenXX'
            }, { quoted });
            return;
        } catch (e) {
            // Fallback to plain text
        }
    }

    // Default: clean styled text
    await waSock.sendMessage(jid, {
        text,
        footer: '✨ OpenXX'
    }, { quoted });
}

/**
 * Strip markdown for plain text
 */
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
