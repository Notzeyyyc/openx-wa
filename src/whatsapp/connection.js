import { makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestWaWebVersion } from '@crysnovax/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import { config } from '../config.js';
import { log, error as logError } from '../logger.js';
import { initPluginManager } from '../plugin-manager.mjs';
import { askAI } from './ai-processor.js';
import { stripMarkdown } from './helpers.js';
import { setupMessageHandler } from './message-router.js';
import { startReminderChecker } from './reminders.js';

let autoPostInterval = null;

export let waSock = null;

export async function connectToWhatsApp() {
    log('Attempting to connect to WhatsApp...');
    
    const { state, saveCreds } = await useMultiFileAuthState('caches/baileys_auth_info');
    const { version } = await fetchLatestWaWebVersion();
    
    waSock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '20.0.04']
    });

    waSock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            log('Please scan the WhatsApp QR Code below:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            logError(`WhatsApp connection closed, reason: ${lastDisconnect.error?.message}. Reconnect: ${shouldReconnect}`);
            if (shouldReconnect) {
                connectToWhatsApp();
            } else {
                log('WhatsApp logged out, please delete caches/baileys_auth_info folder to relogin.');
            }
        } else if (connection === 'open') {
            log('Successfully connected to WhatsApp!');

            // Initialise plugin system
            if (!config.devPhoneNumber) {
                logError('Missing OPENX_DEV_PHONE_NUMBER. Set it in environment/.env before running.');
            }
            const adminJid = (config.devPhoneNumber || '').includes('@')
                ? config.devPhoneNumber
                : `${config.devPhoneNumber}@s.whatsapp.net`;
            const notify = (text) => {
                try { waSock.sendMessage(adminJid, { text: String(text) }); } catch {}
            };
            initPluginManager({ notify, sendMessageFn: (jid, msg) => waSock.sendMessage(jid, msg) }).catch(() => {});

            // Start reminder checker
            startReminderChecker(waSock);
            
            // Interval Auto-Post ke Admin Channels (1 jam)
            if (autoPostInterval) clearInterval(autoPostInterval);
            autoPostInterval = setInterval(async () => {
                let waConfig = { adminChannels: [] };
                try { waConfig = JSON.parse(fs.readFileSync("./package/wa_config.json", "utf-8")); } catch(e) {}
                
                if (waConfig.adminChannels && waConfig.adminChannels.length > 0) {
                    for (const channelJid of waConfig.adminChannels) {
                        try {
                            const topicContext = "Buatkan satu post menarik, singkat, random (misal fakta unik, komedi, berita singkat, tips, atau sapaan) untuk disebarkan (broadcast) ke WhatsApp Channel kekinian. Gunakan bahasa gaul lu/gue yang asik tanpa basa-basi.";
                            const postContent = await askAI(topicContext);
                            await waSock.sendMessage(channelJid, { text: stripMarkdown(postContent) });
                            log(`[Cron] Successfully posted random content to WA Channel: ${channelJid}`);
                        } catch (err) {
                            logError(`[Cron] Failed posting to channel ${channelJid}: ${err.message}`);
                        }
                    }
                }
            }, 3600000);
        }
    });

    waSock.ev.on('creds.update', saveCreds);

    setupMessageHandler(waSock);
}
