import fs from "fs";
import path from "path";

const COBALT_API_URL = "https://api.cobalt.tools/api/json";

/**
 * Downloads media from various social media platforms using Cobalt API.
 */
export async function downloadMedia(url) {
    try {
        const response = await fetch(COBALT_API_URL, {
            method: "POST",
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                url: url,
                vCodec: "h264",
                vQuality: "720",
                aFormat: "mp3",
                isNoWatermark: true
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(`Cobalt API error: ${err.message || response.statusText}`);
        }

        const data = await response.json();
        
        if (data.status === "stream" || data.status === "picker") {
            // For now, only return the first stream URL
            const mediaUrl = data.status === "stream" ? data.url : (data.picker ? data.picker[0].url : null);
            if (!mediaUrl) throw new Error("No media URL found in picker response.");
            
            // Fetch the actual media buffer
            const mediaResponse = await fetch(mediaUrl);
            if (!mediaResponse.ok) throw new Error(`Failed to fetch media from ${mediaUrl}`);
            
            const buffer = Buffer.from(await mediaResponse.arrayBuffer());
            
            // Try to guess extension from URL or content-type
            let ext = "bin";
            const contentType = mediaResponse.headers.get("content-type");
            if (contentType) {
                if (contentType.includes("video")) ext = "mp4";
                else if (contentType.includes("audio")) ext = "mp3";
                else if (contentType.includes("image")) ext = "jpg";
            }
            
            const filename = `openx_dl_${Date.now()}.${ext}`;
            return { buffer, filename, type: ext === "mp3" ? "audio" : (ext === "mp4" ? "video" : "document") };
        }
        
        throw new Error(`Unexpected status from Cobalt: ${data.status}`);
    } catch (error) {
        console.error(`[Downloader] Error: ${error.message}`);
        throw error;
    }
}
