import { describe, it, expect } from 'vitest';
import { Mailbox } from '../src/proton/mail';
import { defaults, type Credential, type WireMessage } from '../src/core/model';
import type { Keyring } from '../src/proton/keys';
import type { ProtonTransport } from '../src/proton/api';
describe('latest mail list', () => {
  it('includes newer read mail ahead of old unread mail and requests newest-first results', async () => {
    const old: WireMessage = { ID: 'old', ConversationID: 'old', Subject: 'December 2025', Time: Date.UTC(2025, 11, 20) / 1000, Unread: 1, Sender: { Address: 'old@example.test' }, LabelIDs: ['0'] };
    const recent = Array.from({ length: 6 }, (_, i) => ({ ...old, ID: 'recent-' + i, Time: Date.UTC(2026, 10, 13, i) / 1000, Unread: 0 }));
    let query!: URL;
    const api = { request: async (route: string) => { query = new URL('https://mail.proton.me/api/' + route); return { Messages: [old, ...recent] }; } } as unknown as ProtonTransport;
    const mailbox = new Mailbox(api, {} as Keyring, () => ({ ...defaults(), limit: 5 }));
    const result = await mailbox.list({ id: 'account' } as Credential);
    expect(query.searchParams.has('Unread')).toBe(false); expect(query.searchParams.get('Sort')).toBe('Time'); expect(query.searchParams.get('Desc')).toBe('1');
    expect(result.map(item => item.message.ID)).toEqual(['recent-5', 'recent-4', 'recent-3', 'recent-2', 'recent-1']);
    expect(result.every(item => item.message.Unread === 0)).toBe(true);
  });
});
