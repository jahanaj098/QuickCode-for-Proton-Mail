// Browser-only send orchestration check. All Proton requests are synthetic.
import { chromium } from 'playwright';
import * as pgp from 'openpgp';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const sender = await pgp.generateKey({ type: 'ecc', curve: 'curve25519Legacy', userIDs: [{ email: 'sender@example.test' }], passphrase: 'derived-fixture' });
const recipient = await pgp.generateKey({ type: 'ecc', curve: 'curve25519Legacy', userIDs: [{ email: 'recipient@example.test' }] });
const extension = path.resolve('dist/chrome'), profile = await fs.mkdtemp(path.resolve('artifacts/send-test-'));
const context = await chromium.launchPersistentContext(profile, { channel: 'msedge', headless: true,
  args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension] });
let submitted;
try {
  await context.route('https://mail.proton.me/api/**', async route => {
    const url = route.request().url(); let body;
    if (url.endsWith('/core/v4/users')) body = { User: { ID: 'user', Name: 'Sender', Keys: [{ ID: 'user-key', Primary: 1, PrivateKey: sender.privateKey }] } };
    else if (url.endsWith('/core/v4/addresses')) body = { Addresses: [{ ID: 'address', Email: 'sender@example.test', Status: 1, Keys: [{ ID: 'address-key', Primary: 1, PrivateKey: sender.privateKey }] }] };
    else if (url.includes('/core/v4/keys/all?')) body = { Address: { Keys: [{ PublicKey: recipient.publicKey }] } };
    else if (url.endsWith('/mail/v4/messages') && route.request().method() === 'POST') body = { Message: { ID: 'draft' } };
    else if (url.endsWith('/mail/v4/messages/draft')) { submitted = route.request().postDataJSON(); body = { Sent: { ID: 'sent' } }; }
    else if (url.endsWith('/messages/count')) body = { Counts: [{ LabelID: '0', Unread: 0 }] };
    else if (url.includes('/messages?')) body = { Messages: [] };
    else throw Error('Unexpected synthetic API route: ' + url);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ Code: 1000, ...body }) });
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {
    for (let i = 0; i < 50; i++) { if ((await chrome.action.getTitle({})).includes('unread inbox')) break; await new Promise(r => setTimeout(r, 100)); }
    await chrome.storage.session.set({ sessions: [{ id: 'fixture', username: 'sender@example.test', uid: 'synthetic', access: 'synthetic', refresh: 'synthetic', phase: 'ready', keyPassword: 'derived-fixture', remember: false, label: 'Sender', color: '#177668' }], checkedAt: Date.now(), unreadCounts: { fixture: 0 }, seeded: ['fixture'] });
  });
  const page = await context.newPage(); const cdp = await context.newCDPSession(page); await cdp.send('ServiceWorker.enable'); await cdp.send('ServiceWorker.stopAllWorkers');
  await page.goto(new URL('clipboard.html', worker.url()).href);
  const result = await page.evaluate(async () => chrome.runtime.sendMessage({ quickcode: 1, operation: 'send', data: {
    accountId: 'fixture', confirmed: true, requestId: 'synthetic-send', message: { accountId: 'fixture', from: 'sender@example.test', to: 'recipient@example.test', cc: '', bcc: '', subject: 'Synthetic send', html: '<p>Browser send fixture</p>', files: [] },
  } }));
  assert.equal(result.ok, true, result.error); assert.ok(submitted?.Packages?.length);
  const pkg = submitted.Packages[0], packet = pkg.Addresses['recipient@example.test'].BodyKeyPacket;
  const data = new Uint8Array(Buffer.concat([Buffer.from(packet, 'base64'), Buffer.from(pkg.Body, 'base64')]));
  const decrypted = await pgp.decrypt({ message: await pgp.readMessage({ binaryMessage: data }), decryptionKeys: await pgp.readPrivateKey({ armoredKey: recipient.privateKey }), verificationKeys: await pgp.readKey({ armoredKey: sender.publicKey }) });
  assert.equal(decrypted.data, '<p>Browser send fixture</p>'); await decrypted.signatures[0].verified;
  console.log('Passed: actual browser worker restored keys, built a recipient-decryptable package and received synthetic send confirmation. No real mail was sent.');
} finally { await context.close(); }
