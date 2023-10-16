import { describe, it, expect } from 'vitest';
import { DeviceVault } from '../src/core/vault';
describe('Authenticated local vault', () => {
  it('does not persist plaintext and uses a different nonce for every write', async () => {
    const values: Record<string, unknown> = {};
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const area = { get: async (id: string) => ({ [id]: values[id] }), set: async (value: Record<string, unknown>) => { Object.assign(values, value); }, remove: async (id: string) => { delete values[id]; } };
    const vault = new DeviceVault(area, async () => key);
    await vault.put('session', { token: 'secret-token', keyPassword: 'derived-key' });
    const first = JSON.stringify(values);
    expect(first).not.toContain('secret-token'); expect(first).not.toContain('derived-key');
    expect(await vault.get('session')).toEqual({ token: 'secret-token', keyPassword: 'derived-key' });
    await vault.put('session', { token: 'secret-token', keyPassword: 'derived-key' });
    expect(JSON.stringify(values)).not.toBe(first);
    values.other = values.session;
    await expect(vault.get('other')).rejects.toThrow();
    const record = values.session as { ciphertext: string }; record.ciphertext = record.ciphertext.replace(/^./u, record.ciphertext[0] === 'A' ? 'B' : 'A');
    await expect(vault.get('session')).rejects.toThrow();
    await vault.remove('session'); expect(await vault.get('session')).toBeUndefined();
  });
});
