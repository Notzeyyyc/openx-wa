import test from 'node:test';
import assert from 'node:assert';
import { modelFamily, groupByFamily } from './models.js';

test('modelFamily: known prefixes', () => {
    assert.equal(modelFamily('claude-opus-5'), 'Anthropic');
    assert.equal(modelFamily('gpt-5.4-mini'), 'OpenAI');
    assert.equal(modelFamily('gpt-5.3-codex'), 'OpenAI');
    assert.equal(modelFamily('gemini-3.8-flash'), 'Google');
    assert.equal(modelFamily('deepseek-v4-flash'), 'DeepSeek');
    assert.equal(modelFamily('glm-5.3-flash'), 'Z.ai');
    assert.equal(modelFamily('kimi-k3'), 'Moonshot');
    assert.equal(modelFamily('minimax-m3'), 'MiniMax');
    assert.equal(modelFamily('grok-4.6'), 'xAI');
    assert.equal(modelFamily('qwen3.5-plus'), 'Alibaba');
    assert.equal(modelFamily('nemotron-3-ultra-free'), 'NVIDIA');
    assert.equal(modelFamily('muse-spark-1.3'), 'Meta');
    assert.equal(modelFamily('big-pickle'), 'Stealth');
    assert.equal(modelFamily('unknown-model'), 'Other');
});

test('groupByFamily: groups correctly', () => {
    const ids = ['claude-opus-5', 'gpt-5', 'claude-sonnet-5', 'deepseek-v4-flash'];
    const groups = groupByFamily(ids);
    assert.deepEqual(groups.Anthropic, ['claude-opus-5', 'claude-sonnet-5']);
    assert.deepEqual(groups.OpenAI, ['gpt-5']);
    assert.deepEqual(groups.DeepSeek, ['deepseek-v4-flash']);
    assert.equal(Object.keys(groups).length, 3);
});
