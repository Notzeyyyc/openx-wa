import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { downloadMediaMessage } from '@crysnovax/baileys';
import { loadJsonConfig } from '../config.js';
import { log as logFn, error as logError } from '../logger.js';
import { chatCompletion } from '../ai-provider.js';
import { askAI } from './ai-processor.js';
import { stripMarkdown, saveLocalFile, getLocalFileById } from './helpers.js';
import { handleCommands } from './commands.js';
import { aiQueue, processQueue } from './queue.js';
import { getGroup, checkSpam, checkAutoReply } from './group-manager.js';
import { addGroupMember, removeGroupMember } from './group-training.js';
import { trackMessage, trackCommand } from '../analytics.js';

export function setupMessageHandler(waSock) {
    logFn("[DEBUG] Message handler initialized");
    setupGroupParticipants(waSock);
    waSock.ev.on('messages.upsert', async (m) => {
        try {
            logFn(`[DEBUG] messages.upsert triggered, count=${m.messages?.length}`);
            const msg = m.messages[0];
            if (!msg.message) {
                logFn("[DEBUG] msg.message is empty, skipping");
                return;
            }

            const from = msg.key.remoteJid;
            const participant = msg.key.participant || from;

            logFn(`[DEBUG] from=${from}, fromMe=${msg.key.fromMe}, pushName=${msg.pushName}`);

            let waConfig = { statusTargets: [], adminChannels: [] };
            try { waConfig = loadJsonConfig("./package/wa_config.json", waConfig); } catch(e) {}

            // 1. MONITOR WHATSAPP STATUS
            if (from === 'status@broadcast') {
                if (msg.key.fromMe) return;
                const cleanParticipant = participant.replace('@s.whatsapp.net', '');
                if (waConfig.statusTargets.includes(cleanParticipant) || waConfig.statusTargets.includes(participant)) {
                    logFn(`[Status Monitor] Received status from ${participant}. Content logged to log.txt.`);
                    let textMsg = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
                    const senderName = msg.pushName || cleanParticipant;
                    logFn(`🟢 WA Status from ${senderName} (${cleanParticipant}): ${textMsg || '(Media Only)'}`);
                }
                return;
            }

            // 2. MONITOR CHANNEL MESSAGES
            if (from.endsWith('@newsletter')) {
                if (msg.key.fromMe) return;
                let textMsg = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
                if (waConfig.readModeTargets && waConfig.readModeTargets.includes(from)) {
                    logFn(`Received Read Mode message from Channel ${from}`);
                    let readCache = loadJsonConfig("./package/wa_read_cache.json", {});
                    if (!readCache[from]) readCache[from] = [];
                    readCache[from].push(`[${new Date().toLocaleTimeString('id-ID')}] Channel: ${textMsg}`);
                    if (readCache[from].length > 100) readCache[from].shift();
                    fs.writeFileSync("./package/wa_read_cache.json", JSON.stringify(readCache, null, 2));
                    return;
                }
                logFn(`[Channel Monitor] New update from ${from}. Content logged to log.txt.`);
                logFn(`📰 Channel ${from} update: ${textMsg}`);
                return;
            }

            // 3. REGULAR CHAT LOGIC
            if (msg.key.fromMe) return;
            
            const textMessage =
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.buttonsResponseMessage?.selectedButtonId ||
                msg.message.templateButtonReplyMessage?.selectedId ||
                msg.message.listResponseMessage?.singleSelectReply?.selectedRowId ||
                (() => {
                    try {
                        const raw = msg.message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
                        if (!raw) return null;
                        const parsed = JSON.parse(raw);
                        return parsed?.id || parsed?.selectedId || null;
                    } catch { return null; }
                })();
            const isMedia = msg.message.imageMessage || msg.message.documentMessage || msg.message.videoMessage || msg.message.audioMessage;
            const isGroup = from.endsWith('@g.us');
            const lowerText = textMessage ? textMessage.trim().toLowerCase() : '';

            logFn(`[DEBUG] textMessage="${textMessage}", isMedia=${!!isMedia}, isGroup=${isGroup}`);

            // Track incoming message
            trackMessage(from, isGroup);

            // Group checks
            if (isGroup) {
                const group = getGroup(from);
                if (group?.muted) return;
                if (group?.spam_protection && textMessage) {
                    const spam = checkSpam(from, participant, textMessage);
                    if (spam.spam) {
                        logFn(`[Spam] ${spam.reason} from ${participant} in ${from}`);
                        return;
                    }
                }
                if (group?.auto_reply_enabled && textMessage) {
                    const reply = checkAutoReply(textMessage);
                    if (reply) {
                        await waSock.sendMessage(from, { text: reply });
                        return;
                    }
                }
                // If AI not enabled in group, skip AI processing for non-prefix messages
                if (!group?.ai_enabled && !lowerText.startsWith('.openx')) {
                    // Allow commands but skip natural AI chat
                    if (!lowerText.startsWith('.group') && !lowerText.startsWith('.plugin') &&
                        !lowerText.startsWith('.play') && !lowerText.startsWith('.personality') &&
                        !lowerText.startsWith('.model') && !lowerText.startsWith('.stats') &&
                        !lowerText.startsWith('reset') && !lowerText.startsWith('clear') &&
                        !lowerText.startsWith('ram') && !lowerText.startsWith('ping') &&
                        !lowerText.startsWith('gc')) {
                        return;
                    }
                }
            }

            if (textMessage) {
                logFn(`Received WhatsApp message from ${from}: ${textMessage}`);
                
                // Handle 5-digit File ID retrieval
                if (/^\d{5}$/.test(textMessage.trim())) {
                    const fileIdNum = textMessage.trim();
                    const fileData = getLocalFileById(from, fileIdNum);
                    if (fileData && fs.existsSync(fileData.localPath)) {
                        try {
                            const aiAnsw = await askAI(`User just pulled File ID ${fileIdNum} (filename: ${fileData.filename}). Say something chill while I send it.`);
                            await waSock.sendPresenceUpdate('composing', from);
                            await waSock.sendMessage(from, { text: stripMarkdown(aiAnsw) || "Sending your file now..." }, { quoted: msg });
                            const ext = path.extname(fileData.localPath).toLowerCase();
                            const byteBuffer = fs.readFileSync(fileData.localPath);
                            if (['.jpg', '.jpeg', '.png'].includes(ext)) {
                                await waSock.sendMessage(from, { image: byteBuffer, caption: `File ID: ${fileIdNum}` });
                            } else if (['.mp4', '.avi'].includes(ext)) {
                                await waSock.sendMessage(from, { video: byteBuffer, caption: `File ID: ${fileIdNum}` });
                            } else if (['.ogg', '.mp3'].includes(ext)) {
                                await waSock.sendMessage(from, { audio: byteBuffer, mimetype: "audio/ogg" });
                            } else {
                                await waSock.sendMessage(from, { document: byteBuffer, fileName: fileData.filename, mimetype: "application/octet-stream" });
                            }
                            logFn(`Sent File ID ${fileIdNum} to ${from}`);
                        } catch (e) {
                            logError("Failed to reply with media ID: ", e);
                        }
                    } else {
                        const aiAnsw = await askAI(`User pulled File ID ${fileIdNum} but it's missing. Tell them casually (lu/gue) that I can't find it.`);
                        await waSock.sendMessage(from, { text: stripMarkdown(aiAnsw) || "Oops, couldn't find that File ID. Double check it!" });
                    }
                    return;
                }

                // Handle commands
                const cmdHandled = await handleCommands(from, textMessage, msg, waSock);
                if (cmdHandled) {
                    trackCommand(from, textMessage.trim().split(/\s+/)[0]);
                    return;
                }

                // Plugin system hook
                // (import handlePluginsMessage from plugin_manager when ready)

                let isComplex = false;
                let aiPromptUser = "";

                if (lowerText.startsWith('.openxc')) {
                    isComplex = true;
                    aiPromptUser = textMessage.trim().substring(7).trim();
                } else if (lowerText.startsWith('.openx')) {
                    isComplex = false;
                    aiPromptUser = textMessage.trim().substring(6).trim();
                } else if (!isGroup) {
                    // DM: respond naturally
                    aiPromptUser = textMessage.trim();
                    const complexHint = /(analis|analysis|debug|refactor|step by step|rinci|mendalam|kompleks|code|kode)/i;
                    isComplex = textMessage.length > 220 || complexHint.test(textMessage);
                } else if (isGroup) {
                    // Group: check mention or keyword trigger
                    const group = getGroup(from);
                    const botJid = waSock.user?.id?.replace(/:\d+/, '');
                    const mentionedJids = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    const isMentioned = botJid && mentionedJids.includes(botJid);

                    // Check keyword triggers
                    const keywords = group?.ai_keywords || ['bot', 'openx'];
                    const hasKeyword = keywords.some(kw => lowerText.includes(kw.toLowerCase()));

                    if (isMentioned || hasKeyword) {
                        // Strip mention from message
                        aiPromptUser = textMessage.trim();
                        if (botJid) {
                            aiPromptUser = aiPromptUser.replace(new RegExp(`@\\d+`, 'g'), '').trim();
                        }
                        isComplex = textMessage.length > 220;
                    } else {
                        return; // Not mentioned and no keyword — skip
                    }
                } else {
                    return;
                }

                if (!aiPromptUser) return;

                const senderName = msg.pushName || (participant ? participant.split('@')[0] : from.split('@')[0]);
                
                // Smart queue
                const existingReq = aiQueue.find(q => q.from === from);
                if (existingReq) {
                    existingReq.textMessage += `\n${senderName} asked: ${aiPromptUser}`;
                    existingReq.isComplex = isComplex || existingReq.isComplex;
                    logFn(`Appended to AI Queue for ${from}`);
                } else {
                    aiQueue.push({ msg, textMessage: `${senderName} asked: ${aiPromptUser}`, from, isComplex });
                    logFn(`Added message to AI Queue (Complex: ${isComplex}). Queue length: ${aiQueue.length}`);
                }
                
                processQueue(waSock, askAI, stripMarkdown);
            } else if (isMedia) {
                logFn(`Received media from WA ${from}. Downloading...`);
                const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
                    logger: pino({ level: 'silent' }),
                    reuploadRequest: waSock.updateMediaMessage
                });
                const type = Object.keys(msg.message)[0];
                const extension = type === 'imageMessage' ? 'jpg' :
                                  type === 'videoMessage' ? 'mp4' :
                                  type === 'audioMessage' ? 'ogg' : 'bin';
                let filename = `wa_media_${Date.now()}.${extension}`;
                if (type === 'documentMessage' && msg.message.documentMessage.fileName) {
                    filename = msg.message.documentMessage.fileName;
                }
                const fileIdNum = saveLocalFile(from, buffer, filename);
                logFn(`Saved persistent file from WA: ${filename} with ID ${fileIdNum}`);
                try {
                    await waSock.sendPresenceUpdate('composing', from);
                    const aiAnsw = await askAI(`User sent a file named "${filename}". I've saved it with ID ${fileIdNum}. Tell them casually (lu/gue) that it's saved and can be retrieved later using that ID.`);
                    await waSock.sendMessage(from, { text: stripMarkdown(aiAnsw) || `Got it! File saved with ID: ${fileIdNum}` }, { quoted: msg });
                } catch (err) {
                    await waSock.sendMessage(from, { text: `File saved! (ID: ${fileIdNum})` }, { quoted: msg });
                }
            }
        } catch (err) {
            logError(err);
        }
    });

    // Track group participant changes
    waSock.ev.on('group-participants.update', async (update) => {
        try {
            const { id, participants, action } = update;
            
            if (action === 'add') {
                for (const participant of participants) {
                    const name = participant.split('@')[0];
                    addGroupMember(id, participant, name);
                    logFn(`[Group] Member joined: ${name} in ${id}`);
                }
            } else if (action === 'remove') {
                for (const participant of participants) {
                    removeGroupMember(id, participant);
                    logFn(`[Group] Member left: ${participant} from ${id}`);
                }
            }
        } catch (err) {
            logError(err);
        }
    });
}
