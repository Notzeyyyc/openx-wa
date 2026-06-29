import { exec, spawn } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';

const execPromise = util.promisify(exec);

/**
 * Diagnostics for the remote Android device via ADB.
 */
export async function getDeviceInfo() {
    let info = "[Device Info via ADB]\n";
    try {
        // RAM Diagnostics
        try {
            const { stdout: ramOut } = await execPromise('adb shell cat /proc/meminfo');
            const totalMatch = ramOut.match(/MemTotal:\s+(\d+)\s+kB/);
            const freeMatch = ramOut.match(/MemFree:\s+(\d+)\s+kB/);
            const availMatch = ramOut.match(/MemAvailable:\s+(\d+)\s+kB/);
            if (totalMatch) {
                const totalMb = Math.round(parseInt(totalMatch[1]) / 1024);
                const freeMb = availMatch ? Math.round(parseInt(availMatch[1]) / 1024) : 
                               (freeMatch ? Math.round(parseInt(freeMatch[1]) / 1024) : 0);
                info += `- RAM: ${freeMb}MB Free / ${totalMb}MB Total\n`;
            }
        } catch (e) {
            info += `- RAM: Read failed (/proc/meminfo)\n`;
        }
        
        // Kernel / OS details
        try {
            const { stdout: unameOut } = await execPromise('adb shell uname -a');
            info += `- Kernel: ${unameOut.trim()}\n`;
        } catch (e) { }

        // Local Storage (/data partition)
        try {
            const { stdout: dfOut } = await execPromise("adb shell df -h /data");
            const lines = dfOut.trim().split('\n');
            if (lines.length > 1) {
                const parts = lines[1].trim().split(/\s+/);
                // Filesystem Size Used Avail Use% Mounted on
                info += `- Storage Data: ${parts[3]} Free / ${parts[1]} Total (${parts[4]} Used)\n`;
            }
        } catch (e) {}

        // Root Access check
        try {
            const { stdout: suOut } = await execPromise('adb shell which su');
            if (suOut.trim().length > 0) info += `- Root: SU Access Available (${suOut.trim()})\n`;
        } catch (e) {
            info += `- Root: Not detected\n`;
        }

    } catch (e) {
        info += "ADB failed or device disconnected.\n";
    }
    
    return info;
}

/**
 * Fetches all 3rd-party apps installed on the device.
 */
export async function getAppList() {
    try {
        const { stdout } = await execPromise('adb shell pm list packages -3');
        const lines = stdout.trim().split('\n');
        const apps = lines.map(line => line.replace('package:', '').trim()).filter(p => p);
        if (apps.length === 0) return "No 3rd party apps found.";
        return `[Installed App Packages]:\n${apps.join(', ')}`;
    } catch (e) {
        return "Failed to fetch app list via ADB.";
    }
}

/**
 * Launches an application using its package name.
 */
