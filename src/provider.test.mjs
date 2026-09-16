import test from 'node:test';
import assert from 'node:assert';
import { buildChatUrl, buildModelsUrl, isAgentRouter, agentRouterHeaderOrder, CLIENT_HEADER_SETS } from './provider.js';

test('buildChatUrl: host root', () => {
    assert.equal(buildChatUrl('https://ai.sumopod.com'), 'https://ai.sumopod.com/v1/chat/completions');
});

test('buildChatUrl: host + /v1 (no double /v1)', () => {
    assert.equal(buildChatUrl('https://opencode.ai/zen/v1'), 'https://opencode.ai/zen/v1/chat/completions');
});

test('buildChatUrl: host + trailing slash', () => {
    assert.equal(buildChatUrl('https://openrouter.ai/api/'), 'https://openrouter.ai/api/v1/chat/completions');
});

test('buildChatUrl: openrouter-style /api/v1', () => {
    assert.equal(buildChatUrl('https://openrouter.ai/api/v1'), 'https://openrouter.ai/api/v1/chat/completions');
});

test('buildChatUrl: zen base without /v1', () => {
    assert.equal(buildChatUrl('https://opencode.ai/zen'), 'https://opencode.ai/zen/v1/chat/completions');
});

test('buildModelsUrl: opencode inference offset — chat base /inference/openai, models at /inference', () => {
    assert.equal(buildModelsUrl('https://opencode.ai/inference/openai'), 'https://opencode.ai/inference/v1/models');
});

test('buildModelsUrl: normal host root', () => {
    assert.equal(buildModelsUrl('https://ai.sumopod.com'), 'https://ai.sumopod.com/v1/models');
});

test('buildModelsUrl: groq /openai NOT stripped', () => {
    assert.equal(buildModelsUrl('https://api.groq.com/openai'), 'https://api.groq.com/openai/v1/models');
});

test('buildModelsUrl: opencode /inference (no /openai) idempotent', () => {
    assert.equal(buildModelsUrl('https://opencode.ai/inference'), 'https://opencode.ai/inference/v1/models');
});

test('isAgentRouter: matches agentrouter.org only', () => {
    assert.equal(isAgentRouter('https://agentrouter.org/v1'), true);
    assert.equal(isAgentRouter('https://agentrouter.org'), true);
    assert.equal(isAgentRouter('https://opencode.ai/inference/openai'), false);
    assert.equal(isAgentRouter('https://ai.sumopod.com'), false);
});

test('agentRouterHeaderOrder: codex first, roo fallback', () => {
    assert.deepEqual(agentRouterHeaderOrder().map(s => s.name), ['codex', 'roo']);
});

test('agentRouterHeaderOrder: last-good set moves to front', () => {
    assert.deepEqual(agentRouterHeaderOrder('roo').map(s => s.name), ['roo', 'codex']);
});

test('codex identity set carries required spoof headers', () => {
    const codex = CLIENT_HEADER_SETS.find(s => s.name === 'codex');
    assert.equal(codex.headers.Originator, 'codex_cli_rs');
    assert.match(codex.headers['User-Agent'], /codex_cli_rs/);
    assert.equal(codex.headers.Version, '0.101.0');
});
