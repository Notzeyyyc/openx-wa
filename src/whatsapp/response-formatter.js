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
 * Send thinking indicator with steps (Meta AI style)
 */
export async function sendThinkingIndicator(waSock, jid, description = 'Thinking...') {
    try {
        const { metaTyping, buildSteps } = await import('@crysnovax/baileys');
        if (metaTyping) {
            const steps = buildSteps([
                'Reading your message...',
                'Analyzing context...',
                'Generating response...'
            ]);
            return await metaTyping(waSock, jid, {
                description,
                steps
            });
        }
    } catch {}
    return null;
}

/**
 * Delete thinking indicator
 */
export async function deleteThinkingIndicator(waSock, jid, placeholder) {
    if (!placeholder?.key) return;
    try {
        await waSock.sendMessage(jid, { delete: placeholder.key });
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
