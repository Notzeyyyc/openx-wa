import { config, loadJsonConfig } from "./src/config.js";
import fs from "fs";
import { log, error as logError } from "./src/logger.js";
import { connectToWhatsApp, waSock } from "./src/whatsapp/connection.js";
import { initDB } from "./src/database.js";
import cron from "node-cron";


// Initialize Cron for Schedules
cron.schedule('* * * * *', async () => {
    try {
        const schedules = loadJsonConfig("./package/schedules.json", []);
        if (schedules.length === 0) return;
        
        const now = new Date();
        const currentMinute = now.getMinutes();
        const currentHour = now.getHours();
        const currentDay = now.getDay();
        
        for (const s of schedules) {
            if (!s.cronString) continue;
            const [minStr, hourStr, dom, month, dow] = s.cronString.split(' ');
            
            const minMatch = minStr === '*' || parseInt(minStr) === currentMinute;
            const hourMatch = hourStr === '*' || parseInt(hourStr) === currentHour;
            const dowMatch = dow === '*' || parseInt(dow) === currentDay;

            if (minMatch && hourMatch && dowMatch) {
                const message = `⏰ *SCHEDULE ALERT*\n\n${s.text}`;
                
                if (s.targets && s.targets.length > 0 && waSock) {
                    for (const target of s.targets) {
                        const cleanTarget = target.includes('@') ? target : `${target}@s.whatsapp.net`;
                        waSock.sendMessage(cleanTarget, { text: message }).catch(e => logError(`Schedule failed (WA ${target}):`, e));
                    }
                }
                log(`[CRON] Schedule executed: ${s.id}`);
            }
        }
    } catch(e) {
        logError("Cron schedule check failed:", e);
    }
});

async function start() {
    log("Starting OPENX Bot (WhatsApp Focus)...");
    await initDB();
    log("Database initialized");
    connectToWhatsApp();
}

start();
