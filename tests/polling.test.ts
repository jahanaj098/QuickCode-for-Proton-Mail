import { describe, it, expect, vi } from 'vitest';
describe('Alarm and cold-worker behavior', () => {
  it('restores dedupe state and does not notify the same arriving mail after a worker restart', async () => {
    const old = { ID: 'old', ConversationID: 'old', Subject: 'Older mail', Sender: { Address: 'sender@example.test' }, Time: 1, Unread: 1, LabelIDs: ['0'] };
    const fresh = { ...old, ID: 'new', ConversationID: 'new', Time: 2, Subject: 'OTP: 583920' };
    const session: Record<string, unknown> = { sessions: [{ id: 'account', uid: 'uid', username: 'fixture', label: 'Fixture', color: '#177668', access: 'fake', refresh: 'fake', phase: 'ready', remember: false, keyPassword: 'derived' }],
      snapshot: { account: [{ accountId: 'account', message: old, preview: '', codes: [] }] }, seen: ['old'], seeded: ['account'] };
    const alarms: ((alarm: { name: string }) => void)[] = [];
    const incoming: ((message: unknown, sender: unknown, respond: (response: any) => void) => boolean)[] = [];
    const create = vi.fn(async () => 'notification');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('mail/v4/messages?') ? { Code: 1000, Messages: [fresh, old] } : { Code: 1000, Message: { ...fresh, Body: '' } })));
    const event = () => ({ addListener() {} });
    vi.stubGlobal('chrome', {
      runtime: { id: 'fixture', onMessage: { addListener: (listener: any) => incoming.push(listener) }, onStartup: event(), onInstalled: event(), sendMessage: async () => {} },
      tabs: { onRemoved: event() },
      storage: { local: { get: async () => ({}), remove: async () => {}, set: async () => {} }, session: {
        get: async (key: string | string[]) => Object.fromEntries((Array.isArray(key) ? key : [key]).map(id => [id, session[id]])),
        set: async (value: Record<string, unknown>) => { Object.assign(session, value); },
      } }, permissions: { contains: async () => true },
      alarms: { create: async () => {}, onAlarm: { addListener: (listener: any) => alarms.push(listener) } },
      notifications: { create, onClicked: event(), onButtonClicked: event() }, action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    });
    const dashboard = () => new Promise<any>(resolve => incoming.at(-1)!({ quickcode: 1, operation: 'dashboard' }, { id: 'fixture' }, resolve));
    await import('../src/background/main'); await dashboard();
    alarms.at(-1)!({ name: 'quickcode-poll' });
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(session.seen).toContain('new'));
    vi.resetModules(); await import('../src/background/main'); await dashboard();
    alarms.at(-1)!({ name: 'quickcode-poll' });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(create).toHaveBeenCalledOnce();
    const response = await dashboard(); expect(response.value.items).toHaveLength(2);
    expect(JSON.stringify(response)).not.toContain('derived'); expect(JSON.stringify(response)).not.toContain('"access"');
  });
});
