import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyPathFlag, applyPositiveIntFlag, unknownSubcommandFlagError } from './cliFlags.ts';

describe('cliFlags', () => {
  it('formats unknown subcommand flag errors', () => {
    assert.equal(unknownSubcommandFlagError('index', 'typo'), 'error: unknown index flag: typo');
  });

  it('applyPathFlag parses spaced and equals forms', () => {
    const spaced = applyPathFlag('--out', ['--out', './x.json'], 0, '/cwd', 'out', './out/x.json');
    assert.equal(spaced.kind, 'handled');
    if (spaced.kind === 'handled') {
      assert.equal(spaced.path, '/cwd/x.json');
      assert.equal(spaced.nextIndex, 1);
    }
    const eq = applyPathFlag('--out=./y.json', ['--out=./y.json'], 0, '/cwd', 'out');
    assert.equal(eq.kind, 'handled');
    if (eq.kind === 'handled') {
      assert.equal(eq.path, '/cwd/y.json');
    }
  });

  it('applyPathFlag errors on missing path value', () => {
    const r = applyPathFlag('--db', ['--db'], 0, '/cwd', 'db', './en.db');
    assert.equal(r.kind, 'error');
  });

  it('applyPositiveIntFlag rejects non-positive values', () => {
    const r = applyPositiveIntFlag('--max-notes', ['--max-notes', '0'], 0, 'max-notes');
    assert.equal(r.kind, 'error');
  });
});
