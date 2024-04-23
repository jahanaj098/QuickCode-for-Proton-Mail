import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/proton/sdk.js', () => ({ getSrp: vi.fn(async () => ({ clientEphemeral: 'ephemeral', clientProof: 'client-proof', expectedServerProof: 'verified-proof' })), computeKeyPassword: vi.fn() }));
import { StandaloneLogin } from '../src/proton/login';
import type { ProtonTransport } from '../src/proton/api';
import type { Keyring } from '../src/proton/keys';
import type { Credential } from '../src/core/model';
function build(proof = 'verified-proof', twoFactor = false) {
  const requests: { route: string; input: unknown }[] = [];
  const api = { request: vi.fn(async (route, input) => { requests.push({ route, input });
    if (route.endsWith('/info')) return { Version: 4, SRPSession: 'challenge' };
    if (route.endsWith('/2fa')) return { Code: 1000 };
    return { UID: 'uid', AccessToken: 'token', RefreshToken: 'refresh', ServerProof: proof, PasswordMode: 1, '2FA': { Enabled: twoFactor ? 1 : 0 } };
  }) } as unknown as ProtonTransport;
  const keys = { unlock: vi.fn(async (session: Credential) => { session.keyPassword = 'derived'; return { user: { Name: 'Me' } }; }) } as unknown as Keyring;
  const sessions = new Map<string, Credential>(); const writes: string[] = [];
  const auth = new StandaloneLogin(api, keys, sessions, async session => { writes.push(JSON.stringify(session)); });
  return { auth, requests, sessions, writes, keys };
}
describe('Standalone sign-in orchestration', () => {
  it('verifies the server proof before saving any session', async () => {
    const test = build('tampered'); await expect(test.auth.start('me', 'password-secret', false)).rejects.toThrow('server proof');
    expect(test.writes).toEqual([]); expect(test.sessions.size).toBe(0);
  });
  it('never sends the password to the API or stores it in the credential object', async () => {
    const test = build(); const result = await test.auth.start('me', 'password-secret', false);
    expect(result.phase).toBe('ready'); expect(JSON.stringify(test.requests)).not.toContain('password-secret'); expect(test.writes.join('')).not.toContain('password-secret');
  });
  it('can resume TOTP without retaining the initial password', async () => {
    const test = build('verified-proof', true); const result = await test.auth.start('me', 'password-secret', false);
    expect(result.phase).toBe('totp'); expect(test.writes.join('')).not.toContain('password-secret');
    expect((await test.auth.secondFactor(result.accountId, '123456')).phase).toBe('mailbox');
    expect((await test.auth.unlock(result.accountId, 'password-secret')).phase).toBe('ready');
  });
});
