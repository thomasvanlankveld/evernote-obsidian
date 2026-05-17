import assert from 'node:assert/strict';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  correlateSnapshotToGuidPaths,
  vaultIndexResultToCorrelationInput,
} from '../correlation/correlate.ts';
import type { NoteRecord } from '../evernote/noteRecord.ts';
import {
  buildVaultIndex,
  normalizeTitle,
  parseFrontmatterEvernoteGuid,
  parseFrontmatterTitle,
  VaultIndexRootError,
} from './vaultIndex.ts';

const here = dirname(fileURLToPath(import.meta.url));

describe('normalizeTitle', () => {
  it('trims, lowercases, NFC, and collapses whitespace', () => {
    assert.equal(normalizeTitle('  Hello \t World  '), 'hello world');
    const nfdCoffee = `caf\u0065\u0301`; // e + combining acute
    assert.equal(normalizeTitle(nfdCoffee), normalizeTitle('caf\u00E9'));
  });

  it('lowercases unicode letters beyond ASCII', () => {
    assert.equal(normalizeTitle('Straße'), 'straße');
  });

  it('returns empty when the title is only whitespace', () => {
    assert.equal(normalizeTitle('   \t  '), '');
  });

  it('sanitizes Obsidian Importer filename characters before NFC and case fold', () => {
    assert.equal(normalizeTitle('Coming Down to Earth: What if…'), 'coming down to earth what if…');
    assert.equal(
      normalizeTitle('Everybody Loves Zombies | Running The Game - YouTube'),
      'everybody loves zombies running the game - youtube',
    );
    assert.equal(
      normalizeTitle('Lydian & Mixolydian Scales / Modes'),
      'lydian & mixolydian scales - modes',
    );
    assert.equal(
      normalizeTitle('LMoPh: Leeuwenschild Koster (…)'),
      'lmoph leeuwenschild koster (…)',
    );
  });
});

describe('parseFrontmatterTitle', () => {
  it('returns undefined when there is no frontmatter', () => {
    assert.equal(parseFrontmatterTitle('# Hi\n'), undefined);
  });

  it('reads title from a standard block', () => {
    assert.equal(parseFrontmatterTitle('---\ntitle: My Title\n---\n\n'), 'My Title');
  });

  it('strips optional quotes', () => {
    assert.equal(parseFrontmatterTitle("---\ntitle: 'X'\n---\n"), 'X');
    assert.equal(parseFrontmatterTitle('---\ntitle: "Y"\n---\n'), 'Y');
  });
});

