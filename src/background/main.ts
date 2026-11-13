// Copyright (c) 2026 jahanaj098. SPDX-License-Identifier: GPL-3.0-only
import { extension } from '../core/platform';
import { DeviceVault } from '../core/vault';
import { defaults, preferences, type Credential, type Dashboard, type MailItem, type Preferences, type MailDetail } from '../core/model';
import { ProtonTransport } from '../proton/api';
import { Keyring } from '../proton/keys';
import { StandaloneLogin } from '../proton/login';
import { Mailbox, type ComposeInput } from '../proton/mail';
import { Notifications } from './notifications';
import { base64 } from '../core/encoding';
import { VerificationRequests } from './verification';
import { captchaURL, type HumanChallenge } from '../proton/verification';
import { ensurePollingAlarm } from './polling';
import { badgeCount } from './badge';
import { backgroundTask } from './task';
const verificationTabs = new Map<number, { id: string; owner: string; url: string }>();
const verification = new VerificationRequests(async (id, challenge, owner) => {
  const url = captchaURL(challenge.token);
  const tab = await extension.tabs.create({ url, active: true });
  if (tab.id === undefined) throw new Error('Could not open Proton verification.');
  verificationTabs.set(tab.id, { id, owner, url });
});

let settings = defaults();
const sessions = new Map<string, Credential>();
const items = new Map<string, MailItem[]>();
const errors = new Map<string, string>();
const seen = new Set<string>();
let seeded = new Set<string>();
let checkedAt = 0;
let polling: Promise<void> | undefined;
let writeQueue = Promise.resolve();
let badgeAccount = '';
let unreadCounts: Record<string, number | null> = {};
const readRevisions = new Map<string, number>();
const recentlyRead = new Map<string, Set<string>>();
let backgroundHealth: { lastStartedAt?: number; lastFinishedAt?: number; lastAlarmAt?: number; lastHeartbeatAt?: number; trigger?: string; result?: string } = {};
async function updateBadge(): Promise<void> {
  const text = badgeCount([...sessions.keys()], badgeAccount, unreadCounts);
  const scope = badgeAccount ? sessions.get(badgeAccount)?.label || 'Selected account' : 'All accounts';
  await extension.action.setBadgeText({ text });
  await extension.action.setBadgeBackgroundColor({ color: '#177668' });
  await extension.action.setTitle({ title: 'QuickCode · ' + scope + ' · ' + (text === '?' ? 'Unread inbox count unavailable; waiting for refresh' : (text || '0') + ' unread inbox messages') });
}
const vault = new DeviceVault(extension.storage.local);
function saveSessions(): Promise<void> {
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    await extension.storage.session.set({ sessions: [...sessions.values()] });
    const remembered = [...sessions.values()].filter(session => session.remember && session.phase === 'ready');
    if (remembered.length) await vault.put('rememberedAccounts', remembered); else await vault.remove('rememberedAccounts');
  });
  return writeQueue;
}
const api = new ProtonTransport(() => settings.appVersion, saveSessions);
const keyring = new Keyring(api);
const login = new StandaloneLogin(api, keyring, sessions, saveSessions);
const mailbox = new Mailbox(api, keyring, () => settings);
const notifications = new Notifications(() => settings);
const ready = (async () => {
  const local = await extension.storage.local.get(['preferences', 'badgeAccount']); settings = preferences(local.preferences);
  badgeAccount = typeof local.badgeAccount === 'string' ? local.badgeAccount : '';
  const memory = await extension.storage.session.get(['sessions', 'snapshot', 'seen', 'seeded', 'checkedAt', 'unreadCounts', 'backgroundHealth']) as {
    sessions?: Credential[]; snapshot?: Record<string, MailItem[]>; seen?: string[]; seeded?: string[]; checkedAt?: number; unreadCounts?: Record<string, number | null>; backgroundHealth?: typeof backgroundHealth;
  };
  const remembered = await vault.get<Credential[]>('rememberedAccounts').catch(() => undefined);
  for (const session of [...(remembered || []), ...(memory.sessions || [])] as Credential[]) sessions.set(session.id, session);
  for (const [id, rows] of Object.entries(memory.snapshot || {})) items.set(id, rows as MailItem[]);
  for (const id of memory.seen || []) seen.add(id);
  seeded = new Set(memory.seeded || []); checkedAt = memory.checkedAt || 0;
  unreadCounts = memory.unreadCounts || {};
  backgroundHealth = memory.backgroundHealth || {};
  if (badgeAccount && !sessions.has(badgeAccount)) badgeAccount = '';
  await ensurePollingAlarm(settings.pollSeconds);
  await updateBadge();
})();
function account(id: unknown): Credential {
  const session = typeof id === 'string' ? sessions.get(id) : undefined;
  if (!session) throw new Error('Account not found. Add the account again.'); return session;
}
async function dashboard(): Promise<Dashboard> {
  return { settings, checkedAt, selectedAccount: badgeAccount, polling: !!polling, items: [...items.values()].flat(), accounts: [...sessions.values()].map(session => ({
    id: session.id, email: session.username, label: settings.accounts[session.id]?.label || session.label, color: settings.accounts[session.id]?.color || session.color,
    status: session.phase, unread: items.get(session.id)?.filter(item => item.message.Unread).length || 0, error: errors.get(session.id),
  })) };
}
async function poll(trigger = 'manual'): Promise<void> {
  await ready;
  if (polling) return polling;
  polling = backgroundTask(async () => {
    backgroundHealth = { ...backgroundHealth, lastStartedAt: Date.now(), trigger, result: 'running' };
    if (trigger === 'alarm') backgroundHealth.lastAlarmAt = Date.now();
    await extension.storage.session.set({ backgroundHealth });
    let bodyFailures = 0;
    for (const session of sessions.values()) {
      if (session.phase !== 'ready') { unreadCounts[session.id] = null; continue; }
      const revision = readRevisions.get(session.id) || 0;
      try { const count = await mailbox.inboxUnread(session); if (revision === (readRevisions.get(session.id) || 0)) unreadCounts[session.id] = count; }
      catch { if (revision === (readRevisions.get(session.id) || 0)) unreadCounts[session.id] = null; }
      try {
        const rows = await mailbox.list(session); const initial = !seeded.has(session.id);
        const old = items.get(session.id) || [];
        const pendingRead = recentlyRead.get(session.id);
        if (pendingRead) for (const id of pendingRead) if (!rows.some(row => row.message.ID === id && row.message.Unread)) pendingRead.delete(id);
        for (const row of rows) {
          if (pendingRead?.has(row.message.ID)) row.message.Unread = 0;
          const cached = old.find(item => item.message.ID === row.message.ID);
          if (cached) { row.preview = cached.preview; row.codes = cached.codes; row.bodyLoaded = cached.bodyLoaded; }
        }
        // Show latest metadata immediately; an unreadable historical body must
        // not leave an older list displayed while the remaining bodies load.
        items.set(session.id, rows);
        void extension.runtime.sendMessage({ quickcodeUpdate: true }).catch(() => {});
        for (const row of rows) {
          const cached = old.find(item => item.message.ID === row.message.ID);
          if (cached?.bodyLoaded) { row.preview = cached.preview; row.codes = cached.codes; row.bodyLoaded = true; }
          else try { const detail = await mailbox.read(session, row.message.ID); row.preview = detail.preview; row.codes = detail.codes; row.bodyLoaded = true; }
          catch { bodyFailures++; row.bodyLoaded = false; }
          if (initial || !row.message.Unread) seen.add(row.message.ID);
          else if (!seen.has(row.message.ID)) {
            // A failed body read must remain eligible for a later OTP retry.
            // Likewise do not consume mail when the browser rejects creation.
            if (row.bodyLoaded || row.codes.length) {
              if (await notifications.show(row)) seen.add(row.message.ID);
            } else await extension.storage.session.set({ notificationHealth: { attemptedAt: Date.now(), status: 'waiting-for-message-body' } });
          }
        }
        const read = recentlyRead.get(session.id);
        for (const row of rows) if (read?.has(row.message.ID)) row.message.Unread = 0;
        seeded.add(session.id); items.set(session.id, rows); errors.delete(session.id);
      } catch (error) { errors.set(session.id, error instanceof Error ? error.message : 'Mail refresh failed.'); }
    }
    const trimmed = [...seen].slice(-2000); seen.clear(); trimmed.forEach(id => seen.add(id));
    checkedAt = Date.now();
    await extension.storage.session.set({ snapshot: Object.fromEntries(items), seen: trimmed, seeded: [...seeded], checkedAt, unreadCounts });
    await updateBadge();
    backgroundHealth.lastFinishedAt = Date.now(); backgroundHealth.result = errors.size || bodyFailures ? 'partial' : 'ok';
    await extension.storage.session.set({ backgroundHealth });
    extension.runtime.sendMessage({ quickcodeUpdate: true }).catch(() => {});
  }, async () => {
    backgroundHealth.lastHeartbeatAt = Date.now(); await extension.storage.session.set({ backgroundHealth });
  }).catch(async error => {
    backgroundHealth.result = 'failed'; backgroundHealth.lastFinishedAt = Date.now();
    await extension.storage.session.set({ backgroundHealth }); throw error;
  }).finally(() => { polling = undefined; });
  return polling;
}
async function handle(operation: string, input: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> {
  await ready;
  const data = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const owner = sender.documentId || String(sender.tab?.id ?? '') + ':' + (sender.url || '');
  const verificationId = String(data.verificationId || '');
  const verify = async (challenge: HumanChallenge): Promise<string> => {
    try { return await verification.verifier(verificationId, owner)(challenge); }
    finally {
      for (const [tabId, request] of verificationTabs) if (request.id === verificationId && request.owner === owner) {
        verificationTabs.delete(tabId); await extension.tabs.remove(tabId).catch(() => {});
      }
    }
  };
  switch (operation) {
    case 'verification-result': {
      const request = sender.tab?.id === undefined ? undefined : verificationTabs.get(sender.tab.id);
      if (!request || sender.frameId !== 0 || sender.url !== request.url) return false;
      return verification.finish(request.id, request.owner, typeof data.token === 'string' ? data.token : undefined);
    }
    case 'verification-cancel': return verification.finish(String(data.id || ''), owner);
    case 'verification-ping': return true;
    case 'dashboard': return dashboard();
    case 'background-diagnostics': return {
      version: extension.runtime.getManifest().version, generatedAt: Date.now(), pollSeconds: settings.pollSeconds,
      connectedAccounts: sessions.size, unlockedAccounts: [...sessions.values()].filter(session => session.phase === 'ready').length,
      alarm: await extension.alarms.get('quickcode-poll'), background: backgroundHealth,
      notificationPermission: await extension.permissions.contains({ permissions: ['notifications'] }),
      notifications: (await extension.storage.session.get('notificationHealth')).notificationHealth || null,
    };
    case 'select-account': {
      const id = typeof data.accountId === 'string' ? data.accountId : '';
      if (id && !sessions.has(id)) throw new Error('Account not found.');
      badgeAccount = id; await extension.storage.local.set({ badgeAccount }); await updateBadge(); return true;
    }
    case 'notification-target': {
      const target = (await extension.storage.session.get('pendingNotification')).pendingNotification as { accountId: string; messageId: string; requestedAt: number } | undefined;
      await extension.storage.session.remove('pendingNotification');
      return target && Date.now() - target.requestedAt < 300_000 ? target : null;
    }
    case 'login': {
      const result = await login.start(String(data.username || ''), String(data.password || ''), data.remember === true, String(data.totp || ''), verify);
      if (result.phase === 'ready') await poll(); return result;
    }
    case 'totp': return login.secondFactor(String(data.accountId), String(data.code || ''), verify);
    case 'unlock': { const result = await login.unlock(String(data.accountId), String(data.password || '')); await poll(); return result; }
    case 'refresh': await poll(); return dashboard();
    case 'read': {
      const session = account(data.accountId), id = String(data.messageId);
      const detail = await mailbox.read(session, id);
      if (detail.message.Unread) {
        await mailbox.action(session, 'read', [id]); detail.message.Unread = 0;
        readRevisions.set(session.id, (readRevisions.get(session.id) || 0) + 1);
        const read = recentlyRead.get(session.id) || new Set<string>(); read.add(id); recentlyRead.set(session.id, read); seen.add(id);
        for (const item of items.get(session.id) || []) if (item.message.ID === id) item.message.Unread = 0;
        try { unreadCounts[session.id] = await mailbox.inboxUnread(session); } catch { unreadCounts[session.id] = null; }
        await extension.storage.session.set({ snapshot: Object.fromEntries(items), unreadCounts }); await updateBadge();
        void extension.runtime.sendMessage({ quickcodeUpdate: true }).catch(() => {});
      }
      return detail;
    }
    case 'labels': return mailbox.labels(account(data.accountId));
    case 'recent-recipients': return mailbox.recentRecipients(account(data.accountId));
    case 'addresses': return (await keyring.unlock(account(data.accountId))).addresses.map(({ ID, Email, DisplayName, Status }) => ({ ID, Email, DisplayName, Status }));
    case 'attachment': return mailbox.download(account(data.accountId), String(data.messageId), String(data.attachmentId));
    case 'action': {
      if (data.action === 'delete' && data.confirmed !== true) throw new Error('Permanent deletion requires confirmation.');
      const ids = Array.isArray(data.ids) ? data.ids as string[] : [];
      await mailbox.action(account(data.accountId), String(data.action), ids, typeof data.label === 'string' ? data.label : undefined);
      if (data.action === 'unread') for (const id of ids) recentlyRead.get(String(data.accountId))?.delete(id);
      await poll(); return dashboard();
    }
    case 'send': {
      if (data.confirmed !== true) throw new Error('Send confirmation is required.');
      const session = account(data.accountId); let stage = 'Starting send';
      return backgroundTask(async () => {
        try {
          return await mailbox.send(session, data.message as ComposeInput, async value => {
            stage = value; await extension.runtime.sendMessage({ quickcodeSendProgress: { id: data.requestId, stage } }).catch(() => {});
          });
        } catch (error) { throw new Error(stage + ': ' + (error instanceof Error ? error.message : 'Send failed') + ' Your compose text is preserved. Check Proton Drafts/Sent before retrying.'); }
      }, () => extension.storage.session.set({ sendProgressAt: Date.now() }));
    }
    case 'forget': {
      const session = account(data.accountId);
      await api.request('core/v4/auth', { method: 'DELETE' }, session).catch(() => {});
      keyring.clear(session.id); sessions.delete(session.id); items.delete(session.id); seeded.delete(session.id);
      delete unreadCounts[session.id]; if (badgeAccount === session.id) { badgeAccount = ''; await extension.storage.local.set({ badgeAccount }); }
      await updateBadge();
      await extension.storage.local.remove('quickcodeRecipients:' + session.id); await saveSessions(); return dashboard();
    }
    case 'settings': {
      settings = preferences(data.value); await extension.storage.local.set({ preferences: settings });
      await ensurePollingAlarm(settings.pollSeconds); return dashboard();
    }
    case 'sync-export': await extension.storage.sync.set({ preferences: settings }); return true;
    case 'sync-import': {
      settings = preferences((await extension.storage.sync.get('preferences')).preferences); await extension.storage.local.set({ preferences: settings });
      await ensurePollingAlarm(settings.pollSeconds); return dashboard();
    }
    case 'export-eml': return exportMail(account(data.accountId), String(data.messageId));
    default: throw new Error('Unknown QuickCode command.');
  }
}
async function exportMail(session: Credential, id: string): Promise<{ name: string; data: string; type: string }> {
  const detail: MailDetail = await mailbox.read(session, id); const boundary = 'quickcode-' + crypto.randomUUID();
  const encode = (text: string) => base64(new TextEncoder().encode(text));
  const wrap = (text: string) => text.match(/.{1,76}/gu)?.join('\r\n') || '';
  const clean = (text: string) => text.replace(/[\r\n]/gu, ' ');
  let eml = 'From: ' + clean(detail.message.Sender.Address) + '\r\nTo: ' + (detail.message.ToList || []).map(person => clean(person.Address)).join(', ') + '\r\nSubject: =?UTF-8?B?' + encode(detail.message.Subject) + '?=\r\nDate: ' + new Date(detail.message.Time * 1000).toUTCString() + '\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="' + boundary + '"\r\n\r\n';
  eml += '--' + boundary + '\r\nContent-Type: ' + (detail.message.MIMEType === 'text/html' ? 'text/html' : 'text/plain') + '; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + wrap(encode(detail.body)) + '\r\n';
  for (const attachment of detail.attachments) {
    const file = await mailbox.download(session, id, attachment.ID);
    eml += '--' + boundary + '\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename*=UTF-8\'\'' + encodeURIComponent(file.name) + '\r\nContent-Transfer-Encoding: base64\r\n\r\n' + wrap(file.data) + '\r\n';
  }
  eml += '--' + boundary + '--\r\n';
  return { name: clean(detail.message.Subject || 'message').replace(/[^\w .-]/gu, '_').slice(0, 80) + '.eml', type: 'message/rfc822', data: encode(eml) };
}
extension.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message || message.quickcode !== 1 || sender.id !== extension.runtime.id) return false;
  handle(message.operation, message.data, sender).then(value => respond({ ok: true, value })).catch(error => respond({ ok: false, error: error instanceof Error ? error.message : 'QuickCode operation failed.' }));
  return true;
});
extension.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'quickcode-poll') void poll('alarm').catch(() => {}); });
extension.notifications.onClicked.addListener(id => { void ready.then(() => notifications.event(id)); });
extension.notifications.onButtonClicked?.addListener((id, button) => { void ready.then(() => notifications.event(id, button)); });
extension.runtime.onStartup.addListener(() => { void poll('startup').catch(() => {}); });
extension.runtime.onInstalled.addListener(() => { void poll('installed').catch(() => {}); });

extension.tabs.onRemoved.addListener(tabId => {
  const request = verificationTabs.get(tabId); if (!request) return;
  verificationTabs.delete(tabId); verification.finish(request.id, request.owner);
});
// A restored worker can catch up without any popup or dashboard message.
void ready.then(() => {
  if (!checkedAt || Date.now() - checkedAt >= settings.pollSeconds * 1000 || [...sessions.values()].some(session => session.phase === 'ready' && !(session.id in unreadCounts))) return poll('worker');
}).catch(() => { console.info('QuickCode: background refresh could not start; it will retry on the next alarm.'); });
