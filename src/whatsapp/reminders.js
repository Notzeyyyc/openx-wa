import fs from 'fs';
import { loadJsonConfig, writeJsonConfig } from '../config.js';

const REMINDERS_PATH = './package/reminders.json';
let checkInterval = null;

function loadReminders() {
    return loadJsonConfig(REMINDERS_PATH, []);
}

function saveReminders(reminders) {
    writeJsonConfig(REMINDERS_PATH, reminders);
}

export function setReminder(chatId, timeStr, text) {
    const reminders = loadReminders();
    const reminder = {
        id: Date.now().toString().slice(-6),
        chatId,
        text,
        time: timeStr, // format: "HH:MM" or "YYYY-MM-DD HH:MM"
        created: new Date().toISOString(),
        fired: false
    };
    reminders.push(reminder);
    saveReminders(reminders);
    return reminder;
}

export function listReminders(chatId) {
    const reminders = loadReminders();
    return reminders.filter(r => r.chatId === chatId && !r.fired);
}

export function cancelReminder(chatId, reminderId) {
    const reminders = loadReminders();
    const idx = reminders.findIndex(r => r.id === reminderId && r.chatId === chatId);
    if (idx === -1) return false;
    reminders.splice(idx, 1);
    saveReminders(reminders);
    return true;
}

export function startReminderChecker(waSock) {
    if (checkInterval) return;
    checkInterval = setInterval(async () => {
        const reminders = loadReminders();
        const now = new Date();
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        let changed = false;

        for (const r of reminders) {
            if (r.fired) continue;
            if (r.time === currentTime || (r.time.length === 5 && r.time === currentTime)) {
                r.fired = true;
                changed = true;
                if (waSock) {
                    await waSock.sendMessage(r.chatId, {
                        text: `⏰ *Reminder*\n\n${r.text}`
                    }).catch(() => {});
                }
            }
        }

        if (changed) saveReminders(reminders);
    }, 60000); // Check every minute
}
