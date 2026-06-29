/**
 * package/plugins/ping.mjs
 * 
 * Plugin contoh sederhana.
 * Merespons pesan "ping" dengan "pong!".
 */

export async function init({ host }) {
    // Fungsi ini dipanggil sekali saat bot dijalankan/plugin dimuat.
    console.log('[Plugin] Ping loaded');
}

export async function onMessage({ jid, text, host }) {
    // Fungsi ini dipanggil setiap ada pesan masuk.
    if (text && text.toLowerCase().trim() === 'ping') {
        return {
            handled: true,
            replyText: 'Pong! 🏓'
        };
    }

    // handled: false artinya bot akan lanjut ke module/plugin lain.
    return { handled: false };
}
