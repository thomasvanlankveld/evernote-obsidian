import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCorrelationOverridesJson } from './overridesFile.ts';

describe('parseCorrelationOverridesJson', () => {
  it('parses version 1 with byGuid', () => {
    const m = parseCorrelationOverridesJson(
      JSON.stringify({
        version: 1,
        byGuid: { g1: 'notes/a.md', g2: 'b\\c.md' },
      }),
    );
    assert.equal(m.get('g1'), 'notes/a.md');
    assert.equal(m.get('g2'), 'b/c.md');
  });

  it('allows omitting byGuid', () => {
    const m = parseCorrelationOverridesJson(JSON.stringify({ version: 1 }));
    assert.equal(m.size, 0);
  });

  it('throws on bad version', () => {
    assert.throws(() => parseCorrelationOverridesJson(JSON.stringify({ version: 2 })), /version/);
  });

  it('lowercases byGuid keys', () => {
    const m = parseCorrelationOverridesJson(
      JSON.stringify({
        version: 1,
        byGuid: { 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE': 'n.md' },
      }),
    );
    assert.equal(m.get('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'), 'n.md');
  });

  it('throws when byGuid value is not a string', () => {
    assert.throws(
      () => parseCorrelationOverridesJson(JSON.stringify({ version: 1, byGuid: { g: 1 } })),
      /string path/,
    );
  });
});
