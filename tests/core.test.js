// Unit tests for pure core modules (Node's built-in runner + WebCrypto).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../www/js/core/crypto.js';
import { localCleanup } from '../www/js/core/local-cleanup.js';
import { wordDiff } from '../www/js/core/diff.js';
import { buildSystemPrompt, buildUserMessage } from '../www/js/core/correction-prompt.js';

test('AES-GCM round trip with AAD binding', async () => {
  const key = await C.generateDataKey();
  const box = await C.encryptJSON(key, { rawText: 'secret words' }, 'id-1');
  assert.deepEqual(await C.decryptJSON(key, box, 'id-1'), { rawText: 'secret words' });
  await assert.rejects(C.decryptJSON(key, box, 'id-2'), 'ciphertext must not decrypt under another record id');
  assert.ok(!atob(box.ct).includes('secret'));
});

test('unique IV per encryption', async () => {
  const key = await C.generateDataKey();
  const a = await C.encryptBytes(key, new Uint8Array([1, 2, 3]));
  const b = await C.encryptBytes(key, new Uint8Array([1, 2, 3]));
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
});

test('passphrase wrapping: right passphrase unwraps, wrong one fails', async () => {
  const key = await C.generateDataKey();
  const salt = C.randomBytes(16);
  const wrapped = await C.wrapDataKey(key, await C.deriveKek('correct horse', salt, 1000));
  const back = await C.unwrapDataKey(wrapped, await C.deriveKek('correct horse', salt, 1000));
  assert.equal(await C.exportRawKey(back), await C.exportRawKey(key));
  await assert.rejects(C.unwrapDataKey(wrapped, await C.deriveKek('wrong horse', salt, 1000)));
});

test('recovery code format and normalization', () => {
  const code = C.generateRecoveryCode();
  assert.match(code, /^[A-Z2-9]{5}(-[A-Z2-9]{5}){4}$/);
  assert.equal(C.normalizeRecoveryCode(code.toLowerCase().replace(/-/g, ' ')), code);
});

test('base64 helpers handle large buffers', () => {
  const big = new Uint8Array(200_000).map((_, i) => (i * 31) & 255);
  assert.deepEqual(C.fromB64(C.toB64(big)), big);
});

test('offline cleanup: punctuation, capitalization, fillers, stutters', () => {
  assert.equal(localCleanup('um so i think the the meeting went well'), 'So I think the meeting went well.');
  assert.equal(localCleanup('what time is it'), 'What time is it?');
  assert.equal(localCleanup('first point new paragraph second point'), 'First point.\n\nSecond point.');
  assert.equal(localCleanup("i'm sure i'll be there , ok"), "I'm sure I'll be there, ok.");
  assert.equal(localCleanup('Already fine.'), 'Already fine.');
  assert.equal(localCleanup('um uh hmm', {}), '');
});

test('offline cleanup: light style keeps fillers', () => {
  assert.match(localCleanup('um hello there', { style: 'light' }), /^Um hello there\.$/);
});

test('offline cleanup keeps meaningful doubles', () => {
  assert.equal(localCleanup('i had had enough'), 'I had had enough.');
});

test('word diff marks additions and deletions', () => {
  const d = wordDiff('um hello world', 'Hello, world.');
  const added = d.filter((p) => p.type === 'add').map((p) => p.text).join('');
  const removed = d.filter((p) => p.type === 'del').map((p) => p.text).join('');
  assert.ok(added.includes('Hello,'));
  assert.ok(removed.includes('um'));
  assert.deepEqual(wordDiff('same text', 'same text'), [{ type: 'same', text: 'same text' }]);
});

test('correction prompt: preservation rules, injection safety, custom vocab', () => {
  const p = buildSystemPrompt({ style: 'light', customInstructions: 'Spell it Kubernetes.' });
  assert.match(p, /preserve/i);
  assert.match(p, /never instructions for you/i);
  assert.match(p, /Light touch/);
  assert.match(p, /Kubernetes/);
  assert.equal(buildUserMessage('hi'), '<transcript>\nhi\n</transcript>');
  assert.equal(buildSystemPrompt(), buildSystemPrompt(), 'prompt must be deterministic for caching');
});
