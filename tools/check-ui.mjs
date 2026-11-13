// Synthetic-only browser test. All non-local network traffic is blocked.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'esbuild';
const directory = path.resolve('dist/chrome'); const output = path.resolve('artifacts/ui'); await fs.mkdir(output, { recursive: true });
await build({ entryPoints: ['src/proton/sdk.js'], outfile: path.join(output, 'protocol-check.js'), bundle: true, platform: 'browser', format: 'iife', globalName: 'ProtocolCheck', target: ['chrome121'] });
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer(async (request, response) => {
  if (request.url === '/__protocol.html') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><script src="/__protocol.js"></script>'); return; }
  if (request.url === '/__protocol.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(await fs.readFile(path.join(output, 'protocol-check.js'))); return; }
  try { const file = path.resolve(directory, '.' + new URL(request.url, 'http://localhost').pathname); if (!file.startsWith(directory + path.sep)) throw Error(); const data = await fs.readFile(file); response.setHeader('Content-Type', types[path.extname(file)] || 'text/plain'); response.end(data); } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 620, height: 600 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await context.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  await context.addInitScript(() => {
    // Exercise the targeted byte shims rather than relying on a newer browser's native helpers.
    for (const [owner, name] of [[Uint8Array, 'fromBase64'], [Uint8Array, 'fromHex'], [Uint8Array.prototype, 'toBase64'], [Uint8Array.prototype, 'toHex']]) {
      Object.defineProperty(owner, name, { value: undefined, configurable: true });
    }
    const settings = { scheme: 'light', theme: 'evergreen', density: 'comfortable', width: 620, height: 600, pollSeconds: 60, limit: 30, previews: 1, customCSS: '', notifications: true, otp: { enabled: true, minimum: 4, maximum: 8, builtIn: true, context: true, custom: true, patterns: [] }, quiet: [], dndUntil: 0, accounts: {}, appVersion: 'web-mail@5.0.141.8' };
    const account = { id: 'demo', email: 'sam@example.test', label: 'Personal', color: '#177668', status: 'ready', unread: 3 };
    const item = (id, name, subject, preview, codes = [], starred = false) => ({ accountId: 'demo', preview, codes: codes.map(value => ({ value, score: 1, position: 1, source: 'body', distance: 1 })), message: { ID: id, ConversationID: id, Subject: subject, Sender: { Name: name, Address: name.replace(/\s/g, '').toLowerCase() + '@example.test' }, Time: Date.now() / 1000 - Number(id) * 180, Unread: 1, LabelIDs: starred ? ['0', '10'] : ['0'], ToList: [{ Address: 'sam@example.test' }] } });
    const items = [item('1', 'Orbit', 'Your sign-in code', 'Use your verification code to finish signing in.', ['583920']), item('2', 'Jamie Lee', 'The little things', 'A few ideas for the weekend, if you have a moment.', [], true), item('3', 'Studio Notes', 'A fresh direction', 'The next chapter starts with a blank page.')];
    let current = { accounts: [account], items, settings, checkedAt: Date.now(), polling: false };
    const localStorageMock = {}; window.sentMessages = [];
    window.chrome = { storage: { local: { get: async key => ({ [key]: localStorageMock[key] }), set: async data => Object.assign(localStorageMock, data) } }, runtime: { id: 'test-extension', onMessage: { addListener() {} }, sendMessage: async ({ operation, data }) => {
      if (operation === 'fixture-multi') { current.accounts = [account, {...account, id:'work', label:'Work', email:'work@example.test'}]; const work = {...item('4', 'Work sender', 'Work message', 'Work preview'), accountId:'work'}; work.message.Time = Date.now()/1000+1; current.items = [...items, work]; return {ok:true}; }
      if (operation === 'fixture-expand') { current.items = [...items, ...Array.from({length:5}, (_, i) => item(String(i+4), 'Older sender', 'Older message '+i, 'Older preview'))]; return {ok:true}; }
      if (operation === 'fixture-reset') { current.accounts = [account]; current.items = items; return {ok:true}; }
      if (operation === 'notification-target') return { ok:true, value: location.search.includes('notificationFixture') ? { accountId:'demo', messageId:'1' } : null };
      if (operation === 'dashboard' || operation === 'refresh') return { ok: true, value: current };
      if (operation === 'read') return { ok: true, value: { ...items.find(item => item.message.ID === data.messageId), body: '<p>Verification code: <b>583920</b></p><img src="https://example.test/tracker"><script>throw Error("unsafe")<\/script>', message: { ...items[0].message, MIMEType: 'text/html' }, attachments: [], signature: 'unverified' } };
      if (operation === 'addresses') return { ok: true, value: [{ ID: 'address', Email: 'sam@example.test', Status: 1 }] };
      if (operation === 'send') { window.sentMessages.push(data.message); return { ok: true, value: true }; }
      if (operation === 'recent-recipients') return { ok: true, value: ['previous@example.test', 'another@example.test'] };
      if (operation === 'labels') return { ok: true, value: [] };
      if (operation === 'settings') { current = { ...current, settings: data.value }; return { ok: true, value: current }; }
      if (operation === 'login') return { ok: true, value: { accountId: 'pending', phase: 'totp' } };
      if (operation === 'totp') return { ok: true, value: { accountId: 'pending', phase: 'mailbox' } };
      return { ok: true, value: true };
    } }, tabs: { create: async () => {} } };
  });
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.stack));
  const fixture = JSON.parse(await fs.readFile('tests/fixtures/proton-srp.json', 'utf8'));
  await page.goto(base + '/__protocol.html');
  const proofLengths = await page.evaluate(async challenge => {
    const result = await ProtocolCheck.getSrp(challenge, { username: 'jakubqa', password: 'abc123' });
    return [atob(result.clientEphemeral).length, atob(result.clientProof).length, atob(result.expectedServerProof).length];
  }, fixture.challenge);
  assert.deepEqual(proofLengths, [256, 256, 256]);
  await page.goto(base + '/ui.html'); await page.waitForSelector('.mail-row'); assert.equal(await page.locator('.mail-row').count(), 3);
  await page.screenshot({ path: path.join(output, 'messages.png') });
  assert.equal(await page.locator('#all-accounts').getAttribute('aria-pressed'), 'true');
  await page.evaluate(() => chrome.runtime.sendMessage({ operation: 'fixture-multi' }));
  await page.locator('#refresh').click(); await page.waitForFunction(() => document.querySelectorAll('.mail-row').length === 4);
  assert.equal(await page.locator('.mail-row').first().getAttribute('data-account-id'), 'work');
  await page.screenshot({ path: path.join(output, 'all-accounts.png') });
  await page.getByRole('button', {name:'Switch to work@example.test', exact:true}).click();
  assert.equal(await page.locator('.mail-row').count(), 1);
  assert.equal(await page.locator('#view-title').innerText(), 'Work');
  await page.getByRole('button', {name:'Copy work@example.test', exact:true}).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'work@example.test');
  assert.equal(await page.locator('.mail-row').count(), 1);
  await page.locator('#all-accounts').click(); assert.equal(await page.locator('.mail-row').count(), 4);
  await page.evaluate(() => chrome.runtime.sendMessage({ operation: 'fixture-reset' }));
  await page.locator('#refresh').click(); await page.waitForFunction(() => document.querySelectorAll('.mail-row').length === 3);

  await page.locator('[data-view="codes"]').click(); assert.equal(await page.locator('.mail-row').count(), 1);
  await page.locator('.code').click(); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '583920');
  await page.locator('.mail-row').click(); await page.waitForSelector('#code-chips .code');
  assert.equal(await page.locator('#allow-remote').isVisible(), true);
  const source = await page.locator('#message-html').getAttribute('srcdoc'); assert.ok(!source.includes('<script>')); assert.ok(source.includes("img-src data:"));
  await page.screenshot({ path: path.join(output, 'reader.png') }); await page.locator('#reader-close').click();
  await page.locator('[data-view="all"]').click(); await page.locator('#search').fill('weekend'); assert.equal(await page.locator('.mail-row').count(), 1); await page.locator('#search').fill('');
  await page.locator('.mail-row input').nth(0).click(); await page.locator('.mail-row input').nth(2).click({ modifiers: ['Shift'] }); assert.equal(await page.locator('#selection-count').innerText(), '3 selected');
  await page.evaluate(() => chrome.runtime.sendMessage({ operation: 'fixture-expand' }));
  await page.locator('#refresh').click(); await page.waitForFunction(() => document.querySelectorAll('.mail-row').length === 5);
  assert.equal(await page.locator('.mail-row').first().getAttribute('data-message-id'), '1');
  await page.locator('#more-mail').click(); assert.equal(await page.locator('.mail-row').count(), 8);
  await page.locator('[data-view="all"]').click(); assert.equal(await page.locator('.mail-row').count(), 5);
  await page.evaluate(() => chrome.runtime.sendMessage({ operation: 'fixture-reset' }));
  await page.locator('#refresh').click(); await page.waitForFunction(() => document.querySelectorAll('.mail-row').length === 3);
  await page.locator('#selection-clear').click(); await page.locator('#compose-open').click(); await page.waitForSelector('#compose-dialog[open]'); await page.screenshot({ path: path.join(output, 'compose.png') }); await page.locator('[data-close="compose-dialog"]').click();
  await page.locator('#compose-open').click();
  await page.locator('#compose-to').fill('previous');
  await page.waitForFunction(() => [...document.querySelectorAll('#compose-to-suggestions option')].some(option => option.value === 'previous@example.test'));
  await page.locator('#compose-to').fill('new@example.test, prev');
  await page.waitForFunction(() => document.querySelector('#compose-to-suggestions option')?.value === 'new@example.test, previous@example.test');
  await page.locator('#compose-to').fill('previous@example.test');
  await page.locator('#editor').fill('Synthetic outgoing message');
  assert.deepEqual(await page.evaluate(() => ['compose-dialog','compose-fields','editor','compose-bottom'].map(id => {
    const element = document.getElementById(id) || document.querySelector('.' + id); return getComputedStyle(element).overflowY;
  })), ['hidden','visible','visible','visible']);
  await page.locator('#send').click(); await page.waitForSelector('.extension-alert[open]');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await page.evaluate(() => window.sentMessages.length), 0);
  await page.locator('#send').click(); await page.waitForSelector('.extension-alert[open]');
  await page.locator('.extension-alert input[type="checkbox"]').check();
  await page.screenshot({ path: path.join(output, 'send-confirmation.png') });
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.waitForFunction(() => !document.getElementById('compose-dialog').open);
  assert.equal(await page.evaluate(() => window.sentMessages.length), 1);
  await page.locator('#compose-open').click();
  assert.equal(await page.locator('#compose-to').inputValue(), ''); assert.equal(await page.locator('#editor').innerText(), '');
  await page.locator('#compose-to').fill('second@example.test'); await page.locator('#send').click();
  await page.waitForFunction(() => window.sentMessages.length === 2 && !document.getElementById('compose-dialog').open);
  assert.equal(await page.locator('.extension-alert').count(), 0);
  await page.locator('#add-account').click(); await page.locator('#username').fill('offline-fixture'); await page.locator('#password').fill('not-a-real-password'); await page.locator('#login-submit').click();
  await page.waitForSelector('#totp-row:not([hidden])'); await page.locator('#totp').fill('123456'); await page.locator('#login-submit').click(); await page.waitForFunction(() => document.getElementById('login-title').textContent.includes('Unlock'));
  assert.equal(await page.locator('#password').inputValue(), ''); await page.locator('[data-close="login-dialog"]').click();
  await page.locator('#settings-open').click(); await page.waitForSelector('#preferences-dialog[open]'); await page.locator('#scheme').selectOption('dark'); await page.locator('#preferences-form button[type="submit"]').click();
  await page.screenshot({ path: path.join(output, 'dark.png') });
  await page.setViewportSize({ width: 400, height: 600 }); await page.evaluate(() => { document.body.style.width = '400px'; }); assert.ok(await page.evaluate(() => document.body.scrollWidth <= 400));
  await page.screenshot({ path: path.join(output, 'narrow.png') });
  // Exercise the isolated verification bridge with a synthetic Proton-origin page.
  // The route is fulfilled locally; no request reaches Proton or a solver service.
  const verificationPage = await context.newPage();
  await verificationPage.route('https://mail-api.proton.me/core/v4/captcha*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic verification</title>' }));
  await verificationPage.goto('https://mail-api.proton.me/core/v4/captcha?Token=synthetic&ForceWebMessaging=1');
  await verificationPage.evaluate(() => {
    window.verificationMessages = [];
    window.chrome.runtime.sendMessage = async message => { window.verificationMessages.push(message); return { ok: true, value: true }; };
  });
  await verificationPage.addScriptTag({ path: path.join(directory, 'verification.js') });
  await verificationPage.evaluate(() => {
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.test', source: window, data: { type: 'pm_captcha', token: 'forged' } }));
    window.postMessage({ type: 'pm_captcha', token: 'synthetic:ExactCase' }, location.origin);
  });
  await verificationPage.waitForFunction(() => window.verificationMessages.length === 1);
  assert.deepEqual(await verificationPage.evaluate(() => window.verificationMessages[0]), { quickcode: 1, operation: 'verification-result', data: { token: 'synthetic:ExactCase' } });
  await verificationPage.evaluate(() => window.postMessage({ type: 'pm_captcha', token: 'duplicate' }, location.origin));
  await verificationPage.waitForTimeout(50);
  assert.equal(await verificationPage.evaluate(() => window.verificationMessages.length), 1);
  await verificationPage.close();
  const notificationPage = await context.newPage();
  await notificationPage.goto(base + '/ui.html?notificationFixture=1');
  await notificationPage.waitForSelector('#code-chips .code');
  assert.equal(await notificationPage.locator('#reader').isVisible(), true);
  assert.ok((await notificationPage.locator('#message-heading').innerText()).includes('Your sign-in code'));
  await notificationPage.close();
  assert.equal(errors.length, 0, errors.join('\n')); console.log('Original browser checks passed: real SRP proof generation, filters, clipboard, sanitized reader, search, range selection, composer, TOTP/mailbox continuation, theme and narrow layout.');
  await context.close();
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
