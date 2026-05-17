import { Writable } from 'node:stream';
import type { MainStreams } from './cliTypes.ts';

/** Parse one or more pretty-printed JSON objects written to stdout. */
export function parseJsonOutputs(text: string): unknown[] {
  const results: unknown[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) {
        start = i;
      }
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        results.push(JSON.parse(text.slice(start, i + 1)));
        start = -1;
      }
    }
  }
  return results;
}

export type MakeStreamsOptions = {
  /** When true, stdout is treated as a TTY (human `run` output). */
  stdoutTty?: boolean | undefined;
};

export function makeStreams(options?: MakeStreamsOptions): {
  streams: MainStreams;
  out: () => string;
  err: () => string;
} {
  const outChunks: Buffer[] = [];
  const errChunks: Buffer[] = [];
  const stdout = new Writable({
    write(chunk, _enc, cb) {
      outChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      cb();
    },
  }) as NodeJS.WriteStream;
  const stderr = new Writable({
    write(chunk, _enc, cb) {
      errChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      cb();
    },
  }) as NodeJS.WriteStream;
  if (options?.stdoutTty === true) {
    stdout.isTTY = true;
  }
  return {
    streams: { stdout, stderr },
    out: () => Buffer.concat(outChunks).toString('utf8'),
    err: () => Buffer.concat(errChunks).toString('utf8'),
  };
}
