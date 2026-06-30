import { config, loadJsonConfig } from "./src/config.js";
import fs from "fs";
import { log, error as logError } from "./src/logger.js";
import { connectToWhatsApp, waSock } from "./src/whatsapp/connection.js";
import { initDB } from "./src/database.js";
import cron from "node-cron";
import { exec } from 'child_process';
import util from 'util';
const execPromise = util.promisify(exec);
import { detectAdbPort } from './src/adb-connect.js';

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

async function connectADB() {
    if (!config.adbPort) return;

    // USB mode: verify device is connected
    if (config.adbPort === "usb") {
        try {
            const { stdout } = await execPromise('adb devices');
            const lines = stdout.trim().split('\n').slice(1).filter(l => l.includes('\tdevice'));
            if (lines.length === 0) {
                logError("No USB device found. Connect phone via USB and enable USB debugging.");
                return;
            }
            const serial = lines[0].split('\t')[0];
            log(`✅ USB device connected: ${serial}`);
        } catch (e) {
            logError("USB ADB check failed:", e);
        }
        return;
    }

    // Root mode: force ADB TCP via su
    if (config.adbPort === "root") {
        try {
            log("⏳ Forcing ADB TCP port 5555 via root...");
            const result = await execPromise('su -c "setprop service.adb.tcp.port 5555 && stop adbd && start adbd"');
            log(`Root output: ${result.stdout || '(empty)'} ${result.stderr || ''}`);
            log("⏳ Waiting for adbd to restart...");
            await new Promise(resolve => setTimeout(resolve, 3000));
            const { stdout } = await execPromise('adb connect localhost:5555');
            log(`✅ ADB (root): ${stdout.trim()}`);
        } catch (e) {
            logError("Root ADB failed:", e.message);
            logError("Full error:", e);
        }
        return;
    }

    // TCP auto-detect
    if (config.adbPort === "auto") {
        await detectAdbPort();
        return;
    }

    // Fixed TCP port
    log(`⏳ Connecting to localhost:${config.adbPort}...`);
    try {
        const { stdout } = await execPromise(`adb connect localhost:${config.adbPort}`);
        log(`✅ ADB: ${stdout.trim()}`);
    } catch (e) {
        logError("ADB connect failed:", e);
    }
}

async function start() {
    log("Starting OPENX Bot (WhatsApp Focus)...");
    await initDB();
    log("Database initialized");
    await connectADB();
    connectToWhatsApp();
}

start();
