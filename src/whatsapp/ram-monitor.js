import os from 'os';

const HISTORY_SIZE = 60; // keep last 60 readings (1 per minute)
const ramHistory = [];

export function getRamUsage() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    const percent = ((used / total) * 100).toFixed(1);

    const entry = {
        timestamp: Date.now(),
        used,
        free,
        total,
        percent: parseFloat(percent),
    };

    ramHistory.push(entry);
    if (ramHistory.length > HISTORY_SIZE) ramHistory.shift();

    return entry;
}

export function getRamReport() {
    const current = getRamUsage();
    const totalMB = (current.total / 1024 / 1024).toFixed(0);
    const usedMB = (current.used / 1024 / 1024).toFixed(0);
    const freeMB = (current.free / 1024 / 1024).toFixed(0);

    // Node.js heap
    const mem = process.memoryUsage();
    const heapUsed = (mem.heapUsed / 1024 / 1024).toFixed(1);
    const heapTotal = (mem.heapTotal / 1024 / 1024).toFixed(1);
    const rss = (mem.rss / 1024 / 1024).toFixed(1);

    // Process count
    const procs = os.cpus().length;

    // Uptime
    const uptime = os.uptime();
    const hours = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);

    let bar = '';
    const filled = Math.round(current.percent / 5);
    for (let i = 0; i < 20; i++) {
        bar += i < filled ? '█' : '░';
    }

    return [
        `💾 *RAM Monitor*`,
        ``,
        `System: ${usedMB}/${totalMB} MB (${current.percent}%)`,
        `${bar}`,
        ``,
        `Node.js Heap: ${heapUsed}/${heapTotal} MB`,
        `RSS: ${rss} MB`,
        `CPU Cores: ${procs}`,
        `Uptime: ${hours}h ${mins}m`,
    ].join('\n');
}

export function getRamTrend() {
    if (ramHistory.length < 2) return null;

    const recent = ramHistory.slice(-10);
    const avg = recent.reduce((s, e) => s + e.percent, 0) / recent.length;
    const max = Math.max(...recent.map(e => e.percent));
    const min = Math.min(...recent.map(e => e.percent));

    return {
        avg: avg.toFixed(1),
        max: max.toFixed(1),
        min: min.toFixed(1),
        samples: recent.length,
    };
}

export function forceGarbageCollect() {
    if (global.gc) {
        global.gc();
        return true;
    }
    return false;
}
