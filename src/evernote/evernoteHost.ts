/**
 * Map `.env` EVERNOTE_HOST to Evernote JS SDK client options.
 * @see https://github.com/evernote/evernote-sdk-js/blob/master/lib/client.js
 */
export interface EvernoteClientOptionsFromHost {
  sandbox: boolean;
  china: boolean;
  serviceHost: string;
}

const DEFAULT_HOST = 'www.evernote.com';

export function evernoteClientOptionsFromHost(raw?: string): EvernoteClientOptionsFromHost {
  const host = (raw ?? DEFAULT_HOST)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '');
  if (host === 'app.yinxiang.com' || host.endsWith('.yinxiang.com')) {
    return { sandbox: false, china: true, serviceHost: 'app.yinxiang.com' };
  }
  if (host.includes('sandbox.evernote.com')) {
    return { sandbox: true, china: false, serviceHost: 'sandbox.evernote.com' };
  }
  if (host === 'www.evernote.com' || host === 'evernote.com' || host.endsWith('.evernote.com')) {
    return { sandbox: false, china: false, serviceHost: 'www.evernote.com' };
  }
  // Unknown host: still pass through for power users / future regions.
  return {
    sandbox: false,
    china: false,
    serviceHost: raw?.trim() ? raw.trim().replace(/^https?:\/\//, '') : DEFAULT_HOST,
  };
}
