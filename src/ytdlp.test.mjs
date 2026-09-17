import test from 'node:test';
import assert from 'node:assert';
import { releaseAsset, pickFormat, isHttpUrl } from './ytdlp.js';

test('releaseAsset: platform/arch mapping (no python)', () => {
    assert.equal(releaseAsset('linux', 'x64'), 'yt-dlp_linux');
    assert.equal(releaseAsset('linux', 'arm64'), 'yt-dlp_linux_aarch64');
    assert.equal(releaseAsset('darwin', 'arm64'), 'yt-dlp_macos');
    assert.equal(releaseAsset('win32', 'x64'), 'yt-dlp.exe');
    assert.equal(releaseAsset('linux', 'arm'), null);
});

test('pickFormat: single-file selectors', () => {
    assert.match(pickFormat('audio'), /bestaudio/);
    assert.match(pickFormat('video'), /height<=720/);
    assert.match(pickFormat(), /height<=720/);
});

test('isHttpUrl: only http(s)', () => {
    assert.equal(isHttpUrl('https://youtu.be/abc'), true);
    assert.equal(isHttpUrl('http://example.com'), true);
    assert.equal(isHttpUrl('ftp://example.com'), false);
    assert.equal(isHttpUrl('file:///etc/passwd'), false);
    assert.equal(isHttpUrl('bukan url'), false);
});
