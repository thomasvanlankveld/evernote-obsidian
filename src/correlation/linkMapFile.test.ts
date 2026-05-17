import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertLinkMapVaultRootMatches,
  buildLinkMapFile,
  LinkMapParseError,
  LinkMapVaultRootMismatchError,
  parseLinkMapJson,
} from './linkMapFile.ts';

describe('buildLinkMapFile', () => {
  it('lowercases guidToPath keys', () => {
    const file = buildLinkMapFile(
      '/vault',
      '/snap',
      new Map([['AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE', 'n.md']]),
    );
    assert.equal(file.guidToPath['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'], 'n.md');
  });

  it('includes truncatedTitleMatches when provided', () => {
    const file = buildLinkMapFile('/vault', '/snap', new Map([['g1', 'n.md']]), undefined, [
      {
        guid: 'g1',
        title: 'Full Title',
        normalizedTitle: 'full title extended',
        vaultNormalizedStem: 'full title',
        path: 'n.md',
      },
    ]);
    assert.equal(file.truncatedTitleMatches?.length, 1);
    assert.equal(file.truncatedTitleMatches?.[0]?.guid, 'g1');
  });
});

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

describe('assertLinkMapVaultRootMatches', () => {
  it('accepts matching resolved vault roots', () => {
    assert.doesNotThrow(() => assertLinkMapVaultRootMatches({ vaultRoot: '/vault/a' }, '/vault/a'));
  });

  it('throws when vault roots differ', () => {
    assert.throws(
      () => assertLinkMapVaultRootMatches({ vaultRoot: '/vault/a' }, '/vault/b'),
      LinkMapVaultRootMismatchError,
    );
  });

  it('throws when link map vaultRoot is empty', () => {
    assert.throws(
      () => assertLinkMapVaultRootMatches({ vaultRoot: '' }, '/vault'),
      LinkMapParseError,
    );
  });
});
