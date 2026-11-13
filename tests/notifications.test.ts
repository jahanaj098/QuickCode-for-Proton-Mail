import { describe, it, expect, vi } from 'vitest';
import { defaults, type MailItem } from '../src/core/model';
const storage: Record<string, unknown> = {};
const create = vi.fn(async (_id: string, _options: chrome.notifications.NotificationCreateOptions) => 'id');
const openPopup = vi.fn(async () => {}), createWindow = vi.fn();
vi.stubGlobal('chrome', {
  storage: { session: { get: async (id: string) => ({ [id]: storage[id] }), set: async (value: Record<string, unknown>) => { Object.assign(storage, value); } } },
  permissions: { contains: async () => true }, notifications: { create, clear: vi.fn() },
  windows: { getLastFocused: async () => ({ id: 7 }), update: vi.fn(async () => {}), create: createWindow },
  action: { openPopup }, runtime: { getURL: (path: string) => 'chrome-extension://fixture/' + path, sendMessage: async () => {} },
});
const { Notifications } = await import('../src/background/notifications');
const mail: MailItem = { accountId: 'account', preview: 'DO NOT LEAK THIS BODY', codes: [{ value: 'Ab12Cd', score: 1, position: 1, distance: 1, source: 'body' }], message: { ID: 'message', ConversationID: 'conversation', Subject: 'Sign in', Sender: { Name: 'Sender', Address: 'sender@example.test' }, Time: 1, Unread: 1, LabelIDs: ['0'] } };
describe('Private notification policy', () => {
  it('redacts snippets and provides a copy button for the primary code', async () => {
    create.mockClear(); const notifier = new Notifications(defaults); await notifier.show(mail);
    const options = create.mock.calls[0][1] as unknown as chrome.notifications.NotificationCreateOptions;
    expect(options.message).toBe('Sender — Sign in\nCode: Ab12Cd'); expect(JSON.stringify(options)).not.toContain('DO NOT LEAK');
    expect(options.buttons?.[0].title).toBe('Copy code');
  });
  it('suppresses DND, quiet rules and disabled accounts', async () => {
    create.mockClear();
    for (const settings of [{ ...defaults(), dndUntil: Date.now() + 10000 }, { ...defaults(), accounts: { account: { folders: ['0'], notifications: false } } }, { ...defaults(), quiet: [{ id: 'q', field: 'sender' as const, contains: 'sender@', enabled: true }] }]) await new Notifications(() => settings).show(mail);
    expect(create).not.toHaveBeenCalled();
  });
  it('degrades to a normal new-mail notification when OTP is disabled', async () => {
    create.mockClear(); const settings = defaults(); settings.otp.enabled = false; await new Notifications(() => settings).show(mail);
    const options = create.mock.calls[0][1] as unknown as chrome.notifications.NotificationCreateOptions;
    expect(options.buttons).toBeUndefined(); expect(options.message).toBe('Sender — Sign in');
  });
  it('opens the toolbar popup on Open, with a queued message and no separate window', async () => {
    const notifier = new Notifications(defaults); await notifier.show(mail);
    const id = create.mock.calls.at(-1)![0]; await notifier.event(id, 1);
    expect(openPopup).toHaveBeenCalledWith({ windowId: 7 }); expect(createWindow).not.toHaveBeenCalled();
    expect(storage.pendingNotification).toMatchObject({ accountId: 'account', messageId: 'message' });
  });
  it('keeps the selected message for manual toolbar opening when the browser rejects openPopup', async () => {
    openPopup.mockRejectedValueOnce(new Error('gesture required'));
    const notifier = new Notifications(defaults); await notifier.open({ accountId: 'account', messageId: 'message' });
    expect(storage.pendingNotification).toMatchObject({ messageId: 'message' }); expect(createWindow).not.toHaveBeenCalled();
  });
  it('leaves a rejected notification eligible for retry', async () => {
    create.mockRejectedValueOnce(new Error('Temporary browser failure'));
    const notifier = new Notifications(defaults);
    expect(await notifier.show(mail)).toBe(false);
    expect(storage.notificationHealth).toMatchObject({ status: 'browser-rejected' });
    expect(await notifier.show(mail)).toBe(true);
    expect(storage.notificationHealth).toMatchObject({ status: 'created' });
  });
});
