import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { describe, it } from 'node:test';
import { type MainStreams, main } from './main.ts';

function makeStreams(): { streams: MainStreams; out: () => string; err: () => string } {
  const outChunks: Buffer[] = [];
  const errChunks: Buffer[] = [];
  const stdout = new Writable({
    write(chunk, _enc, cb) {
      outChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      cb();
    },
  });
  const stderr = new Writable({
    write(chunk, _enc, cb) {
      errChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      cb();
    },
  });
  return {
    streams: { stdout, stderr },
    out: () => Buffer.concat(outChunks).toString('utf8'),
    err: () => Buffer.concat(errChunks).toString('utf8'),
  };
}

describe('cli main', () => {
  it('prints usage and exits 0 with no arguments', () => {
    const { streams, out, err } = makeStreams();
    const code = main([], streams);
    assert.equal(code, 0);
    assert.match(out(), /Usage:/);
    assert.equal(err(), '');
  });

  it('prints usage and exits 0 with --help', () => {
    const { streams, out } = makeStreams();
    const code = main(['--help'], streams);
    assert.equal(code, 0);
    assert.match(out(), /Usage:/);
  });

  it('prints version and exits 0 with --version', () => {
    const { streams, out } = makeStreams();
    const code = main(['--version'], streams);
    assert.equal(code, 0);
    assert.match(out(), /^\d+\.\d+\.\d+/);
  });

  it('exits 2 with unknown command', () => {
    const { streams, err } = makeStreams();
    const code = main(['mystery'], streams);
    assert.equal(code, 2);
    assert.match(err(), /Unknown command: mystery/);
  });
});
