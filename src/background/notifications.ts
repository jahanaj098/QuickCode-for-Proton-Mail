// Copyright (c) 2026 jahanaj098. SPDX-License-Identifier: GPL-3.0-only
import { extension } from '../core/platform';
import { notificationKey } from '../core/otp';
import type { MailItem, Preferences } from '../core/model';
interface NotificationTarget { accountId: string; messageId: string; code?: string }
declare const QUICKCODE_NOTIFICATION_ICON: string;
export class Notifications {
  private warned = false;
  private creating: Promise<void> | undefined;
  constructor(private settings: () => Preferences) {}
  private async targets(): Promise<Record<string, NotificationTarget>> {
    return (await extension.storage.session.get('notificationTargets')).notificationTargets as Record<string, NotificationTarget> || {};
  }
  async show(item: MailItem): Promise<boolean> {
    const record = (status: string, reason?: string) => extension.storage.session.set({ notificationHealth: { attemptedAt: Date.now(), status, ...(reason ? { reason } : {}) } });
    const settings = this.settings(); const account = settings.accounts[item.accountId];
    if (!settings.notifications || settings.dndUntil > Date.now() || account?.notifications === false) { await record('suppressed-by-settings'); return true; }
    const silenced = settings.quiet.some(rule => rule.enabled && (!rule.accountId || rule.accountId === item.accountId) &&
      (rule.field === 'sender' ? item.message.Sender.Address : item.message.Subject).toLocaleLowerCase().includes(rule.contains.toLocaleLowerCase()));
    if (silenced) { await record('suppressed-by-quiet-rule'); return true; }
    if (!extension.notifications || !await extension.permissions.contains({ permissions: ['notifications'] })) {
      await record('permission-unavailable');
      if (!this.warned) { console.info('QuickCode: desktop notifications are unavailable.'); this.warned = true; } return true;
    }
    const id = await notificationKey(item.message.ID);
    const otp = { ...settings.otp, ...account?.otp }; const code = otp.enabled ? item.codes[0]?.value : undefined;
    const sender = (item.message.Sender.Name || item.message.Sender.Address).replace(/[\r\n]/gu, ' ').slice(0, 60);
    const subject = item.message.Subject.replace(/[\r\n]/gu, ' ').slice(0, 60);
    const options: chrome.notifications.NotificationCreateOptions = {
      type: 'basic', iconUrl: typeof QUICKCODE_NOTIFICATION_ICON === 'string' ? QUICKCODE_NOTIFICATION_ICON : extension.runtime.getURL('icons/128.png'), title: code ? 'QuickCode · Verification code' : 'QuickCode · New mail',
      message: sender + ' — ' + subject + (code ? '\nCode: ' + code + (item.codes.length > 1 ? ' (+' + (item.codes.length - 1) + ' more)' : '') : ''),
    };
    if (code && typeof window === 'undefined') {
      options.buttons = [{ title: 'Copy code' }, { title: 'Open' }]; options.contextMessage = item.codes.map(code => code.value).join(', ');
    } else if (code && item.codes.length > 1) options.message += '\n' + item.codes.map(code => code.value).join(', ');
    const targets = await this.targets(); targets[id] = { accountId: item.accountId, messageId: item.message.ID, code };
    const recent = Object.fromEntries(Object.entries(targets).slice(-100));
    await extension.storage.session.set({ notificationTargets: recent });
    try { await extension.notifications.create(id, options); await record('created'); return true; } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const reason = /image|icon|download/iu.test(message) ? 'icon-load-failed' : /permission|disabled|allowed/iu.test(message) ? 'permission-or-policy' : 'browser-error';
      await record('browser-rejected', reason); if (!this.warned) { console.info('QuickCode: the browser could not display a notification (' + reason + ').'); this.warned = true; } return false;
    }
  }
  async open(target: NotificationTarget): Promise<boolean> {
    await extension.storage.session.set({ pendingNotification: { accountId: target.accountId, messageId: target.messageId, requestedAt: Date.now() } });
    try {
      const window = await extension.windows.getLastFocused({ windowTypes: ['normal'] });
      if (window.id !== undefined) await extension.windows.update(window.id, { focused: true });
      await extension.action.openPopup(window.id === undefined ? {} : { windowId: window.id });
      void extension.runtime.sendMessage({ quickcodeOpenMessage: true }).catch(() => {});
      return true;
    } catch {
      // Some browser versions require a direct toolbar gesture. Keep the target
      // for the next toolbar open, rather than opening a separate page.
      console.info('QuickCode: click the toolbar icon to open the selected message.');
      return false;
    }
  }
  async event(id: string, button?: number): Promise<void> {
    const targets = await this.targets(); const target = targets[id]; if (!target) return;
    if (button === 0 && target.code) {
      try {
        if (typeof window !== 'undefined') await navigator.clipboard.writeText(target.code);
        else {
          if (!await extension.offscreen.hasDocument()) {
            this.creating ??= extension.offscreen.createDocument({ url: 'clipboard.html', reasons: ['CLIPBOARD' as chrome.offscreen.Reason], justification: 'Copy the verification code requested by the user' }).finally(() => { this.creating = undefined; });
            await this.creating;
          }
          const result = await extension.runtime.sendMessage({ clipboard: true, code: target.code });
          if (!result?.copied) throw new Error('Clipboard unavailable');
        }
      } catch { await this.open(target); return; }
    } else if (!await this.open(target)) return;
    await extension.notifications.clear(id); delete targets[id]; await extension.storage.session.set({ notificationTargets: targets });
  }
}
