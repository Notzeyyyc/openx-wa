import { config } from "../../../config.js";

let keyIndex = 0;

function getNextKey() {
    const keys = config.ai?.openrouter?.apiKeys || config.openrouter?.apiKeys || [];
    if (keys.length === 0) throw new Error("No OpenRouter API keys configured");
    const key = keys[keyIndex % keys.length];
    keyIndex = (keyIndex + 1) % keys.length;
    return key;
}

export async function chatCompletion(messages, model = null, isComplex = false) {
    const keys = config.ai?.openrouter?.apiKeys || config.openrouter?.apiKeys || [];
    if (keys.length === 0) throw new Error("No OpenRouter API keys configured");

    const { OpenRouter } = await import("@openrouter/sdk");
    const or = new OpenRouter({ apiKey: getNextKey() });

    const targetModel = model || "stepfun/step-3.5-flash:free";

    const response = await or.chat.completions.create({
        model: targetModel,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
    });

    return response.choices?.[0]?.message?.content || "";
}
