import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadDotEnvFromCwd } from './loadDotEnv.ts';

const cliDir = dirname(fileURLToPath(import.meta.url));
const tmpRoot = join(cliDir, '.tmp-dotenv-test');

describe('loadDotEnvFromCwd', () => {
  before(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
    await mkdir(tmpRoot, { recursive: true });
  });

  after(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('loads KEY=VALUE into process.env when unset', async () => {
    const prev = process.env.EVERNOTE_TEST_KEY_PHASE3;
    delete process.env.EVERNOTE_TEST_KEY_PHASE3;
    await writeFile(join(tmpRoot, '.env'), 'EVERNOTE_TEST_KEY_PHASE3=from-file\n', 'utf8');
    await loadDotEnvFromCwd(tmpRoot);
    assert.equal(process.env.EVERNOTE_TEST_KEY_PHASE3, 'from-file');
    if (prev === undefined) {
      delete process.env.EVERNOTE_TEST_KEY_PHASE3;
    } else {
      process.env.EVERNOTE_TEST_KEY_PHASE3 = prev;
    }
  });

  it('does not override existing env', async () => {
    process.env.EVERNOTE_TEST_KEY_PHASE3_B = 'preset';
    await writeFile(join(tmpRoot, '.env'), 'EVERNOTE_TEST_KEY_PHASE3_B=from-file\n', 'utf8');
    await loadDotEnvFromCwd(tmpRoot);
    assert.equal(process.env.EVERNOTE_TEST_KEY_PHASE3_B, 'preset');
    delete process.env.EVERNOTE_TEST_KEY_PHASE3_B;
  });
});
