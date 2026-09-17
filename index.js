import { log } from "./src/logger.js";
import { connectToWhatsApp } from "./src/whatsapp/connection.js";
import { startScheduler } from "./src/scheduler.js";
import { ensureSetupCode } from "./src/owner.js";
import { ensureBinary } from "./src/ytdlp.js";

// Silence libsignal's console.info("Closing session:", ...) —
// it dumps full session records (including key material) to stdout,
// bypassing pino({level:'silent'}). The bot uses its own logger.
console.info = () => {};

log("Starting OPENX Bot (WhatsApp Focus)...");

const setupCode = ensureSetupCode();
if (setupCode) {
    log(`🔑 Belum ada owner. Kode setup: ${setupCode}`);
    log("   Kirim `.start <kode>` ke bot buat klaim owner.");
}

startScheduler();
connectToWhatsApp();

// Warm up the yt-dlp binary in the background (auto-download if missing).
ensureBinary().catch(e => log(`[yt-dlp] auto-download gagal: ${e.message}`));
