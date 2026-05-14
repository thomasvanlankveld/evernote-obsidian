import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertLocalhostOAuthCallbackUrl } from './evernoteOAuthLogin.ts';

describe('evernoteOAuthLogin', () => {
  it('assertLocalhostOAuthCallbackUrl accepts default-style localhost http URL', () => {
    const u = assertLocalhostOAuthCallbackUrl('http://127.0.0.1:8765/callback');
    assert.equal(u.hostname, '127.0.0.1');
    assert.equal(u.port, '8765');
  });

  it('assertLocalhostOAuthCallbackUrl rejects https', () => {
    assert.throws(
      () => assertLocalhostOAuthCallbackUrl('https://127.0.0.1:8765/callback'),
      /http:/,
    );
  });

  it('assertLocalhostOAuthCallbackUrl rejects non-local hosts', () => {
    assert.throws(
      () => assertLocalhostOAuthCallbackUrl('http://evil.example/callback'),
      /localhost/,
    );
  });
});
