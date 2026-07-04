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

/**
 * Send poll
 */
export async function sendPoll(waSock, jid, name, values, options = {}) {
    try {
        await waSock.sendMessage(jid, {
            poll: {
                name: name.slice(0, 60),
                values: values.map(v => v.slice(0, 60)).slice(0, 10),
                selectableCount: options.selectable || 1,
                hideVoter: options.hideVoter || false
            }
        });
        return true;
    } catch (e) {
        let text = `📊 *${name}*\n\n`;
        values.forEach((v, i) => text += `${i + 1}. ${v}\n`);
        await waSock.sendMessage(jid, { text: text.slice(0, 2000) }).catch(() => {});
        return false;
    }
}

/**
 * Send carousel
 */
export async function sendCarousel(waSock, jid, { title, footer, cards }) {
    try {
        await waSock.sendMessage(jid, {
            text: (title || '').slice(0, 100),
            footer: (footer || '✨ OpenXX').slice(0, 60),
            cards: cards.slice(0, 5).map(card => ({
                image: card.image ? { url: card.image } : undefined,
                caption: (card.caption || '').slice(0, 1024),
                footer: (card.footer || footer || '✨ OpenXX').slice(0, 60),
                nativeFlow: card.buttons?.slice(0, 3).map(b => ({
                    text: (b.text || '').slice(0, 20),
                    id: b.id,
                    url: b.url
                })) || []
            }))
        });
        return true;
    } catch (e) {
        let text = `*${title || ''}*\n\n`;
        for (const card of cards) {
            text += `📌 ${card.caption}\n`;
        }
        await waSock.sendMessage(jid, { text: text.slice(0, 2000) }).catch(() => {});
        return false;
    }
}

/**
 * Send code block
 */
export async function sendCodeBlock(waSock, jid, { code, language, title, footer }) {
    try {
        await waSock.sendMessage(jid, {
            disclaimerText: '💻 Code',
            headerText: (title || '').slice(0, 100),
            code: code.slice(0, 4000),
            language: language || 'javascript',
            footerText: (footer || '✨ OpenXX').slice(0, 60)
        });
        return true;
    } catch (e) {
        const text = title ? `*${title}*\n\n\`\`\`${language || ''}\n${code}\n\`\`\`` : `\`\`\`${language || ''}\n${code}\n\`\`\``;
        await waSock.sendMessage(jid, { text: text.slice(0, 2000) }).catch(() => {});
        return false;
    }
}

/**
 * Send table
 */
export async function sendTable(waSock, jid, { title, table, footer }) {
    try {
        await waSock.sendMessage(jid, {
            disclaimerText: '📊 Table',
            title: (title || '').slice(0, 100),
            table: table?.map(row => row.map(cell => (cell || '').slice(0, 30))),
            footerText: (footer || '✨ OpenXX').slice(0, 60)
        });
        return true;
    } catch (e) {
        let text = title ? `*${title}*\n\n` : '';
        if (table && table.length > 0) {
            for (const row of table) {
                text += row.join(' | ') + '\n';
            }
        }
        await waSock.sendMessage(jid, { text: text.slice(0, 2000) }).catch(() => {});
        return false;
    }
}

/**
 * Send card with image
 */
export async function sendCard(waSock, jid, { title, description, footer, image, buttons }) {
    const msg = {};
    if (image) {
        msg.image = typeof image === 'string' ? { url: image } : image;
        msg.caption = `*${(title || '').slice(0, 100)}*\n${(description || '').slice(0, 500)}`;
    } else {
        msg.text = `*${(title || '').slice(0, 100)}*\n${(description || '').slice(0, 500)}`;
    }
    msg.footer = (footer || '✨ OpenXX').slice(0, 60);
    if (buttons && buttons.length > 0) {
        msg.buttons = buttons.slice(0, 4).map(b => ({
            buttonId: b.id,
            buttonText: { displayText: (b.text || '').slice(0, 20) },
            type: 1
        }));
    }
    await waSock.sendMessage(jid, msg).catch(() => {});
}

/**
 * Send with typing indicator
 */
export async function sendTyping(waSock, jid, text, options = {}) {
    await waSock.sendPresenceUpdate('composing', jid);
    await new Promise(r => setTimeout(r, 300 + Math.min(text.length * 3, 1500)));
    await waSock.sendPresenceUpdate('paused', jid);
    await waSock.sendMessage(jid, { text, ...options });
}

/**
 * React to message
 */
export async function react(waSock, jid, msgId, emoji) {
    await waSock.sendMessage(jid, {
        react: { text: emoji, key: msgId }
    }).catch(() => {});
}

/**
 * Send document
 */
export async function sendDocument(waSock, jid, buffer, filename, caption, mimetype) {
    await waSock.sendMessage(jid, {
        document: buffer,
        fileName: filename,
        caption: (caption || '').slice(0, 1024),
        mimetype: mimetype || 'application/octet-stream'
    });
}

/**
 * Send contact card
 */
export async function sendContact(waSock, jid, contacts) {
    await waSock.sendMessage(jid, {
        contacts: {
            displayName: (contacts[0]?.name || 'Contact').slice(0, 30),
            contacts: contacts.slice(0, 5).map(c => ({
                vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${c.name}\nTEL;type=CELL:${c.phone}\nEND:VCARD`
            }))
        }
    });
}

/**
 * Send location
 */
export async function sendLocation(waSock, jid, lat, lng, name) {
    await waSock.sendMessage(jid, {
        location: { degreesLatitude: lat, degreesLongitude: lng, name: (name || '').slice(0, 60) }
    });
}

/**
 * Pin message
 */
export async function pinMessage(waSock, jid, msgKey, duration = 86400) {
    await waSock.sendMessage(jid, { pin: msgKey, time: duration, type: 1 }).catch(() => {});
}

/**
 * Send link with rich preview
 */
export async function sendRichPreview(waSock, jid, url, caption) {
    try {
        await waSock.sendMessage(jid, { text: caption || url, richPreview: true });
    } catch (e) {
        await waSock.sendMessage(jid, { text: `${caption || ''}\n${url}` }).catch(() => {});
    }
}
