import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

const logFile = path.join(process.cwd(), 'log.txt');
const MAX_LOG_BYTES = 5 * 1024 * 1024;

let writesSinceRotateCheck = 0;

function maybeRotate() {
    if (++writesSinceRotateCheck < 500) return;
    writesSinceRotateCheck = 0;
    try {
        if (fs.statSync(logFile).size > MAX_LOG_BYTES) {
            const tail = Buffer.alloc(1024 * 1024);
            const fd = fs.openSync(logFile, 'r');
            const size = fs.fstatSync(fd).size;
            fs.readSync(fd, tail, 0, tail.length, size - tail.length);
            fs.closeSync(fd);
            fs.writeFileSync(logFile, tail);
        }
    } catch {}
}

export function log(message) {
    const timestamp = new Date().toISOString();
    console.log(chalk.blue(`[${timestamp}]`), chalk.green('INFO:'), message);
    fs.appendFileSync(logFile, `[${timestamp}] INFO: ${message}\n`);
    maybeRotate();
}

export function error(err) {
    const timestamp = new Date().toISOString();
    console.error(chalk.blue(`[${timestamp}]`), chalk.red('ERROR:'), err);
    fs.appendFileSync(logFile, `[${timestamp}] ERROR: ${err instanceof Error ? err.stack : err}\n`);
    maybeRotate();
}
