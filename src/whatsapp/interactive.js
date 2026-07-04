/**
 * Interactive message helpers for WhatsApp
 * Using @crysnovax/baileys features
 */

/**
 * Send button message (improved with nativeFlow)
 */
export async function sendButtons(waSock, jid, text, buttons, options = {}) {
    try {
        // Try nativeFlow first (more reliable)
        await waSock.sendMessage(jid, {
            text,
            footer: options.footer || 'OpenXX',
            nativeFlow: buttons.map(b => ({
                text: b.text,
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
                footer: options.footer || 'OpenXX',
                buttons: buttons.map(b => ({
                    buttonId: b.id,
                    buttonText: { displayText: b.text },
                    type: 1
                })),
                headerType: 1
            });
            return true;
        } catch (e2) {
            // Final fallback to text
            const fallback = buttons.map(b => `${b.text}`).join(' | ');
            await waSock.sendMessage(jid, { text: `${text}\n\n${fallback}` }).catch(() => {});
            return false;
        }
    }
}

/**
 * Send list message
 */
export async function sendList(waSock, jid, title, description, buttonText, sections) {
    try {
        await waSock.sendMessage(jid, {
            text: title,
            footer: description || 'OpenXX',
            buttonText: buttonText || 'Pilih',
            sections,
            headerType: 1
        });
        return true;
    } catch (e) {
        // Fallback to text
        let text = `*${title}*\n${description || ''}\n\n`;
        for (const section of sections) {
            text += `*${section.title}*\n`;
            for (const row of section.rows) {
                text += `• ${row.title}${row.description ? ' — ' + row.description : ''}\n`;
            }
        }
        await waSock.sendMessage(jid, { text }).catch(() => {});
        return false;
    }
}

/**
 * Send poll (interactive choice)
 */
export async function sendPoll(waSock, jid, name, values, options = {}) {
    try {
        await waSock.sendMessage(jid, {
            poll: {
                name,
                values,
                selectableCount: options.selectable || 1,
                hideVoter: options.hideVoter || false
            }
        });
        return true;
    } catch (e) {
        let text = `📊 *${name}*\n\n`;
        values.forEach((v, i) => text += `${i + 1}. ${v}\n`);
        await waSock.sendMessage(jid, { text }).catch(() => {});
        return false;
    }
}

/**
 * Send carousel with multiple cards
 */
export async function sendCarousel(waSock, jid, { title, footer, cards }) {
    try {
        await waSock.sendMessage(jid, {
            text: title,
            footer: footer || 'OpenXX',
            cards: cards.map(card => ({
                image: card.image ? { url: card.image } : undefined,
                caption: card.caption,
                footer: card.footer || footer || 'OpenXX',
                nativeFlow: card.buttons?.map(b => ({
                    text: b.text,
                    id: b.id,
                    url: b.url
                })) || []
            }))
        });
        return true;
    } catch (e) {
        // Fallback to text
        let text = `*${title}*\n\n`;
        for (const card of cards) {
            text += `📌 ${card.caption}\n`;
        }
        await waSock.sendMessage(jid, { text }).catch(() => {});
        return false;
    }
}

/**
 * Send code block (rich message)
 */
export async function sendCodeBlock(waSock, jid, { code, language, title, footer }) {
    try {
        await waSock.sendMessage(jid, {
            disclaimerText: 'Code Block',
            headerText: title,
            code,
            language: language || 'javascript',
            footerText: footer || 'OpenXX'
        });
        return true;
    } catch (e) {
        // Fallback to text
        const text = title ? `*${title}*\n\n\`\`\`${language || ''}\n${code}\n\`\`\`` : `\`\`\`${language || ''}\n${code}\n\`\`\``;
        await waSock.sendMessage(jid, { text }).catch(() => {});
        return false;
    }
}

/**
 * Send table (rich message)
 */
export async function sendTable(waSock, jid, { title, table, footer }) {
    try {
        await waSock.sendMessage(jid, {
            disclaimerText: 'Table',
            title,
            table,
            footerText: footer || 'OpenXX'
        });
        return true;
    } catch (e) {
        // Fallback to text
        let text = title ? `*${title}*\n\n` : '';
        if (table && table.length > 0) {
            for (const row of table) {
                text += row.join(' | ') + '\n';
            }
        }
        await waSock.sendMessage(jid, { text }).catch(() => {});
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
        msg.caption = `*${title}*\n${description || ''}`;
    } else {
        msg.text = `*${title}*\n${description || ''}`;
    }
    if (footer) msg.footer = footer;
    if (buttons && buttons.length > 0) {
        msg.buttons = buttons.map(b => ({
            buttonId: b.id,
            buttonText: { displayText: b.text },
            type: 1
        }));
    }
    await waSock.sendMessage(jid, msg).catch(() => {});
}

/**
 * Send typing indicator then message
 */
export async function sendTyping(waSock, jid, text, options = {}) {
    await waSock.sendPresenceUpdate('composing', jid);
    await new Promise(r => setTimeout(r, 500 + Math.min(text.length * 5, 2000)));
    await waSock.sendPresenceUpdate('paused', jid);
    await waSock.sendMessage(jid, { text, ...options });
}

/**
 * Send reaction to a message
 */
export async function react(waSock, jid, msgId, emoji) {
    await waSock.sendMessage(jid, {
        react: { text: emoji, key: msgId }
    }).catch(() => {});
}

/**
 * Send document with preview
 */
export async function sendDocument(waSock, jid, buffer, filename, caption, mimetype) {
    await waSock.sendMessage(jid, {
        document: buffer,
        fileName: filename,
        caption: caption || '',
        mimetype: mimetype || 'application/octet-stream'
    });
}

/**
 * Send contact card
 */
export async function sendContact(waSock, jid, contacts) {
    await waSock.sendMessage(jid, {
        contacts: {
            displayName: contacts[0]?.name || 'Contact',
            contacts: contacts.map(c => ({
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
        location: { degreesLatitude: lat, degreesLongitude: lng, name: name || '' }
    });
}

/**
 * Pin a message
 */
export async function pinMessage(waSock, jid, msgKey, duration = 86400) {
    await waSock.sendMessage(jid, {
        pin: msgKey,
        time: duration,
        type: 1
    }).catch(() => {});
}

/**
 * Send link with rich preview
 */
export async function sendRichPreview(waSock, jid, url, caption) {
    try {
        await waSock.sendMessage(jid, {
            text: caption || url,
            richPreview: true
        });
    } catch (e) {
        await waSock.sendMessage(jid, { text: `${caption || ''}\n${url}` }).catch(() => {});
    }
}
