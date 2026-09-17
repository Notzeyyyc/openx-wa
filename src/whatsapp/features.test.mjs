import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dataFiles = ['quiz-scores.json', 'absen.json'].map(f => path.join(ROOT, 'data', f));
const backups = dataFiles.map(f => ({ f, content: fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : null }));

const { buildPollPayload } = await import('./poll.js');
const quiz = await import('./quiz.js');
const absen = await import('./absen.js');
const { extractReadableText } = await import('./helpers.js');

test.after(() => {
    for (const { f, content } of backups) {
        if (content === null) { try { fs.unlinkSync(f); } catch {} }
        else fs.writeFileSync(f, content);
    }
});

test('buildPollPayload: usage, valid, and limits', () => {
    assert.equal(buildPollPayload('cuma satu').ok, false);
    assert.equal(buildPollPayload('Q | a').ok, false);

    const ok = buildPollPayload('Q | a | b');
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.poll.values, ['a', 'b']);
    assert.equal(ok.poll.selectableCount, 1);

    assert.equal(buildPollPayload('x'.repeat(256) + ' | a | b').error, 'name_too_long');
    assert.equal(buildPollPayload('Q | ' + Array.from({ length: 13 }, (_, i) => 'o' + i).join(' | ')).error, 'too_many_options');
    assert.equal(buildPollPayload('Q | a | ' + 'x'.repeat(101)).error, 'option_too_long');
});

test('parseQuizResponse: fenced JSON, letter answer, invalid skipped', () => {
    const text = '```json\n[{"q":"1+1?","options":["1","2","3"],"answer":"B"},{"q":"bad","options":["x"],"answer":5}]\n```';
    const qs = quiz.parseQuizResponse(text);
    assert.equal(qs.length, 1);
    assert.equal(qs[0].answer, 1);
    assert.equal(quiz.parseQuizResponse('no json here'), null);
});

test('parseAnswer + gradeAnswer', () => {
    assert.equal(quiz.parseAnswer('A', 4), 0);
    assert.equal(quiz.parseAnswer('c', 4), 2);
    assert.equal(quiz.parseAnswer('3', 4), 2);
    assert.equal(quiz.parseAnswer('9', 4), -1);
    assert.equal(quiz.gradeAnswer({ answer: 2 }, 2), true);
    assert.equal(quiz.gradeAnswer({ answer: 2 }, 1), false);
});

test('quiz session: flow + score', () => {
    const chat = 'test-chat';
    quiz.startQuiz(chat, [
        { q: 'q1', options: ['a', 'b'], answer: 0 },
        { q: 'q2', options: ['a', 'b'], answer: 1 }
    ]);
    assert.equal(quiz.currentQuestion(chat).q, 'q1');

    let r = quiz.submitAnswer(chat, 0);
    assert.equal(r.correct, true);
    assert.equal(r.done, false);
    assert.equal(quiz.currentQuestion(chat).q, 'q2');

    r = quiz.submitAnswer(chat, 0);
    assert.equal(r.correct, false);
    assert.equal(r.done, true);
    assert.equal(r.score, 1);
    assert.equal(quiz.currentQuestion(chat), null);
    quiz.clearSession(chat);
});

test('absen: open/mark/close/format', () => {
    const g = 'test@g.us';
    absen.openSession(g, 'Rapat', 'owner');
    assert.equal(absen.markPresent(g, 'a@s', 'Ana').count, 1);
    assert.equal(absen.markPresent(g, 'a@s', 'Ana').already, true);
    assert.equal(absen.markPresent(g, 'b@s', 'Budi').count, 2);
    assert.match(absen.formatHadir(absen.getSession(g)), /Ana/);

    const rec = absen.closeSession(g);
    assert.equal(rec.hadir.length, 2);
    assert.equal(absen.getSession(g), null);
});

test('extractReadableText: strips tags/scripts/entities', () => {
    const html = '<html><head><style>p{}</style><script>bad()</script></head><body><h1>Judul</h1><p>Halo &amp; dunia</p></body></html>';
    const text = extractReadableText(html);
    assert.match(text, /Judul/);
    assert.match(text, /Halo & dunia/);
    assert.doesNotMatch(text, /bad\(\)/);
    assert.doesNotMatch(text, /<p>/);
});
