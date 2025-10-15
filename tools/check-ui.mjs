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
    window.chrome = { runtime: { id: 'test-extension', onMessage: { addListener() {} }, sendMessage: async ({ operation, data }) => {
      if (operation === 'dashboard' || operation === 'refresh') return { ok: true, value: current };
      if (operation === 'read') return { ok: true, value: { ...items.find(item => item.message.ID === data.messageId), body: '<p>Verification code: <b>583920</b></p><img src="https://example.test/tracker"><script>throw Error("unsafe")<\/script>', message: { ...items[0].message, MIMEType: 'text/html' }, attachments: [], signature: 'unverified' } };
      if (operation === 'addresses') return { ok: true, value: [{ ID: 'address', Email: 'sam@example.test', Status: 1 }] };
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
  await page.locator('[data-view="codes"]').click(); assert.equal(await page.locator('.mail-row').count(), 1);
  await page.locator('.code').click(); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '583920');
  await page.locator('.mail-row').click(); await page.waitForSelector('#code-chips .code');
  assert.equal(await page.locator('#allow-remote').isVisible(), true);
  const source = await page.locator('#message-html').getAttribute('srcdoc'); assert.ok(!source.includes('<script>')); assert.ok(source.includes("img-src data:"));
  await page.screenshot({ path: path.join(output, 'reader.png') }); await page.locator('#reader-close').click();
  await page.locator('[data-view="all"]').click(); await page.locator('#search').fill('weekend'); assert.equal(await page.locator('.mail-row').count(), 1); await page.locator('#search').fill('');
  await page.locator('.mail-row input').nth(0).click(); await page.locator('.mail-row input').nth(2).click({ modifiers: ['Shift'] }); assert.equal(await page.locator('#selection-count').innerText(), '3 selected');
  await page.locator('#selection-clear').click(); await page.locator('#compose-open').click(); await page.waitForSelector('#compose-dialog[open]'); await page.screenshot({ path: path.join(output, 'compose.png') }); await page.locator('[data-close="compose-dialog"]').click();
  await page.locator('#add-account').click(); await page.locator('#username').fill('offline-fixture'); await page.locator('#password').fill('not-a-real-password'); await page.locator('#login-submit').click();
  await page.waitForSelector('#totp-row:not([hidden])'); await page.locator('#totp').fill('123456'); await page.locator('#login-submit').click(); await page.waitForFunction(() => document.getElementById('login-title').textContent.includes('Unlock'));
  assert.equal(await page.locator('#password').inputValue(), ''); await page.locator('[data-close="login-dialog"]').click();
  await page.locator('#settings-open').click(); await page.waitForSelector('#preferences-dialog[open]'); await page.locator('#scheme').selectOption('dark'); await page.locator('#preferences-form button[type="submit"]').click();
  await page.screenshot({ path: path.join(output, 'dark.png') });
  await page.setViewportSize({ width: 400, height: 600 }); await page.evaluate(() => { document.body.style.width = '400px'; }); assert.ok(await page.evaluate(() => document.body.scrollWidth <= 400));
  await page.screenshot({ path: path.join(output, 'narrow.png') });
  assert.equal(errors.length, 0, errors.join('\n')); console.log('Original browser checks passed: real SRP proof generation, filters, clipboard, sanitized reader, search, range selection, composer, TOTP/mailbox continuation, theme and narrow layout.');
  await context.close();
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
