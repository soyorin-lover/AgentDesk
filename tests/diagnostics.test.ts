import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnostic } from '../src/codex/diagnostics.ts';
test('diagnostic retains only known error categories and safe protocol status', () => {
  assert.deepEqual(diagnostic('error', { error: { message: 'websocket failed: error sending request to https://private.invalid/secret?token=SECRET', codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 403 } } } }), { method: 'error', kind: 'network-or-upstream', transport: 'websocket', errorCode: 'httpConnectionFailed', httpStatusCode: 403 });
  assert.equal(JSON.stringify(diagnostic('error', { message: 'SECRET username password /private/path' })).includes('SECRET'), false);
});
