import { downloadBinary } from '../src/ytdlp.js';

const force = process.argv.includes('--force');

try {
    const binPath = await downloadBinary({ force });
    console.log(`✅ yt-dlp siap: ${binPath}`);
} catch (e) {
    console.error(`❌ Gagal install yt-dlp: ${e.message}`);
    process.exit(1);
}