export async function openApp(pkgName) {
    try {
        // Use monkey for a simple force-launch of the main activity
        await execPromise(`adb shell monkey -p ${pkgName} -c android.intent.category.LAUNCHER 1`);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Open an app using monkey launcher trigger.
 * Alias with stronger name for AI command mapping.
 */
export async function launchApp(pkgName) {
    return openApp(pkgName);
}

/**
 * Captures a high-quality screenshot from the device.
 */
export function takeScreenshot(outputPath) {
    return new Promise((resolve) => {
        try {
            const adbProc = spawn('adb', ['exec-out', 'screencap', '-p'], { shell: false });
            const stream = fs.createWriteStream(outputPath);
            adbProc.stdout.pipe(stream);
            
            adbProc.on('close', (code) => resolve(code === 0));
            adbProc.on('error', () => resolve(false));
            stream.on('error', () => resolve(false));
        } catch (e) {
            resolve(false);
        }
    });
}

/**
 * Injects text input into the active focused element on the device.
 */
export async function typeText(text) {
    try {
        // Escaping spaces for ADB input
        const escapedText = text.replace(/ /g, '%s').replace(/'/g, "\\'");
        await execPromise(`adb shell input text "${escapedText}"`);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Opens a Google search query in the device's default browser.
 */
export async function searchWeb(query) {
    try {
        const encodedQuery = encodeURIComponent(query);
        const url = `https://www.google.com/search?q=${encodedQuery}`;
        await execPromise(`adb shell am start -a android.intent.action.VIEW -d "${url}"`);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Sends a system notification to the Android device.
 */
export async function sendNotification(title, message) {
    try {
        const escapedTitle = title.replace(/"/g, '\\"');
        const escapedMsg = message.replace(/"/g, '\\"');
        // Works on Android 7.0+
        await execPromise(`adb shell cmd notification post -S big_text -t "${escapedTitle}" tag1 "${escapedMsg}"`);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Dump current UI hierarchy XML using uiautomator.
 * Returns lightweight metadata so caller can inspect quickly.
 */
export async function dumpUiHierarchy() {
    try {
        const devicePath = '/sdcard/window_dump.xml';
        await execPromise(`adb shell uiautomator dump ${devicePath}`);
        const { stdout } = await execPromise(`adb shell cat ${devicePath}`);
        const nodeCount = (stdout.match(/<node /g) || []).length;
        return {
            ok: true,
            nodeCount,
            xml: stdout
        };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/**
 * Try to tap a UI node by visible text using bounds from UIAutomator XML.
 */
export async function tapByText(text) {
    try {
        const dump = await dumpUiHierarchy();
        if (!dump.ok) return false;

        const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rx = new RegExp(`<node[^>]*text="${escaped}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`, 'i');
        const m = dump.xml.match(rx);
        if (!m) return false;

        const x = Math.floor((parseInt(m[1]) + parseInt(m[3])) / 2);
        const y = Math.floor((parseInt(m[2]) + parseInt(m[4])) / 2);
        await execPromise(`adb shell input tap ${x} ${y}`);
        return true;
    } catch {
        return false;
    }
}

/**
 * Try to tap a UI node by resource-id using bounds from UIAutomator XML.
 */
export async function tapByResourceId(resourceId) {
    try {
        const dump = await dumpUiHierarchy();
        if (!dump.ok) return false;

        const escaped = resourceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rx = new RegExp(`<node[^>]*resource-id="${escaped}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`, 'i');
        const m = dump.xml.match(rx);
        if (!m) return false;

        const x = Math.floor((parseInt(m[1]) + parseInt(m[3])) / 2);
        const y = Math.floor((parseInt(m[2]) + parseInt(m[4])) / 2);
        await execPromise(`adb shell input tap ${x} ${y}`);
        return true;
    } catch {
        return false;
    }
}

/**
 * Scroll the screen using a swipe gesture.
 */
export async function scrollScreen(direction = 'down') {
    try {
        const d = String(direction).toLowerCase();
        if (d === 'up') {
            await execPromise('adb shell input swipe 500 600 500 1400 350');
            return true;
        }
        await execPromise('adb shell input swipe 500 1400 500 600 350');
        return true;
    } catch {
        return false;
    }
}

/**
 * Press common navigation keys.
 */
export async function pressBack() {
    try {
        await execPromise('adb shell input keyevent 4');
        return true;
    } catch {
        return false;
    }
}

export async function pressHome() {
    try {
        await execPromise('adb shell input keyevent 3');
        return true;
    } catch {
        return false;
    }
}

/**
 * Execute semicolon-delimited UI flow in sequence.
 * Format example:
 *   open:com.whatsapp;tap_text:Search;type:hello;scroll:down;back
 */
export async function runUiFlow(flowText, options = {}) {
    return runUiFlowWithOptions(flowText, options);
}

async function hasTextInUi(text) {
    const dump = await dumpUiHierarchy();
    if (!dump.ok) return false;
    const escaped = String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`text="${escaped}"`, 'i');
    return rx.test(dump.xml);
}

async function hasIdInUi(resourceId) {
    const dump = await dumpUiHierarchy();
    if (!dump.ok) return false;
    const escaped = String(resourceId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`resource-id="${escaped}"`, 'i');
    return rx.test(dump.xml);
}

async function runUiFlowWithOptions(flowText, options = {}) {
    const steps = String(flowText || '')
        .split(';')
        .map(s => s.trim())
        .filter(Boolean);

    const retries = Math.min(Math.max(parseInt(options.retries ?? 1, 10), 0), 5);
    const verifyWaitMs = Math.min(Math.max(parseInt(options.verifyWaitMs ?? 500, 10), 100), 5000);
    const logs = [];
    if (steps.length === 0) {
        return { ok: false, logs: ['No steps provided'] };
    }

    for (const raw of steps) {
        const [opRaw, ...rest] = raw.split(':');
        const op = String(opRaw || '').trim().toLowerCase();
        const arg = rest.join(':').trim();
        let ok = false;
        const tryCount = retries + 1;

        for (let i = 0; i < tryCount; i++) {
            if (op === 'open' && arg) ok = await launchApp(arg);
            else if (op === 'tap_text' && arg) ok = await tapByText(arg);
            else if (op === 'tap_id' && arg) ok = await tapByResourceId(arg);
            else if (op === 'scroll') ok = await scrollScreen(arg || 'down');
            else if (op === 'back') ok = await pressBack();
            else if (op === 'home') ok = await pressHome();
            else if (op === 'type' && arg) ok = await typeText(arg);
            else if (op === 'wait') {
                const ms = Math.min(Math.max(parseInt(arg || '500', 10), 100), 10000);
                await new Promise(r => setTimeout(r, ms));
                ok = true;
            } else if (op === 'verify_text' && arg) {
                await new Promise(r => setTimeout(r, verifyWaitMs));
                ok = await hasTextInUi(arg);
            } else if (op === 'verify_id' && arg) {
                await new Promise(r => setTimeout(r, verifyWaitMs));
                ok = await hasIdInUi(arg);
            }

            if (ok) break;
            if (i < tryCount - 1) await new Promise(r => setTimeout(r, 350));
        }

        logs.push(`${ok ? 'OK' : 'FAIL'} ${raw}${tryCount > 1 ? ` (retry=${retries})` : ''}`);
        if (!ok) return { ok: false, logs };
    }

    return { ok: true, logs };
}

/**
 * Fetches detailed health status (battery, thermal, and storage).
 */
export async function getHealthStatus() {
    let health = "[Device Health Report]\n";
    try {
        // Battery Info
        try {
            const { stdout: batOut } = await execPromise('adb shell dumpsys battery');
            const levelMatch = batOut.match(/level:\s+(\d+)/);
            const tempMatch = batOut.match(/temperature:\s+(\d+)/);
            const statusMatch = batOut.match(/status:\s+(\d+)/);
            
            if (levelMatch) health += `🔋 Battery: ${levelMatch[1]}%\n`;
            if (tempMatch) health += `🌡️ Temp: ${(parseInt(tempMatch[1]) / 10).toFixed(1)}°C\n`;
            
            const statuses = { 1: "Unknown", 2: "Charging", 3: "Discharging", 4: "Not Charging", 5: "Full" };
            if (statusMatch) health += `⚡ Status: ${statuses[statusMatch[1]] || "Unknown"}\n`;
        } catch (e) { health += "🔋 Battery: (Read Failed)\n"; }

        // Storage Info
        try {
            const { stdout: dfOut } = await execPromise("adb shell df -h /data");
            const lines = dfOut.trim().split('\n');
            if (lines.length > 1) {
                const parts = lines[1].trim().split(/\s+/);
                health += `💾 Storage: ${parts[3]} Free / ${parts[1]} Total (${parts[4]} Used)\n`;
            }
        } catch (e) {}

        // Uptime
        try {
            const { stdout: upOut } = await execPromise("adb shell uptime");
            health += `⏱️ Uptime: ${upOut.trim()}\n`;
        } catch (e) {}

    } catch (e) {
        health += "ADB failed or device disconnected.\n";
    }
    return health;
}