describe('parseFrontmatterEvernoteGuid', () => {
  it('returns undefined when there is no frontmatter', () => {
    assert.equal(parseFrontmatterEvernoteGuid('# Hi\n'), undefined);
  });

  it('reads evernote-guid and normalizes to lowercase', () => {
    const body = '---\nevernote-guid: AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE\n---\n\n';
    assert.equal(parseFrontmatterEvernoteGuid(body), 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('strips optional quotes', () => {
    assert.equal(
      parseFrontmatterEvernoteGuid("---\nevernote-guid: 'g1-g2-g3-g4-g5'\n---\n"),
      'g1-g2-g3-g4-g5',
    );
  });
});

describe('buildVaultIndex', () => {
  it('indexes Importer-sanitized filename stems for title correlation', async () => {
    const root = join(here, '__fixtures__', 'importer-titles');
    const r = await buildVaultIndex(root);
    assert.equal(r.ok, true);
    if (!r.ok) {
      return;
    }
    assert.equal(
      r.byNormalizedTitle.get('coming down to earth what if…'),
      'Coming Down to Earth What if….md',
    );
    assert.equal(
      r.byNormalizedTitle.get('lydian & mixolydian scales - modes'),
      'Lydian & Mixolydian Scales - Modes.md',
    );

    const notes: NoteRecord[] = [
      {
        guid: 'g-colon',
        title: 'Coming Down to Earth: What if…',
        updated: '1970-01-01T00:00:00.000Z',
      },
      {
        guid: 'g-slash',
        title: 'Lydian & Mixolydian Scales / Modes',
        updated: '1970-01-01T00:00:00.000Z',
      },
    ];
    const pathToEvernoteGuid = new Map<string, string>();
    for (const e of r.entries) {
      if (e.evernoteGuid !== undefined) {
        pathToEvernoteGuid.set(e.path, e.evernoteGuid);
      }
    }
    const vault = vaultIndexResultToCorrelationInput(
      r.byNormalizedTitle,
      r.entries.map((e) => e.path),
      r.byEvernoteGuid,
      pathToEvernoteGuid,
    );
    const correlated = correlateSnapshotToGuidPaths(notes, vault);
    assert.equal(correlated.ok, true);
    if (correlated.ok) {
      assert.equal(correlated.guidToPath.get('g-colon'), 'Coming Down to Earth What if….md');
      assert.equal(correlated.guidToPath.get('g-slash'), 'Lydian & Mixolydian Scales - Modes.md');
    }
  });

  it('indexes a vault with unique normalized titles', async () => {
    const root = join(here, '__fixtures__', 'unique');
    const r = await buildVaultIndex(root);
    assert.equal(r.ok, true);
    if (!r.ok) {
      return;
    }
    assert.equal(r.byNormalizedTitle.get('first'), 'first.md');
    assert.equal(r.byNormalizedTitle.get('second note'), 'sub/second note.md');
    assert.equal(r.byNormalizedTitle.get('quoted title'), 'third.md');
  });

  it('indexes evernote-guid from frontmatter', async () => {
    const root = join(here, '__fixtures__', 'temp-guid-index');
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, 'tagged.md'),
      '---\ntitle: Renamed in vault\nevernote-guid: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\n---\n\n',
      'utf8',
    );

    try {
      const r = await buildVaultIndex(root);
      assert.equal(r.ok, true);
      if (!r.ok) {
        return;
      }
      assert.equal(r.byEvernoteGuid.get('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'), 'tagged.md');
      assert.equal(r.entries[0]?.evernoteGuid, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails when two files claim the same evernote-guid', async () => {
    const root = join(here, '__fixtures__', 'temp-guid-collision');
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
    const guid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    await writeFile(join(root, 'a.md'), `---\nevernote-guid: ${guid}\n---\n\n`, 'utf8');
    await writeFile(join(root, 'b.md'), `---\nevernote-guid: ${guid}\n---\n\n`, 'utf8');

    try {
      const r = await buildVaultIndex(root);
      assert.equal(r.ok, false);
      if (r.ok) {
        return;
      }
      assert.equal(r.guidCollisions.length, 1);
      assert.deepEqual(r.guidCollisions[0]?.paths.sort(), ['a.md', 'b.md']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails with a sorted collision report when titles collide', async () => {
    const root = join(here, '__fixtures__', 'collision');
    const r = await buildVaultIndex(root);
    assert.equal(r.ok, false);
    if (r.ok) {
      return;
    }
    assert.deepEqual(r.collisions, [
      {
        normalizedTitle: 'shared',
        paths: ['a.md', 'b.md'],
      },
    ]);
  });

  it('rejects a missing vault root', async () => {
    const root = join(here, '__fixtures__', 'nonexistent-vault');
    await assert.rejects(
      () => buildVaultIndex(root),
      (e: unknown) => e instanceof VaultIndexRootError,
    );
  });

  it('fails when a note has an empty normalized title', async () => {
    const root = join(here, '__fixtures__', 'temp-empty-title');
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
    await writeFile(join(root, ' .md'), '# body\n', 'utf8');

    try {
      const r = await buildVaultIndex(root);
      assert.equal(r.ok, false);
      if (r.ok) {
        return;
      }
      assert.deepEqual(r.collisions, [{ normalizedTitle: '', paths: [' .md'] }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('buildVaultIndex temp dir', () => {
  it('skips .git, node_modules, .obsidian, and .trash when walking', async () => {
    const root = join(here, '__fixtures__', 'temp-skip');
    await rm(root, { recursive: true, force: true });
    await mkdir(join(root, '.git'), { recursive: true });
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(join(root, '.obsidian'), { recursive: true });
    await mkdir(join(root, '.trash'), { recursive: true });
    await writeFile(join(root, '.git', 'tracked.md'), '# x\n', 'utf8');
    await writeFile(join(root, 'node_modules', 'pkg', 'readme.md'), '# x\n', 'utf8');
    await writeFile(join(root, '.obsidian', 'note.md'), '# x\n', 'utf8');
    await writeFile(join(root, '.trash', 'deleted.md'), '# x\n', 'utf8');
    await writeFile(join(root, 'visible.md'), '# Visible\n', 'utf8');

    try {
      const r = await buildVaultIndex(root);
      assert.equal(r.ok, true);
      if (!r.ok) {
        return;
      }
      assert.equal(r.entries.length, 1);
      assert.equal(r.entries[0]?.path, 'visible.md');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not recurse into symlinked directories', async (t) => {
    if (process.platform === 'win32') {
      t.skip('directory symlinks differ on Windows without dev mode');
      return;
    }
    const vault = join(here, '__fixtures__', 'temp-symlink-dir');
    const outside = join(here, '__fixtures__', 'temp-symlink-target');
    await rm(vault, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
    await mkdir(join(outside, 'sub'), { recursive: true });
    await writeFile(join(outside, 'sub', 'only-here.md'), '#\n', 'utf8');
    await mkdir(vault, { recursive: true });
    await symlink(join(outside, 'sub'), join(vault, 'link'), 'dir');

    try {
      const r = await buildVaultIndex(vault);
      assert.equal(r.ok, true);
      if (!r.ok) {
        return;
      }
      assert.equal(r.entries.length, 0);
    } finally {
      await rm(vault, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
