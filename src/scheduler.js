import { loadJsonConfig } from './config.js';
import { log, error as logError } from './logger.js';
import { DATA_DIR } from './paths.js';
import cron from 'node-cron';
import path from 'path';
import { waSock } from './whatsapp/connection.js';

export function startScheduler() {
    cron.schedule('* * * * *', async () => {
        try {
            const schedules = loadJsonConfig(path.join(DATA_DIR, 'schedules.json'), []);
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
}
