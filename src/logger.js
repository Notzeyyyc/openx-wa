import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

const logFile = path.join(process.cwd(), 'log.txt');

export function log(message) {
    const timestamp = new Date().toISOString();
    const formattedMsg = `[${timestamp}] INFO: ${message}`;
    
    // Log to console (with color if desired)
    console.log(chalk.blue(`[${timestamp}]`), chalk.green('INFO:'), message);
    
    // Write to file
    fs.appendFileSync(logFile, formattedMsg + '\n');
}

export function error(err) {
    const timestamp = new Date().toISOString();
    const formattedMsg = `[${timestamp}] ERROR: ${err instanceof Error ? err.stack : err}`;
    
    // Log to console
    console.error(chalk.blue(`[${timestamp}]`), chalk.red('ERROR:'), err);
    
    // Write to file
    fs.appendFileSync(logFile, formattedMsg + '\n');
}
