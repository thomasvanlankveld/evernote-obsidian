import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evernoteClientOptionsFromHost } from './evernoteHost.ts';

describe('evernoteClientOptionsFromHost', () => {
  it('defaults to production www', () => {
    const o = evernoteClientOptionsFromHost(undefined);
    assert.equal(o.sandbox, false);
    assert.equal(o.china, false);
    assert.equal(o.serviceHost, 'www.evernote.com');
  });

  it('detects sandbox host', () => {
    const o = evernoteClientOptionsFromHost('sandbox.evernote.com');
    assert.equal(o.sandbox, true);
    assert.equal(o.china, false);
    assert.equal(o.serviceHost, 'sandbox.evernote.com');
  });

  it('detects Yinxiang (China)', () => {
    const o = evernoteClientOptionsFromHost('app.yinxiang.com');
    assert.equal(o.sandbox, false);
    assert.equal(o.china, true);
    assert.equal(o.serviceHost, 'app.yinxiang.com');
  });

  it('strips https prefix', () => {
    const o = evernoteClientOptionsFromHost('https://www.evernote.com');
    assert.equal(o.serviceHost, 'www.evernote.com');
  });
});
