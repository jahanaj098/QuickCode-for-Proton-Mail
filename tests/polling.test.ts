import { describe, it, expect, vi } from 'vitest';
describe('Alarm and cold-worker behavior', () => {
  it('restores dedupe state and does not notify the same arriving mail after a worker restart', async () => {
    const old = { ID: 'old', ConversationID: 'old', Subject: 'Older mail', Sender: { Address: 'sender@example.test' }, Time: 1, Unread: 1, LabelIDs: ['0'] };
    const fresh = { ...old, ID: 'new', ConversationID: 'new', Time: 2, Subject: 'Sign-in verification' };
    const session: Record<string, unknown> = { sessions: [{ id: 'account', uid: 'uid', username: 'fixture', label: 'Fixture', color: '#177668', access: 'fake', refresh: 'fake', phase: 'ready', remember: false, keyPassword: 'derived' }],
      snapshot: { account: [{ accountId: 'account', message: old, preview: '', codes: [] }] }, seen: ['old'], seeded: ['account'], checkedAt: Date.now() };
    const alarms: ((alarm: { name: string }) => void)[] = [];
    const incoming: ((message: unknown, sender: unknown, respond: (response: any) => void) => boolean)[] = [];
    const create = vi.fn(async () => 'notification');
    const local: Record<string, unknown> = { badgeAccount: 'account' };
    const badge = vi.fn(async () => {});
    let failBody = true, markedRead = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/messages/read')) { markedRead = true; return Response.json({ Code: 1000 }); }
      if (url.endsWith('/messages/new') && failBody) { failBody = false; return Response.json({ Code: 503, Error: 'Temporary body failure' }, { status: 503 }); }
      return Response.json(url.includes('messages/count') ? { Code: 1000, Counts: [{ LabelID: '0', Unread: markedRead ? 141 : 142 }] } : url.includes('mail/v4/messages?') ? { Code: 1000, Messages: markedRead ? [old] : [fresh, old] } : { Code: 1000, Message: { ...fresh, Body: 'Your verification code is 583920.' } });
    }));
    const event = () => ({ addListener() {} });
    vi.stubGlobal('chrome', {
      runtime: { id: 'fixture', getURL: (path: string) => 'chrome-extension://fixture/' + path, onMessage: { addListener: (listener: any) => incoming.push(listener) }, onStartup: event(), onInstalled: event(), sendMessage: async () => {} },
      tabs: { onRemoved: event() },
      storage: { local: { get: async (key: string | string[]) => Object.fromEntries((Array.isArray(key) ? key : [key]).map(id => [id, local[id]])), remove: async () => {}, set: async (value: Record<string, unknown>) => { Object.assign(local, value); } }, session: {
        get: async (key: string | string[]) => Object.fromEntries((Array.isArray(key) ? key : [key]).map(id => [id, session[id]])),
        set: async (value: Record<string, unknown>) => { Object.assign(session, value); },
      } }, permissions: { contains: async () => true },
      alarms: { get: async () => ({ periodInMinutes: 1 }), create: async () => {}, onAlarm: { addListener: (listener: any) => alarms.push(listener) } },
      notifications: { create, onClicked: event(), onButtonClicked: event() }, action: { setBadgeText: badge, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
    });
    const dashboard = () => new Promise<any>(resolve => incoming.at(-1)!({ quickcode: 1, operation: 'dashboard' }, { id: 'fixture' }, resolve));
    const selectAccount = (id: string) => new Promise<any>(resolve => incoming.at(-1)!({ quickcode: 1, operation: 'select-account', data: { accountId: id } }, { id: 'fixture' }, resolve));
    await import('../src/background/main');
    // No dashboard/popup request: worker bootstrap and alarms must work alone.
    alarms.at(-1)!({ name: 'quickcode-poll' });
    await vi.waitFor(() => expect((session.backgroundHealth as { result?: string })?.result).toBe('partial'));
    expect(create).not.toHaveBeenCalled(); expect(session.seen).not.toContain('new');
    alarms.at(-1)!({ name: 'quickcode-poll' });
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0]).toBeDefined();
    await vi.waitFor(() => expect(session.seen).toContain('new'));
    await vi.waitFor(() => expect(badge).toHaveBeenLastCalledWith({ text: '142' }));
    expect((await dashboard()).value.selectedAccount).toBe('account');
    await selectAccount(''); expect(local.badgeAccount).toBe('');
    await selectAccount('account'); expect(local.badgeAccount).toBe('account');
    vi.resetModules(); await import('../src/background/main');
    alarms.at(-1)!({ name: 'quickcode-poll' });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(create).toHaveBeenCalledOnce();
    const response = await dashboard(); expect(response.value.items).toHaveLength(2);
    expect(response.value.selectedAccount).toBe('account'); expect(badge).toHaveBeenLastCalledWith({ text: '142' });
    expect(JSON.stringify(response)).not.toContain('derived'); expect(JSON.stringify(response)).not.toContain('"access"');
    const opened = await new Promise<any>(resolve => incoming.at(-1)!({ quickcode: 1, operation: 'read', data: { accountId: 'account', messageId: 'new' } }, { id: 'fixture' }, resolve));
    expect(opened.ok).toBe(true); expect(opened.value.message.Unread).toBe(0); expect(markedRead).toBe(true);
    expect(badge).toHaveBeenLastCalledWith({ text: '141' });
    expect((await dashboard()).value.items).toHaveLength(1);
  });
});
