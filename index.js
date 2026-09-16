import { log } from "./src/logger.js";
import { connectToWhatsApp } from "./src/whatsapp/connection.js";
import { startScheduler } from "./src/scheduler.js";

log("Starting OPENX Bot (WhatsApp Focus)...");
startScheduler();
connectToWhatsApp();
