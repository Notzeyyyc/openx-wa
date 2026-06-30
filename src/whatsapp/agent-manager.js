import { chatCompletion } from '../ai-provider.js';
import { log as logFn, error as logError } from '../logger.js';

// Active agents
const activeAgents = new Map();

// Agent types
const AGENT_TYPES = {
    research: {
        name: 'Research Agent',
        icon: '🔍',
        systemPrompt: `You are a research agent. Your job is to thoroughly research a topic and compile a comprehensive answer.
Use web search if available. Provide citations. Be thorough but concise.
Format your response with clear sections and bullet points.`
    },
    code: {
        name: 'Code Agent',
        icon: '💻',
        systemPrompt: `You are a coding agent. Write clean, efficient code.
Explain your approach briefly. Provide working code with examples.
Focus on practical solutions.`
    },
    translate: {
        name: 'Translate Agent',
        icon: '🌐',
        systemPrompt: `You are a translation agent. Translate text accurately between languages.
Preserve meaning, tone, and context. If ambiguous, provide multiple translations.`
    },
    summary: {
        name: 'Summary Agent',
        icon: '📝',
        systemPrompt: `You are a summary agent. Condense long texts into clear, concise summaries.
Keep key points. Remove fluff. Use bullet points for clarity.`
    }
};

/**
 * Spawn a new agent task
 */
export function spawnAgent(type, task, from, waSock) {
    const agentType = AGENT_TYPES[type] || AGENT_TYPES.research;
    const id = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const agent = {
        id,
        type,
        name: agentType.name,
        icon: agentType.icon,
        task,
        from,
        status: 'running',
        startedAt: Date.now(),
        result: null,
        error: null
    };

    activeAgents.set(id, agent);

    // Notify user
    if (waSock) {
        waSock.sendMessage(from, {
            text: `${agentType.icon} *${agentType.name}* started\nTask: ${task}\nID: ${id}`
        }).catch(() => {});
    }

    // Run agent in background
    runAgent(agent, agentType, waSock).catch(err => {
        agent.status = 'failed';
        agent.error = err.message;
        logError(`Agent ${id} failed:`, err);
    });

    return id;
}

/**
 * Run agent with AI
 */
async function runAgent(agent, agentType, waSock) {
    const startTime = Date.now();

    try {
        const messages = [
            { role: 'system', content: agentType.systemPrompt },
            { role: 'user', content: agent.task }
        ];

        logFn(`[${agent.name}] Running: ${agent.task.slice(0, 50)}...`);

        const result = await chatCompletion(messages, null, true);
        agent.result = result;
        agent.status = 'completed';
        agent.finishedAt = Date.now();

        const duration = ((agent.finishedAt - agent.startedAt) / 1000).toFixed(1);
        logFn(`[${agent.name}] Completed in ${duration}s`);

        // Send result to user
        if (waSock && agent.from) {
            const header = `${agent.icon} *${agent.name}* — Done (${duration}s)\n\n`;
            await waSock.sendMessage(agent.from, {
                text: header + (result || 'No result')
            }).catch(() => {});
        }
    } catch (err) {
        agent.status = 'failed';
        agent.error = err.message;
        agent.finishedAt = Date.now();

        if (waSock && agent.from) {
            await waSock.sendMessage(agent.from, {
                text: `${agent.icon} *${agent.name}* — Failed\nError: ${err.message}`
            }).catch(() => {});
        }
    }
}

/**
 * Get agent status
 */
export function getAgent(id) {
    return activeAgents.get(id) || null;
}

/**
 * List all agents
 */
export function listAgents() {
    return Array.from(activeAgents.values())
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, 20);
}

/**
 * Get agent status text
 */
export function getAgentsStatus() {
    const agents = listAgents();
    if (agents.length === 0) return 'No agents running.';

    return agents.map(a => {
        const duration = a.finishedAt
            ? `${((a.finishedAt - a.startedAt) / 1000).toFixed(1)}s`
            : `${((Date.now() - a.startedAt) / 1000).toFixed(0)}s`;

        const statusIcon = {
            running: '⏳',
            completed: '✅',
            failed: '❌'
        }[a.status] || '❓';

        return `${statusIcon} ${a.icon} ${a.id} — ${a.status} (${duration})`;
    }).join('\n');
}

export { AGENT_TYPES };
