import { config } from "../src/config.js";

async function checkAccount(apiKey, index) {
    console.log(`Checking OpenRouter API Key #${index}...`);
    // Avoid printing secrets. Show only last 4 chars.
    const tail = String(apiKey).slice(-4);
    console.log(`Key: ****${tail}`);

    if (apiKey.includes("REPLACE_WITH")) {
        console.warn(`[!] Key #${index} is still a placeholder. Skipping.`);
        return;
    }

    try {
        const response = await fetch("https://openrouter.ai/api/v1/credits", {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            }
        });

        if (!response.ok) {
            console.error(`Error: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.error("Response:", text);
            return;
        }

        const data = await response.json();
        console.log(`--- Key #${index} Info ---`);
        console.log(JSON.stringify(data, null, 2));
        console.log("------------------------");

    } catch (error) {
        console.error(`Fetch failed for Key #${index}:`, error.message);
    }
}

async function run() {
    const keys = config.openrouter.apiKeys || [];
    if (keys.length === 0) {
        console.error("No API keys found. Set OPENX_OPENROUTER_API_KEYS in your environment.");
        return;
    }

    for (let i = 0; i < keys.length; i++) {
        await checkAccount(keys[i], i);
        console.log("");
    }
}

run();