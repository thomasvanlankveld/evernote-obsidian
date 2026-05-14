import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { main } from './main.ts';

const here = dirname(fileURLToPath(import.meta.url));
const goldenMini = join(here, '..', 'vault', '__fixtures__', 'golden', 'rewrite-mini');

function makeStreams() {
  let out = '';
  let err = '';
  return {
    streams: {
      stdout: {
        write(s: string) {
          out += s;
        },
      },
      stderr: {
        write(s: string) {
          err += s;
        },
      },
    },
    out: () => out,
    err: () => err,
  };
}

describe('golden miniature vault (rewrite --out-dir)', () => {
  it('matches committed expected Markdown for unicode paths, punctuation, and percent-encoded shard URLs', async () => {
    const vaultRoot = join(goldenMini, 'vault');
    const mapPath = join(goldenMini, 'link-map.json');
    const expectedLinking = await readFile(join(goldenMini, 'expected', 'linking.md'), 'utf8');
    const tmp = await mkdtemp(join(tmpdir(), 'eo-golden-rewrite-'));
    const outVault = join(tmp, 'out');
    try {
      const { streams, out, err } = makeStreams();
      const code = await main(
        ['rewrite', '--vault', vaultRoot, '--map', mapPath, '--out-dir', outVault],
        streams,
        { cwd: tmp },
      );
      assert.equal(code, 0);
      assert.equal(err(), '');
      const summary = JSON.parse(out()) as { filesChanged: number; replacements: number };
      assert.equal(summary.filesChanged, 1);
      assert.equal(summary.replacements, 3);

      assert.equal(await readFile(join(outVault, 'linking.md'), 'utf8'), expectedLinking);

      await assert.rejects(
        () => access(join(outVault, 'target-café.md'), constants.F_OK),
        (e: NodeJS.ErrnoException) => e.code === 'ENOENT',
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
