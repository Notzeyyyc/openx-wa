import { trackEvent, getAnalyticsEvents } from './database.js';

export function trackMessage(chatId, isGroup) {
    trackEvent('message_received', chatId, { isGroup });
}

export function trackAIResponse(chatId, responseTimeMs, model) {
    trackEvent('ai_response', chatId, { responseTimeMs, model });
}

export function trackCommand(chatId, command) {
    trackEvent('command_used', chatId, { command });
}

export function trackError(chatId, error) {
    trackEvent('error', chatId, { error: String(error) });
}

export function getStatsSummary() {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    
    const today = getAnalyticsEvents(now - day);
    const week = getAnalyticsEvents(now - 7 * day);
    
    const messages = today.filter(e => e.event === 'message_received').length;
    const aiCalls = today.filter(e => e.event === 'ai_response').length;
    const commands = today.filter(e => e.event === 'command_used').length;
    const errors = today.filter(e => e.event === 'error').length;
    
    const aiEvents = today.filter(e => e.event === 'ai_response');
    const avgResponseTime = aiEvents.length > 0
        ? aiEvents.reduce((sum, e) => sum + (JSON.parse(e.metadata || '{}').responseTimeMs || 0), 0) / aiEvents.length
        : 0;
    
    const commandCounts = {};
    today.filter(e => e.event === 'command_used').forEach(e => {
        const cmd = JSON.parse(e.metadata || '{}').command || 'unknown';
        commandCounts[cmd] = (commandCounts[cmd] || 0) + 1;
    });
    const topCommands = Object.entries(commandCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    
    const weekMessages = week.filter(e => e.event === 'message_received').length;
    const weekAiCalls = week.filter(e => e.event === 'ai_response').length;
    
    return {
        today: { messages, aiCalls, commands, errors, avgResponseTime: Math.round(avgResponseTime) },
        week: { messages: weekMessages, aiCalls: weekAiCalls },
        topCommands
    };
}
