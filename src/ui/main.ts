// Copyright (c) 2026 jahanaj098. SPDX-License-Identifier: GPL-3.0-only
import DOMPurify from 'dompurify';
import { call, extension } from '../core/platform';
import { base64, bytes } from '../core/encoding';
import { defaults, type Dashboard, type MailItem, type MailDetail, type AuthResult, type Preferences, type Pattern, type QuietRule, type Address } from '../core/model';
import type { ComposeInput, Label } from '../proton/mail';
const get = <T extends HTMLElement>(id: string): T => { const node = document.getElementById(id); if (!node) throw new Error('Missing UI element ' + id); return node as T; };
const value = (id: string) => get<HTMLInputElement>(id).value;
const checked = (id: string) => get<HTMLInputElement>(id).checked;
const input = (id: string, data: unknown) => { get<HTMLInputElement>(id).value = String(data ?? ''); };
const toggle = (id: string, data: boolean) => { get<HTMLInputElement>(id).checked = data; };
const open = (id: string) => { const dialog = get<HTMLDialogElement>(id); if (!dialog.open) dialog.showModal(); };
const close = (id: string) => get<HTMLDialogElement>(id).close();
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag); if (text !== undefined) item.textContent = text; if (className) item.className = className; return item;
}
let state: Dashboard = { accounts: [], items: [], settings: defaults(), polling: false, checkedAt: 0 };
let view = 'all'; let selectedAccount = ''; let selected = new Set<string>(); let anchor = ''; let active: MailDetail | undefined;
let loginStep: AuthResult | undefined; let raw = false; let remote = false; let draftParent: { parentId?: string; action?: ComposeInput['action'] } = {};
let files: ComposeInput['files'] = []; let patterns: Pattern[] = []; let quiet: QuietRule[] = [];
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let verificationId = '';
let visibleLimit = 5;
let restoredAccount = false;
get('login-dialog').addEventListener('close', () => { if (verificationId) void call('verification-cancel', { id: verificationId }).catch(() => {}); });
function notify(message: string): void { const toast = get('toast'); toast.textContent = message; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 5000); }
async function attempt(action: () => Promise<unknown>): Promise<void> { try { await action(); } catch (error) { notify(error instanceof Error ? error.message : 'The action could not be completed.'); } }
async function confirmAlert(message: string, accept: string, rememberKey?: string): Promise<boolean> {
  const key = 'quickcodeAlertPreferences';
  const saved = ((await extension.storage.local.get(key))[key] || {}) as Record<string, boolean>;
  if (rememberKey && saved[rememberKey] === true) return true;
  const dialog = node('dialog'); dialog.className = 'extension-alert'; dialog.setAttribute('aria-label', 'QuickCode confirmation');
  dialog.append(node('span', 'QUICKCODE', 'eyebrow'), node('h2', accept + '?'), node('p', message));
  const check = node('input'); check.type = 'checkbox';
  if (rememberKey) { const label = node('label', undefined, 'check'); label.append(check, node('span', 'Don’t ask again on this device')); dialog.append(label); }
  const actions = node('div', undefined, 'alert-actions'); const cancel = node('button', 'Cancel'), ok = node('button', accept, 'primary'); actions.append(cancel, ok); dialog.append(actions); document.body.append(dialog);
  return new Promise(resolve => {
    let settled = false;
    const finish = async (accepted: boolean) => {
      if (settled) return; settled = true;
      try {
        if (accepted && rememberKey && check.checked) await extension.storage.local.set({ [key]: { ...saved, [rememberKey]: true } });
        dialog.close(); dialog.remove(); resolve(accepted);
      } catch { dialog.close(); dialog.remove(); resolve(false); notify('Could not save the alert preference. Please try again.'); }
    };
    cancel.onclick = () => { void finish(false); }; ok.onclick = () => { void finish(true); };
    dialog.addEventListener('cancel', event => { event.preventDefault(); void finish(false); });
    dialog.showModal(); cancel.focus();
  });
}
let recipientSuggestions: string[] = [];
let recipientRequest = 0;
const suggestionLists = new Map<string, HTMLDataListElement>();
for (const id of ['compose-to', 'compose-cc', 'compose-bcc']) {
  const list = node('datalist'); list.id = id + '-suggestions'; document.body.append(list); suggestionLists.set(id, list);
  get<HTMLInputElement>(id).setAttribute('list', list.id); get<HTMLInputElement>(id).autocomplete = 'off';
  get(id).addEventListener('input', () => renderRecipientSuggestions(id));
}
function renderRecipientSuggestions(id: string): void {
  const text = value(id), split = Math.max(text.lastIndexOf(','), text.lastIndexOf(';'));
  const prefix = split < 0 ? '' : text.slice(0, split + 1) + ' ', query = text.slice(split + 1).trim().toLowerCase();
  const list = suggestionLists.get(id)!; list.replaceChildren();
  for (const address of recipientSuggestions.filter(address => address.toLowerCase().includes(query)).slice(0, 20)) { const option = node('option'); option.value = prefix + address; list.append(option); }
}
async function loadRecipientSuggestions(): Promise<void> {
  const request = ++recipientRequest, accountId = value('compose-account'); recipientSuggestions = [];
  for (const id of suggestionLists.keys()) renderRecipientSuggestions(id);
  const key = 'quickcodeRecipients:' + accountId;
  const local = (await extension.storage.local.get(key))[key];
  if (request !== recipientRequest) return;
  recipientSuggestions = Array.isArray(local) ? local.filter(item => typeof item === 'string') : [];
  for (const id of suggestionLists.keys()) renderRecipientSuggestions(id);
  const recent = await call<string[]>('recent-recipients', { accountId }).catch(() => []);
  if (request !== recipientRequest || accountId !== value('compose-account')) return;
  recipientSuggestions = [...new Set([...(Array.isArray(local) ? local.filter(item => typeof item === 'string') : []), ...recent])];
  for (const id of suggestionLists.keys()) renderRecipientSuggestions(id);
}
function appearance(): void {
  const settings = state.settings;
  document.body.dataset.scheme = settings.scheme === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : settings.scheme;
  document.body.dataset.theme = settings.theme; document.body.dataset.density = settings.density;
  if (!new URLSearchParams(location.search).has('window')) { document.body.style.width = settings.width + 'px'; document.body.style.height = settings.height + 'px'; }
  else document.body.classList.add('window');
  let custom = document.querySelector<HTMLStyleElement>('#user-styles'); if (!custom) { custom = node('style'); custom.id = 'user-styles'; document.head.append(custom); } custom.textContent = settings.customCSS;
}
function matches(item: MailItem): boolean {
  const text = (item.message.Sender.Name + ' ' + item.message.Sender.Address + ' ' + item.message.Subject + ' ' + item.preview).toLocaleLowerCase();
  return (!selectedAccount || selectedAccount === item.accountId) && text.includes(value('search').toLocaleLowerCase().trim()) &&
    (view === 'all' || (view === 'codes' ? item.codes.length > 0 : item.message.LabelIDs.includes('10')));
}
function selection(): void { get('bulk').hidden = !selected.size; get('selection-count').textContent = selected.size + ' selected'; }
function switchAccount(id: string): void {
  selectedAccount = id; visibleLimit = 5; selected.clear(); anchor = '';
  void attempt(() => call('select-account', { accountId: id }));
  get('reader').hidden = true; active = undefined; render();
  (id ? get('accounts').querySelector<HTMLButtonElement>('[aria-pressed="true"]') : get('all-accounts'))?.focus({ preventScroll: true });
}
function copyAccountEmail(email: string): void {
  void attempt(async () => { await navigator.clipboard.writeText(email); notify('Email address copied'); });
}
get('all-accounts').addEventListener('click', () => switchAccount(''));
function render(): void {
  appearance(); const accounts = get('accounts'); accounts.replaceChildren();
  if (selectedAccount && !state.accounts.some(account => account.id === selectedAccount)) selectedAccount = '';
  get('all-accounts').setAttribute('aria-pressed', String(!selectedAccount));
  const currentAccount = state.accounts.find(account => account.id === selectedAccount);
  get('view-title').textContent = currentAccount?.label || 'All accounts';
  get('view-description').textContent = currentAccount?.email || 'Messages and codes from all your accounts, together.';
  for (const account of state.accounts) {
    const shortcut = node('div', undefined, 'account-shortcut');
    const button = node('button', account.label.slice(0, 2).toUpperCase()); button.title = account.label + ' · ' + account.email + ' · ' + account.unread + ' loaded unread'; button.setAttribute('aria-label', 'Switch to ' + account.email);
    button.setAttribute('aria-pressed', String(selectedAccount === account.id));
    button.style.borderLeft = '3px solid ' + account.color;
    button.addEventListener('click', () => switchAccount(account.id));
    const copy = node('button', 'Copy', 'account-copy'); copy.title = 'Copy ' + account.email; copy.setAttribute('aria-label', copy.title);
    copy.addEventListener('click', () => copyAccountEmail(account.email));
    shortcut.append(button, copy); accounts.append(shortcut);
  }
  get<HTMLButtonElement>('compose-open').disabled = !state.accounts.some(account => account.status === 'ready');
  const scoped = state.items.filter(item => !selectedAccount || item.accountId === selectedAccount);
  get('total-count').textContent = String(scoped.length); get('code-count').textContent = String(scoped.filter(item => item.codes.length).length);
  const matched = state.items.filter(matches).sort((a, b) => b.message.Time - a.message.Time);
  const visible = matched.slice(0, visibleLimit); const list = get('list'); list.replaceChildren();
  for (const account of state.accounts) {
    if (selectedAccount && selectedAccount !== account.id) continue;
    const rows = visible.filter(item => item.accountId === account.id); if (!rows.length && visible.length) continue;
    const heading = node('div', account.label, 'account-heading');
    const copy = node('button', 'Copy email'); copy.setAttribute('aria-label', 'Copy email address ' + account.email); copy.title = account.email;
    copy.addEventListener('click', () => copyAccountEmail(account.email)); heading.append(copy);
    if (account.status !== 'ready') {
      const resume = node('button', account.status === 'totp' ? 'Enter 2FA code' : 'Unlock mailbox'); resume.addEventListener('click', () => showLogin({ accountId: account.id, phase: account.status === 'totp' ? 'totp' : 'mailbox' })); heading.append(resume);
    } else if (account.error) heading.append(node('span', account.error));
    if (selectedAccount || account.status !== 'ready' || account.error) list.append(heading);
    for (const item of rows) {
      const row = node('article', undefined, 'mail-row' + (item.message.Unread ? ' unread' : '')); row.dataset.messageId = item.message.ID; row.dataset.accountId = item.accountId; row.tabIndex = 0; row.setAttribute('role', 'listitem');
      const box = node('input'); box.type = 'checkbox'; box.checked = selected.has(item.message.ID); box.setAttribute('aria-label', 'Select ' + item.message.Subject);
      box.addEventListener('click', event => {
        event.stopPropagation();
        const prior = state.items.find(item => selected.has(item.message.ID)); if (prior && prior.accountId !== item.accountId) selected.clear();
        if (event.shiftKey && anchor) {
          const start = visible.findIndex(item => item.message.ID === anchor), end = visible.indexOf(item);
          for (const candidate of visible.slice(Math.min(start, end), Math.max(start, end) + 1)) if (candidate.accountId === item.accountId) { if (box.checked) selected.add(candidate.message.ID); else selected.delete(candidate.message.ID); }
        } else if (box.checked) selected.add(item.message.ID); else selected.delete(item.message.ID);
        anchor = item.message.ID; render();
      });
      const content = node('div', undefined, 'mail-content'); const top = node('div', undefined, 'mail-top'); top.append(node('span', item.message.Sender.Name || item.message.Sender.Address, 'sender'), node('time', new Date(item.message.Time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 'timestamp'));
      content.append(top, node('div', item.message.Subject || '(No subject)', 'subject'));
      if (!selectedAccount && state.accounts.length > 1) { const tag = node('span', account.label, 'account-tag'); tag.title = account.email; content.append(tag); }
      if (state.settings.previews > 0 && item.preview) content.append(node('div', item.preview, 'preview'));
      for (const code of item.codes) { const chip = node('button', code.value, 'code'); chip.setAttribute('aria-label', 'Copy code ' + code.value); chip.addEventListener('click', event => { event.stopPropagation(); void attempt(async () => { await navigator.clipboard.writeText(code.value); notify('Code copied'); }); }); content.append(chip); }
      if (item.message.NumAttachments) content.append(node('span', ' · ' + item.message.NumAttachments + ' attachment(s)', 'hint'));
      row.append(box, content); row.addEventListener('click', () => { void attempt(() => read(item)); }); list.append(row);
    }
  }
  if (!selectedAccount) {
    const rows = [...list.querySelectorAll<HTMLElement>('.mail-row')];
    for (const item of visible) { const row = rows.find(row => row.dataset.messageId === item.message.ID && row.dataset.accountId === item.accountId); if (row) list.append(row); }
  }
  if (matched.length > visible.length) {
    const more = node('button', 'More · show next ' + Math.min(5, matched.length - visible.length), 'more-mail'); more.id = 'more-mail';
    more.addEventListener('click', () => { visibleLimit += 5; render(); }); list.append(more);
  }
  const errors = state.accounts.filter(account => account.error).map(account => account.label + ': ' + account.error).join(' · ');
  get('list-status').textContent = !state.accounts.length ? 'Connect a Proton account to begin. Standalone login and decryption are experimental.' : errors || (visible.length ? '' : 'No loaded messages match this view. Refresh or choose another view.');
  get('checked').textContent = state.checkedAt ? 'Checked ' + new Date(state.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Not checked yet'; selection();
}
async function update(refresh = false): Promise<void> {
  state = await call<Dashboard>(refresh ? 'refresh' : 'dashboard');
  if (!restoredAccount) { selectedAccount = state.selectedAccount || ''; restoredAccount = true; }
  render();
}
async function read(item: MailItem): Promise<void> {
  get('reader').hidden = false; get('message-heading').replaceChildren(node('p', 'Decrypting locally…')); get('message-plain').textContent = ''; get<HTMLIFrameElement>('message-html').hidden = true;
  active = await call<MailDetail>('read', { accountId: item.accountId, messageId: item.message.ID }); raw = false; remote = false;
  const heading = get('message-heading'); heading.replaceChildren(node('strong', active.message.Sender.Name || active.message.Sender.Address), node('p', active.message.Sender.Address), node('h2', active.message.Subject || '(No subject)'), node('p', 'To: ' + (active.message.ToList || []).map(person => person.Address).join(', ')));
  const chips = get('code-chips'); chips.replaceChildren();
  for (const code of active.codes) { const button = node('button', code.value, 'code'); button.addEventListener('click', () => { void attempt(async () => { await navigator.clipboard.writeText(code.value); notify('Code copied'); }); }); chips.append(button); }
  const attachments = get('attachments'); attachments.replaceChildren();
  for (const attachment of active.attachments) { const button = node('button', attachment.Name + ' ↓'); button.addEventListener('click', () => { void attempt(async () => download(await call('attachment', { accountId: active!.accountId, messageId: active!.message.ID, attachmentId: attachment.ID }))); }); attachments.append(button); }
  renderBody();
}
function renderBody(): void {
  if (!active) return;
  const html = get<HTMLIFrameElement>('message-html'), plain = get('message-plain');
  const isHTML = active.message.MIMEType === 'text/html' || /<(?:p|div|html|body)\b/iu.test(active.body);
  html.hidden = raw || !isHTML; plain.hidden = !raw && isHTML;
  get('allow-remote').hidden = raw || !isHTML || remote || !/(?:src|srcset)\s*=\s*["']?https?:/iu.test(active.body);
  if (raw || !isHTML) { plain.textContent = raw ? (active.message.Header || '') + '\n\n' + active.body : active.body; return; }
  const sanitized = DOMPurify.sanitize(active.body, { WHOLE_DOCUMENT: false, FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed', 'script', 'svg', 'math', 'link', 'base'], FORBID_ATTR: ['srcset', 'formaction', 'action'] });
  const policy = "default-src 'none'; img-src data: " + (remote ? 'https:' : '') + "; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
  html.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + policy + '"><style>body{font:14px/1.6 system-ui;margin:16px;overflow-wrap:anywhere;color-scheme:light;color:CanvasText;background:Canvas}img{max-width:100%;height:auto}table{max-width:100%}</style></head><body>' + sanitized + '</body></html>';
}
function download(file: { name: string; type: string; data: string }): void {
  const url = URL.createObjectURL(new Blob([bytes(file.data)], { type: file.type })); const a = node('a'); a.href = url; a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function showLogin(step?: AuthResult): void {
  if (location.protocol.endsWith('-extension:') && !new URLSearchParams(location.search).has('window')) {
    const params = new URLSearchParams({ window: '1', signin: '1' });
    if (step) params.set('resume', step.accountId);
    void extension.tabs.create({ url: extension.runtime.getURL('ui.html?' + params) }); return;
  }
  loginStep = step; get('login-error').textContent = ''; input('password', ''); input('totp', '');
  get<HTMLInputElement>('username').required = !step;
  get<HTMLInputElement>('totp').required = step?.phase === 'totp';
  get('username').hidden = !!step; get('password-row').hidden = step?.phase === 'totp'; get<HTMLInputElement>('password').required = step?.phase !== 'totp'; get('totp-row').hidden = step?.phase !== 'totp';
  get('remember-row').hidden = !!step; get('remember-hint').hidden = !!step;
  get('login-submit').textContent = !step ? 'Connect account' : step.phase === 'totp' ? 'Verify code' : 'Unlock mailbox';
  get('login-title').textContent = step?.phase === 'mailbox' ? 'Unlock your mail.' : 'Your mail. Your space.';
  open('login-dialog'); get<HTMLInputElement>(step?.phase === 'totp' ? 'totp' : step?.phase === 'mailbox' ? 'password' : 'username').focus();
}
get('login-form').addEventListener('submit', event => {
  event.preventDefault(); void attempt(async () => {
    const button = get<HTMLButtonElement>('login-submit'); button.disabled = true; get('login-error').textContent = '';
    verificationId = crypto.randomUUID();
    get('login-error').textContent = 'Signing in. If Proton opens a verification tab, complete the challenge there.';
    const heartbeat = setInterval(() => { void call('verification-ping').catch(() => {}); }, 20_000);
    try {
      const result = !loginStep ? await call<AuthResult>('login', { username: value('username'), password: value('password'), remember: checked('remember'), totp: value('totp'), verificationId }) : await call<AuthResult>(loginStep.phase === 'totp' ? 'totp' : 'unlock', { accountId: loginStep.accountId, code: value('totp'), password: value('password'), verificationId });
      input('password', ''); if (result.phase === 'ready') { close('login-dialog'); loginStep = undefined; await update(true); notify('Mailbox connected'); } else { showLogin(result); await update(); }
    } catch (error) { get('login-error').textContent = error instanceof Error ? error.message : 'Sign-in failed'; }
    finally { clearInterval(heartbeat); verificationId = ''; input('password', ''); button.disabled = false; }
  });
});
async function fillAddresses(): Promise<void> {
  const addresses = await call<Pick<Address, 'ID' | 'Email' | 'Status'>[]>('addresses', { accountId: value('compose-account') }); const select = get<HTMLSelectElement>('compose-address'); select.replaceChildren();
  for (const address of addresses.filter(address => address.Status === 1)) { const option = node('option', address.Email); option.value = address.Email; select.append(option); }
}
async function compose(mode?: ComposeInput['action']): Promise<void> {
  const accounts = state.accounts.filter(account => account.status === 'ready'); if (!accounts.length) { showLogin(); return; }
  resetComposer();
  const select = get<HTMLSelectElement>('compose-account'); select.replaceChildren(); for (const account of accounts) { const option = node('option', account.label); option.value = account.id; select.append(option); }
  select.value = active && mode ? active.accountId : selectedAccount || accounts[0].id; await fillAddresses();
  ['compose-to', 'compose-cc', 'compose-bcc', 'compose-subject', 'compose-alias', 'delivery', 'expiry'].forEach(id => input(id, '')); get('editor').replaceChildren(); files = []; draftParent = {}; renderFiles();
  if (active && mode) {
    draftParent = { parentId: active.message.ID, action: mode };
    input('compose-subject', (mode === 'forward' ? 'Fwd: ' : 'Re: ') + active.message.Subject.replace(/^(?:re|fwd):\s*/iu, ''));
    if (mode !== 'forward') input('compose-to', active.message.Sender.Address);
    if (mode === 'reply-all') {
      const owned = state.accounts.map(account => account.email.toLocaleLowerCase());
      input('compose-cc', [...new Set([...(active.message.ToList || []), ...(active.message.CCList || [])].map(person => person.Address).filter(address => !owned.includes(address.toLocaleLowerCase()) && address !== active!.message.Sender.Address))].join(', '));
    }
    const quote = node('blockquote', '\n\n' + active.body.replace(/<[^>]*>/gu, ' ')); get('editor').append(quote);
  }
  open('compose-dialog'); get<HTMLInputElement>('compose-to').focus();
  void attempt(loadRecipientSuggestions);
}
function resetComposer(): void {
  ['compose-to', 'compose-cc', 'compose-bcc', 'compose-subject', 'compose-alias', 'delivery', 'expiry', 'files'].forEach(id => input(id, ''));
  get('editor').replaceChildren(); files = []; draftParent = {}; renderFiles();
  get('compose-title').textContent = 'A new message';
  get('compose-form').querySelectorAll('details').forEach(detail => { detail.open = false; });
  get('compose-form').scrollTop = 0;
}
function renderFiles(): void { const container = get('compose-files'); container.replaceChildren(); files.forEach((file, index) => { const button = node('button', file.name + ' ×'); button.type = 'button'; button.addEventListener('click', () => { files.splice(index, 1); renderFiles(); }); container.append(button); }); }
async function addFiles(list: FileList | null): Promise<void> {
  if (!list) return;
  if ([...list].reduce((sum, file) => sum + file.size, 0) + files.reduce((sum, file) => sum + file.data.length * .75, 0) > 20_000_000) throw new Error('Attachments exceed the current total 20 MB limit.');
  for (const file of list) files.push({ name: file.name, type: file.type, data: base64(new Uint8Array(await file.arrayBuffer())) }); renderFiles();
}
get('compose-form').addEventListener('submit', event => { event.preventDefault(); void attempt(async () => {
  const send = get<HTMLButtonElement>('send'); if (send.disabled) return; send.disabled = true;
  try {
    if (!await confirmAlert('Send this message through your Proton account?', 'Send message', 'send')) return;
    const message: ComposeInput = { accountId: value('compose-account'), from: value('compose-alias').trim() || value('compose-address'), to: value('compose-to'), cc: value('compose-cc'), bcc: value('compose-bcc'), subject: value('compose-subject'),
      html: DOMPurify.sanitize(get('editor').innerHTML), files, ...draftParent,
      deliveryTime: value('delivery') ? Math.floor(new Date(value('delivery')).getTime() / 1000) : undefined, expiresIn: value('expiry') ? Number(value('expiry')) * 3600 : undefined };
    if (message.deliveryTime && message.deliveryTime < Date.now() / 1000 + 60) throw new Error('Choose a delivery time at least a minute in the future.');
    await call('send', { accountId: message.accountId, message, confirmed: true });
    const key = 'quickcodeRecipients:' + message.accountId;
    const addresses = [message.to, message.cc, message.bcc].join(',').split(/[,;\n]/u).map(address => address.trim()).filter(Boolean);
    try {
      const old = (await extension.storage.local.get(key))[key];
      await extension.storage.local.set({ [key]: [...new Set([...addresses, ...(Array.isArray(old) ? old : [])])].slice(0, 200) });
    } catch { /* A local suggestion-cache failure must not report a delivered message as failed. */ }
    close('compose-dialog'); resetComposer(); notify(message.deliveryTime ? 'Message scheduled' : 'Message sent');
  } finally { send.disabled = false; }
}); });
get('compose-account').addEventListener('change', () => { void attempt(fillAddresses); void attempt(loadRecipientSuggestions); });
get('files').addEventListener('change', () => { void attempt(() => addFiles(get<HTMLInputElement>('files').files)); });
get('drop-zone').addEventListener('dragover', event => event.preventDefault()); get('drop-zone').addEventListener('drop', event => { event.preventDefault(); void attempt(() => addFiles(event.dataTransfer?.files || null)); });
document.querySelectorAll<HTMLButtonElement>('[data-format]').forEach(button => { button.addEventListener('mousedown', event => event.preventDefault()); button.addEventListener('click', () => { document.execCommand(button.dataset.format!); }); });
get('insert-link').addEventListener('mousedown', event => event.preventDefault()); get('insert-link').addEventListener('click', () => { const url = prompt('Link URL (https://)'); if (url && /^https:\/\//iu.test(url)) document.execCommand('createLink', false, url); });
async function runAction(action: string, ids: string[], accountId: string): Promise<void> {
  const confirmed = action === 'delete' ? await confirmAlert('Permanently delete ' + ids.length + ' message(s)? This cannot be undone.', 'Delete permanently') : true; if (!confirmed) return;
  state = await call<Dashboard>('action', { accountId, action, ids, confirmed }); selected.clear(); if (active && ids.includes(active.message.ID) && ['archive', 'trash', 'spam', 'delete'].includes(action)) get('reader').hidden = true; render(); notify('Action completed');
}
get('bulk-run').addEventListener('click', () => { void attempt(async () => { const first = state.items.find(item => selected.has(item.message.ID)); if (first) await runAction(value('bulk-action'), [...selected], first.accountId); }); });
get('selection-clear').addEventListener('click', () => { selected.clear(); render(); });
document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => button.addEventListener('click', () => { if (active) void attempt(() => runAction(button.dataset.action!, [active!.message.ID], active!.accountId)); }));
get('reader-close').addEventListener('click', () => { get('reader').hidden = true; active = undefined; });
get('raw-toggle').addEventListener('click', () => { raw = !raw; renderBody(); }); get('allow-remote').addEventListener('click', () => { remote = true; renderBody(); });
get('reply').addEventListener('click', () => { void attempt(() => compose('reply')); }); get('reply-all').addEventListener('click', () => { void attempt(() => compose('reply-all')); }); get('forward').addEventListener('click', () => { void attempt(() => compose('forward')); });
get('open-proton').addEventListener('click', () => { void extension.tabs.create({ url: 'https://mail.proton.me' }); });
get('export-eml').addEventListener('click', () => { if (active) void attempt(async () => download(await call('export-eml', { accountId: active!.accountId, messageId: active!.message.ID }))); });
get('add-account').addEventListener('click', () => showLogin()); get('refresh').addEventListener('click', () => { void attempt(() => update(true)); }); get('compose-open').addEventListener('click', () => { void attempt(() => compose()); });
get('search').addEventListener('input', () => { visibleLimit = 5; render(); });
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => { view = button.dataset.view!; visibleLimit = 5; document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(item => item.setAttribute('aria-pressed', String(item === button))); render(); }));
async function closeComposer(): Promise<void> {
  if (get<HTMLButtonElement>('send').disabled) { notify('Wait for the send attempt to finish'); return; }
  const dirty = !!get('editor').textContent?.trim() || files.length > 0 || ['compose-to', 'compose-cc', 'compose-bcc', 'compose-subject'].some(id => value(id).trim());
  if (dirty && !await confirmAlert('Close the composer and discard this unsent message?', 'Discard message')) return;
  close('compose-dialog'); resetComposer();
}
document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.close === 'compose-dialog') void attempt(closeComposer); else close(button.dataset.close!);
}));
get('compose-dialog').addEventListener('cancel', event => { event.preventDefault(); void attempt(closeComposer); });
function patternRows(): void {
  const container = get('patterns'); container.replaceChildren();
  for (const pattern of patterns) {
    const row = node('div', undefined, 'rule-row'); const enabled = node('input'); enabled.type = 'checkbox'; enabled.checked = pattern.enabled; enabled.setAttribute('aria-label', 'Enable pattern'); enabled.onchange = () => { pattern.enabled = enabled.checked; };
    const name = node('input'); name.value = pattern.name; name.placeholder = 'Name'; name.setAttribute('aria-label', 'Pattern name'); name.oninput = () => { pattern.name = name.value; };
    const expression = node('input'); expression.value = pattern.expression; expression.placeholder = 'code: (\\d{6})'; expression.setAttribute('aria-label', 'Pattern expression'); expression.oninput = () => { pattern.expression = expression.value; };
    const remove = node('button', '×'); remove.type = 'button'; remove.setAttribute('aria-label', 'Remove pattern'); remove.onclick = () => { patterns = patterns.filter(item => item !== pattern); patternRows(); }; row.append(enabled, name, expression, remove); container.append(row);
  }
}
function quietRows(): void {
  const container = get('quiet-rules'); container.replaceChildren();
  for (const rule of quiet) {
    const row = node('div', undefined, 'rule-row'); const enabled = node('input'); enabled.type = 'checkbox'; enabled.checked = rule.enabled; enabled.setAttribute('aria-label', 'Enable quiet rule'); enabled.onchange = () => { rule.enabled = enabled.checked; };
    const field = node('select'); for (const name of ['sender', 'subject'] as const) { const option = node('option', name); option.value = name; field.append(option); } field.value = rule.field; field.onchange = () => { rule.field = field.value as QuietRule['field']; }; field.setAttribute('aria-label', 'Quiet rule field');
    const contains = node('input'); contains.value = rule.contains; contains.placeholder = 'Contains…'; contains.setAttribute('aria-label', 'Quiet rule text'); contains.oninput = () => { rule.contains = contains.value; };
    const remove = node('button', '×'); remove.type = 'button'; remove.setAttribute('aria-label', 'Remove quiet rule'); remove.onclick = () => { quiet = quiet.filter(item => item !== rule); quietRows(); }; row.append(enabled, field, contains, remove); container.append(row);
  }
}
const resetAlerts = node('button', 'Reset confirmation alerts'); resetAlerts.type = 'button';
resetAlerts.addEventListener('click', () => { void attempt(async () => { await extension.storage.local.set({ quickcodeAlertPreferences: {} }); notify('Confirmation alerts restored'); }); });
get('preferences-form').append(resetAlerts);
const diagnostics = node('button', 'Copy background diagnostics'); diagnostics.type = 'button';
diagnostics.addEventListener('click', () => { void attempt(async () => {
  const report = await call('background-diagnostics'); await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); notify('Background diagnostics copied (no account addresses or message content)');
}); }); get('preferences-form').append(diagnostics);
async function showSettings(): Promise<void> {
  const settings = state.settings;
  for (const key of ['scheme', 'theme', 'density', 'width', 'height', 'limit'] as const) input(key, settings[key]);
  input('poll-seconds', settings.pollSeconds); input('custom-css', settings.customCSS); input('app-version', settings.appVersion); input('otp-min', settings.otp.minimum); input('otp-max', settings.otp.maximum);
  toggle('notifications', settings.notifications); toggle('otp-enabled', settings.otp.enabled); toggle('otp-built-in', settings.otp.builtIn); toggle('otp-context', settings.otp.context); toggle('otp-custom', settings.otp.custom); input('dnd', 0);
  patterns = structuredClone(settings.otp.patterns); quiet = structuredClone(settings.quiet); patternRows(); quietRows();
  const container = get('account-settings'); container.replaceChildren();
  for (const account of state.accounts) {
    const group = node('fieldset'); group.dataset.account = account.id; group.append(node('legend', account.label));
    const label = node('label', 'Label'); const labelInput = node('input'); labelInput.value = account.label; labelInput.dataset.field = 'label'; label.append(labelInput);
    const colorLabel = node('label', 'Colour'); const color = node('input'); color.type = 'color'; color.value = account.color; color.dataset.field = 'color'; colorLabel.append(color);
    const notifications = node('label', 'Mail notifications', 'check'); const enabled = node('input'); enabled.type = 'checkbox'; enabled.checked = settings.accounts[account.id]?.notifications !== false; enabled.dataset.field = 'notifications'; notifications.prepend(enabled);
    const otpLabel = node('label', 'Code notifications'); const otp = node('select'); otp.dataset.field = 'otp'; for (const [value, title] of [['inherit', 'Global setting'], ['on', 'On'], ['off', 'Off']]) { const option = node('option', title); option.value = value; otp.append(option); } otp.value = settings.accounts[account.id]?.otp?.enabled === undefined ? 'inherit' : settings.accounts[account.id].otp!.enabled ? 'on' : 'off'; otpLabel.append(otp);
    const foldersLabel = node('label', 'Monitored folders'); const folders = node('select'); folders.multiple = true; folders.dataset.field = 'folders'; const inbox = node('option', 'Inbox'); inbox.value = '0'; folders.append(inbox);
    if (account.status === 'ready') try { for (const label of await call<Label[]>('labels', { accountId: account.id })) { const option = node('option', label.Name); option.value = label.ID; folders.append(option); } } catch { /* Keep Inbox available when label listing fails. */ }
    for (const option of folders.options) option.selected = (settings.accounts[account.id]?.folders || ['0']).includes(option.value); foldersLabel.append(folders);
    const forget = node('button', 'Disconnect account'); forget.type = 'button'; forget.onclick = () => { if (confirm('Disconnect this account from QuickCode?')) void attempt(async () => { state = await call<Dashboard>('forget', { accountId: account.id }); group.remove(); render(); }); };
    group.append(label, colorLabel, notifications, otpLabel, foldersLabel, forget); container.append(group);
  }
  open('preferences-dialog');
}
get('settings-open').addEventListener('click', () => { void attempt(showSettings); });
get('pattern-add').addEventListener('click', () => { patterns.push({ id: crypto.randomUUID(), name: '', expression: '', flags: 'i', enabled: true }); patternRows(); });
get('quiet-add').addEventListener('click', () => { quiet.push({ id: crypto.randomUUID(), field: 'sender', contains: '', enabled: true }); quietRows(); });
get('preferences-form').addEventListener('submit', event => { event.preventDefault(); void attempt(async () => {
  for (const pattern of patterns) { if (pattern.expression.length > 250) throw new Error('Keep custom patterns under 250 characters.'); new RegExp(pattern.expression, 'giu'); }
  const settings: Preferences = { ...state.settings, scheme: value('scheme') as Preferences['scheme'], theme: value('theme') as Preferences['theme'], density: value('density') as Preferences['density'],
    width: Number(value('width')), height: Number(value('height')), limit: Number(value('limit')), pollSeconds: Number(value('poll-seconds')), customCSS: value('custom-css'), appVersion: value('app-version'),
    notifications: checked('notifications'), otp: { enabled: checked('otp-enabled'), builtIn: checked('otp-built-in'), context: checked('otp-context'), custom: checked('otp-custom'), minimum: Number(value('otp-min')), maximum: Number(value('otp-max')), patterns },
    quiet: quiet.filter(rule => rule.contains.trim()), dndUntil: Number(value('dnd')) ? Date.now() + Number(value('dnd')) * 60000 : 0, accounts: { ...state.settings.accounts } };
  for (const group of get('account-settings').querySelectorAll<HTMLFieldSetElement>('fieldset')) {
    const field = <T extends HTMLInputElement | HTMLSelectElement>(name: string) => group.querySelector<T>('[data-field="' + name + '"]')!;
    const id = group.dataset.account!; const otpValue = field<HTMLSelectElement>('otp').value;
    settings.accounts[id] = { ...settings.accounts[id], label: field<HTMLInputElement>('label').value, color: field<HTMLInputElement>('color').value, notifications: field<HTMLInputElement>('notifications').checked,
      folders: [...field<HTMLSelectElement>('folders').selectedOptions].map(option => option.value), otp: otpValue === 'inherit' ? undefined : { ...settings.accounts[id]?.otp, enabled: otpValue === 'on' } };
    if (!settings.accounts[id].folders.length) settings.accounts[id].folders = ['0'];
  }
  state = await call<Dashboard>('settings', { value: settings }); render(); close('preferences-dialog'); notify('Preferences saved');
}); });
get('settings-export').addEventListener('click', () => download({ name: 'quickcode-settings.json', type: 'application/json', data: base64(new TextEncoder().encode(JSON.stringify(state.settings, null, 2))) }));
get('settings-import').addEventListener('change', () => { void attempt(async () => { const file = get<HTMLInputElement>('settings-import').files?.[0]; if (!file) return; if (file.size > 200_000) throw new Error('Settings file is too large.'); state = await call<Dashboard>('settings', { value: JSON.parse(await file.text()) }); render(); close('preferences-dialog'); notify('Preferences imported'); }); });
get('sync-save').addEventListener('click', () => { void attempt(async () => { await call('sync-export'); notify('Preferences saved to browser sync'); }); });
get('sync-load').addEventListener('click', () => { void attempt(async () => { state = await call<Dashboard>('sync-import'); render(); close('preferences-dialog'); notify('Preferences loaded from browser sync'); }); });
document.addEventListener('keydown', event => {
  const target = event.target as HTMLElement; if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable || document.querySelector('dialog[open]')) return;
  const rows = [...document.querySelectorAll<HTMLElement>('.mail-row')]; const focused = rows.indexOf(document.activeElement as HTMLElement);
  if (event.key === '/') { event.preventDefault(); get('search').focus(); }
  if (event.key === 'j' || event.key === 'k') { event.preventDefault(); rows[Math.max(0, Math.min(rows.length - 1, focused + (event.key === 'j' ? 1 : -1)))]?.focus(); }
  if (event.key === 'Enter' && focused >= 0) rows[focused].click();
  if (event.key === 'c') void attempt(() => compose()); if (event.key === 'r' && active) void attempt(() => compose('reply'));
  if (event.key === 'Escape') get('reader').hidden = true;
});
async function openNotificationTarget(): Promise<boolean> {
  if (new URLSearchParams(location.search).has('window')) return false;
  const target = await call<{ accountId: string; messageId: string } | null>('notification-target');
  if (!target?.accountId || !target.messageId) return false;
  await read({ accountId: target.accountId, message: { ID: target.messageId } } as MailItem); return true;
}
extension.runtime.onMessage.addListener(message => {
  if (message?.quickcodeUpdate) void attempt(() => update());
  if (message?.quickcodeOpenMessage) void attempt(openNotificationTarget);
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', appearance);
void attempt(async () => {
  await update();
  await openNotificationTarget();
  const params = new URLSearchParams(location.search); const id = params.get('message'), accountId = params.get('account');
  if (params.has('signin')) {
    const pending = state.accounts.find(account => account.id === params.get('resume') && account.status !== 'ready');
    showLogin(pending ? { accountId: pending.id, phase: pending.status === 'totp' ? 'totp' : 'mailbox' } : undefined);
  }
  if (id && accountId) await read({ accountId, message: { ID: id } } as MailItem);
  else if (state.accounts.some(account => account.status === 'ready')) void attempt(() => update(true));
});
