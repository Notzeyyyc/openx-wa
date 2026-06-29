// OpenX REST API Connection Test (Node.js)
// Usage: node test-api.mjs

const BASE_URL = process.env.OPENX_REST_BASE_URL || "https://zelapioffciall.dpdns.org/ai/sdk";
const API_KEY = process.env.OPENX_REST_API_KEY || "";
const MODEL = process.env.OPENX_REST_MODEL || "deepseek/deepseek-v4-pro";
const METHOD = process.env.OPENX_REST_METHOD || "GET";
const PARAM_NAME = process.env.OPENX_REST_PARAM_NAME || "text";
const APIKEY_PARAM = process.env.OPENX_REST_APIKEY_PARAM || "apikey";

console.log("==================================");
console.log("  OpenX REST API Connection Test");
console.log("==================================");
console.log("");
console.log("[Config]");
console.log("  Base URL:     " + BASE_URL);
console.log("  API Key:      " + (API_KEY ? API_KEY.slice(0, 8) + "...(set)" : "(EMPTY - not set!)"));
console.log("  Model:        " + MODEL);
console.log("  Method:       " + METHOD);
console.log("  Param Name:   " + PARAM_NAME);
console.log("  ApiKey Param: " + APIKEY_PARAM);
console.log("");

const TEST_PROMPT = "Hello, respond with just OK";

async function testGET() {
    console.log("[1/2] Testing GET request...");
    const params = new URLSearchParams();
    params.set(PARAM_NAME, TEST_PROMPT);
    params.set("model", MODEL);
    if (API_KEY) params.set(APIKEY_PARAM, API_KEY);
    
    const url = BASE_URL + "?" + params.toString();
    console.log("  URL: " + url.slice(0, 200));
    
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        
        const res = await fetch(url, {
            method: "GET",
            headers: { "Accept": "application/json" },
            signal: controller.signal,
        });
        clearTimeout(timeout);
        
        console.log("  Status: " + res.status + " " + res.statusText);
        const body = await res.text();
        console.log("  Response (" + body.length + " bytes): " + body.slice(0, 200));
        
        if (body.includes("error")) {
            console.log("  WARN: Response contains error");
        } else if (res.ok) {
            console.log("  OK: GET request successful");
        } else {
            console.log("  FAIL: Server returned error");
        }
    } catch (e) {
        console.log("  FAIL: " + e.message);
    }
    console.log("");
}

async function testPOST() {
    console.log("[2/2] Testing POST request...");
    const payload = {
        [PARAM_NAME]: TEST_PROMPT,
        model: MODEL,
    };
    if (API_KEY) payload[APIKEY_PARAM] = API_KEY;
    
    console.log("  Payload: " + JSON.stringify(payload).slice(0, 200));
    
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        
        const res = await fetch(BASE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
        clearTimeout(timeout);
        
        console.log("  Status: " + res.status + " " + res.statusText);
        const body = await res.text();
        console.log("  Response (" + body.length + " bytes): " + body.slice(0, 200));
        
        if (body.includes("error")) {
            console.log("  WARN: Response contains error");
        } else if (res.ok) {
            console.log("  OK: POST request successful");
        } else {
            console.log("  FAIL: Server returned error");
        }
    } catch (e) {
        console.log("  FAIL: " + e.message);
    }
    console.log("");
}

async function main() {
    await testGET();
    await testPOST();
    
    console.log("==================================");
    console.log("  Test Complete");
    console.log("==================================");
    console.log("");
    if (!API_KEY) {
        console.log("  ⚠ API KEY IS NOT SET!");
        console.log("  Set it with:");
        console.log("    export OPENX_REST_API_KEY='your-api-key'");
    }
}

main().catch(console.error);
