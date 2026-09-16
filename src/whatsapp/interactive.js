/**
 * Interactive message helpers for WhatsApp
 * Meta AI-style, balanced, clean
 */

/**
 * Send button message
 */
export async function sendButtons(waSock, jid, text, buttons, options = {}) {
    // Balance text
    const footer = options.footer || '✨ OpenXX';
    const maxBtns = buttons.slice(0, 4); // WhatsApp limit

    try {
        await waSock.sendMessage(jid, {
            text,
            footer,
            nativeFlow: maxBtns.map(b => ({
                text: b.text.slice(0, 20), // Button text limit
                id: b.id,
                icon: b.icon || 'default'
            }))
        });
        return true;
    } catch (e) {
        // Fallback to classic buttons
        try {
            await waSock.sendMessage(jid, {
                text,
                footer,
                buttons: maxBtns.map(b => ({
                    buttonId: b.id,
                    buttonText: { displayText: b.text.slice(0, 20) },
                    type: 1
                })),
                headerType: 1
            });
            return true;
        } catch (e2) {
            // Final fallback
            const fallback = maxBtns.map(b => `• ${b.text}`).join('\n');
            await waSock.sendMessage(jid, { text: `${text}\n\n${fallback}`, footer }).catch(() => {});
            return false;
        }
    }
}

/**
 * Send list message
 */
export async function sendList(waSock, jid, title, description, buttonText, sections) {
    const footer = '✨ OpenXX';
    try {
        await waSock.sendMessage(jid, {
            text: title.slice(0, 100), // Title limit
            footer: (description || '').slice(0, 60),
            buttonText: (buttonText || 'Pilih').slice(0, 20),
            sections: sections.map(s => ({
                ...s,
                rows: s.rows.map(r => ({
                    ...r,
                    title: (r.title || '').slice(0, 24),
                    description: (r.description || '').slice(0, 48)
                }))
            })),
            headerType: 1
        });
        return true;
    } catch (e) {
        // Fallback
        let text = `*${title}*\n${description || ''}\n\n`;
        for (const section of sections) {
            text += `*${section.title}*\n`;
            for (const row of section.rows) {
                text += `• ${row.title}${row.description ? ' — ' + row.description : ''}\n`;
            }
        }
        await waSock.sendMessage(jid, { text: text.slice(0, 2000), footer }).catch(() => {});
        return false;
    }
}
