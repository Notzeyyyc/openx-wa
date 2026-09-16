import test from 'node:test';
import assert from 'node:assert';
import { buildChatUrl } from './provider.js';

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
