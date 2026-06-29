import { exec } from 'child_process';
import util from 'util';
import net from 'net';

const execPromise = util.promisify(exec);

/**
 * Forces ADB to listen on port 5555 using root access.
 * This allows ADB to work via localhost even without WiFi.
 */
async function enableAdbRoot() {
    try {
        console.log("🔓 Attempting to force ADB TCP port 5555 via Root...");
        await execPromise('su -c "setprop service.adb.tcp.port 5555 && stop adbd && start adbd"');
        // Give adbd a moment to restart
        await new Promise(resolve => setTimeout(resolve, 2000));
        return true;
    } catch (e) {
        console.log("⚠️ Root ADB force failed (is device rooted?):", e.message);
        return false;
    }
}

/**
 * Scans for open ADB ports on localhost within the common range for Wireless Debugging.
 */
export async function scanAdbPorts(start = 37000, end = 44000) {
    const ports = [];
    const step = 500; // Scan in chunks to avoid overwhelming the system
    
    for (let i = start; i <= end; i += step) {
        const chunkEnd = Math.min(i + step - 1, end);
        const promises = [];
        
        for (let port = i; port <= chunkEnd; port++) {
            promises.push(new Promise((resolve) => {
                const socket = new net.Socket();
                socket.setTimeout(150); // Short timeout for local scan
                
                socket.on('connect', () => {
                    ports.push(port);
                    socket.destroy();
                    resolve();
                });
                
                socket.on('timeout', () => {
                    socket.destroy();
                    resolve();
                });
                
                socket.on('error', () => {
                    socket.destroy();
                    resolve();
                });
                
                socket.connect(port, '127.0.0.1');
            }));
        }
        
        await Promise.all(promises);
        if (ports.length >= 3) break; // Stop if we found a few potential candidates
    }
    return ports;
}

/**
 * Tries to detect the current ADB port from mDNS, root forcing, or scanning.
 */
export async function detectAdbPort() {
    console.log("🔍 Auto-detecting ADB port...");
    
    // 1. Try to force port 5555 via Root (Best for no-WiFi scenario)
    const rootSuccess = await enableAdbRoot();
    if (rootSuccess) {
        try {
            const { stdout } = await execPromise(`adb connect localhost:5555`);
            if (stdout.includes("connected to")) {
                console.log(`✅ Successfully connected via Root: localhost:5555`);
                return "5555";
            }
        } catch(e) {}
    }

    // 2. Try mDNS next
    try {
        const { stdout } = await execPromise('adb mdns services');
        const match = stdout.match(/localhost:(\d+)/) || stdout.match(/127\.0\.0\.1:(\d+)/);
        if (match) {
            console.log(`✅ mDNS found port: ${match[1]}`);
            return match[1];
        }
    } catch(e) {}

    // 3. Scan common ports
    console.log("⏳ Falling back to scanning localhost ports (37000-44000)...");
    const openPorts = await scanAdbPorts(37000, 44000);
    
    for (const port of openPorts) {
        try {
            const { stdout } = await execPromise(`adb connect localhost:${port}`);
            if (stdout.includes("connected to")) {
                console.log(`✅ Successfully detected and connected to: localhost:${port}`);
                return port.toString();
            }
        } catch(e) {}
    }

    // 4. Final Fallback to 5555
    return "5555";
}

// Support running as a standalone script
if (process.argv[1] && (process.argv[1].endsWith('adb_connect.js') || process.argv[1].endsWith('adb_connect.mjs'))) {
    const manualPort = process.argv[2];
    if (manualPort) {
        console.log(`⏳ Connecting to localhost:${manualPort}...`);
        execPromise(`adb connect localhost:${manualPort}`).then(({stdout}) => console.log(stdout.trim()));
    } else {
        detectAdbPort();
    }
}
