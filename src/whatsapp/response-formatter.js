/**
 * Smart response formatter for AI messages
 * Detects content type and uses appropriate Baileys features
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
 * Format code block response
 */
function formatCodeBlock(text) {
    const codeMatch = text.match(/```(\w+)?\n([\s\S]*?)```/);
    if (!codeMatch) return { text };

    const lang = codeMatch[1] || 'text';
    const code = codeMatch[2].trim();
    const before = text.slice(0, text.indexOf('```')).trim();
    const after = text.slice(text.lastIndexOf('```') + 3).trim();

    return {
        disclaimerText: 'Code Block',
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

    if (tableRows.length < 2) return { text };

    return {
        disclaimerText: 'Table',
        title: caption.trim() || undefined,
        table: tableRows,
        footerText: 'OpenXX'
    };
}

/**
 * Format list response
 */
function formatList(text) {
    // Just return styled text - lists work better as formatted text
    return { text };
}

/**
 * Send thinking indicator (Meta AI style)
 */
export async function sendThinkingIndicator(waSock, jid, description = 'Thinking...') {
    try {
        const { default: baileys } = await import('@crysnovax/baileys');
        if (baileys.metaTyping) {
            return await baileys.metaTyping(waSock, jid, {
                description,
                steps: []
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
 * Send formatted AI response
 */
export async function sendFormattedResponse(waSock, jid, text, quoted, options = {}) {
    if (!text || text.length === 0) {
        await waSock.sendMessage(jid, { text: 'No response generated.' }, { quoted });
        return;
    }

    const contentType = detectContentType(text);

    // Try rich message format first
    let richContent = null;

    if (contentType === 'code') {
        richContent = formatCodeBlock(text);
    } else if (contentType === 'table') {
        richContent = formatTable(text);
    }

    if (richContent && richContent.code) {
        // Send as rich code message
        try {
            await waSock.sendMessage(jid, {
                ...richContent,
                footer: 'OpenXX'
            }, { quoted });
            return;
        } catch (e) {
            // Fallback to plain text
        }
    }

    if (richContent && richContent.table) {
        // Send as table message
        try {
            await waSock.sendMessage(jid, {
                ...richContent,
                footer: 'OpenXX'
            }, { quoted });
            return;
        } catch (e) {
            // Fallback to plain text
        }
    }

    // Default: send as styled text with footer
    await waSock.sendMessage(jid, {
        text,
        footer: 'OpenXX',
        buttons: options.buttons || []
    }, { quoted });
}

/**
 * Strip markdown for plain text fallback
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
