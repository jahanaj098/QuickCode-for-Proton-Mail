// Real MV3 alarm/worker test. Synthetic accounts only; all remote traffic is intercepted.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const profile = await fs.mkdtemp(path.resolve('artifacts/worker-test-'));
const extensionPath = path.resolve('dist/chrome');
const context = await chromium.launchPersistentContext(profile, { channel: 'msedge', headless: true,
  args: ['--disable-extensions-except=' + extensionPath, '--load-extension=' + extensionPath] });
const calls = [];
context.on('request', request => { if (request.url().startsWith('https://mail.proton.me/api/')) console.log('Browser request: ' + request.url()); });
context.on('serviceworker', worker => { console.log('Worker target: ' + worker.url()); worker.on('console', message => console.log('Worker console: ' + message.text())); });
const old = { ID: 'old', ConversationID: 'old', Subject: 'Older mail', Sender: { Address: 'sender@example.test' }, Time: 1, Unread: 1, LabelIDs: ['0'] };
const fresh = { ...old, ID: 'new', ConversationID: 'new', Subject: 'Sign-in verification', Time: 2 };
try {
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (!url.startsWith('https://mail.proton.me/api/')) return route.abort();
    calls.push(url);
    let body;
    if (url.includes('messages/count')) body = { Code: 1000, Counts: [{ LabelID: '0', Unread: 2 }] };
    else if (url.includes('messages?')) body = { Code: 1000, Messages: [fresh, old] };
    else if (url.endsWith('/messages/new')) body = { Code: 1000, Message: { ...fresh, Body: 'Your verification code is 583920.', MIMEType: 'text/plain' } };
    else throw new Error('Unexpected synthetic request: ' + url);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  // Wait for initial empty-profile bootstrap before installing the fixture.
  // Otherwise bootstrap can overwrite the fixture alarm with its default interval.
  for (let i = 0; i < 40; i++) {
    if (await worker.evaluate(async () => (await chrome.action.getTitle({})).includes('unread inbox'))) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await worker.evaluate(async old => {
    await chrome.storage.local.set({ preferences: { pollSeconds: 30 } });
    await chrome.storage.session.set({ sessions: [{ id: 'fixture', uid: 'fixture', username: 'fixture@example.test', access: 'synthetic', refresh: 'synthetic', phase: 'ready', remember: false, label: 'Fixture', color: '#177668' }],
      snapshot: { fixture: [{ accountId: 'fixture', message: old, preview: '', codes: [], bodyLoaded: true }] }, seeded: ['fixture'], seen: ['old'], checkedAt: Date.now(), unreadCounts: { fixture: 1 } });
    await chrome.alarms.create('quickcode-poll', { delayInMinutes: .5, periodInMinutes: .5 });
  }, old);
  const page = context.pages()[0];
  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  cdp.on('ServiceWorker.workerErrorReported', event => console.log('Worker error: ' + JSON.stringify(event)));
  cdp.on('ServiceWorker.workerVersionUpdated', event => console.log('Worker lifecycle: ' + event.versions.map(version => version.runningStatus).join(',')));
  await cdp.send('ServiceWorker.stopAllWorkers');
  console.log('Stopped real extension worker; waiting for its 30-second alarm with no popup.');
  const deadline = Date.now() + 50_000;
  while (Date.now() < deadline && !calls.some(url => url.endsWith('/messages/new'))) await new Promise(resolve => setTimeout(resolve, 500));
  if (!calls.some(url => url.endsWith('/messages/new'))) {
    console.log('Intercepted requests: ' + calls.length);
    const diagnostic = await context.newPage(); await diagnostic.goto(new URL('clipboard.html', worker.url()).href);
    console.log(await diagnostic.evaluate(async () => ({ alarms: await chrome.alarms.getAll(), sessionKeys: Object.keys(await chrome.storage.session.get(null)) })));
  }
  assert.ok(calls.some(url => url.endsWith('/messages/new')), 'A real alarm did not fetch the incoming message');
  const resumed = context.serviceWorkers().at(-1);
  let result;
  for (let i = 0; i < 20; i++) {
    result = await resumed.evaluate(async () => ({ notifications: await chrome.notifications.getAll(), state: await chrome.storage.session.get(['seen', 'notificationTargets']) }));
    if (Object.keys(result.notifications).length) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(Object.keys(result.notifications).length, 1, 'Background fetch did not create a browser notification');
  assert.ok(Object.values(result.state.notificationTargets).some(target => target.code === '583920'));
  assert.ok(result.state.seen.includes('new'));
  assert.ok(context.pages().every(page => !page.url().includes('ui.html')), 'Popup unexpectedly opened during background test');
  console.log('Passed: real alarm woke a stopped worker, fetched synthetic OTP mail and created a notification with no popup.');
} finally { await context.close(); }
