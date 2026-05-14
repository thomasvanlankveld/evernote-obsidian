import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LinkMapParseError, parseLinkMapJson } from './linkMapFile.ts';

describe('parseLinkMapJson', () => {
  it('parses a valid envelope and lowercases GUID keys', () => {
    const raw = JSON.stringify({
      version: 1,
      writtenAt: 't',
      vaultRoot: '/v',
      snapshotPath: '/s',
      guidToPath: { 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE': 'n.md' },
    });
    const m = parseLinkMapJson(raw);
    assert.equal(m.version, 1);
    assert.equal(m.guidToPath['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'], 'n.md');
  });

  it('throws on invalid JSON', () => {
    assert.throws(() => parseLinkMapJson('{'), LinkMapParseError);
  });

  it('throws on wrong version', () => {
    assert.throws(
      () => parseLinkMapJson(JSON.stringify({ version: 2, guidToPath: {} })),
      LinkMapParseError,
    );
  });

  it('throws when guidToPath value is not a string', () => {
    assert.throws(
      () => parseLinkMapJson(JSON.stringify({ version: 1, guidToPath: { a: 1 } })),
      LinkMapParseError,
    );
  });
});
