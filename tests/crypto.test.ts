import { describe, it, expect } from 'vitest';
import * as pgp from 'openpgp';
import { computeKeyPassword } from '../src/proton/sdk.js';
import { Keyring } from '../src/proton/keys';
import type { ProtonTransport } from '../src/proton/api';
import type { Credential } from '../src/core/model';
import { ownsAlias, recipients } from '../src/proton/mail';
import { base64 } from '../src/core/encoding';
describe('Actual local mailbox cryptography', () => {
  it('unlocks a user key, verifies the address token, and decrypts mail locally', async () => {
    const salt = base64(new Uint8Array(16).fill(3)); const derived = await computeKeyPassword('offline-fixture-password', salt);
    const user = await pgp.generateKey({ type: 'ecc', curve: 'curve25519Legacy', userIDs: [{ name: 'Fixture user' }], passphrase: derived });
    const userKey = await pgp.decryptKey({ privateKey: await pgp.readPrivateKey({ armoredKey: user.privateKey }), passphrase: derived });
    const address = await pgp.generateKey({ type: 'ecc', curve: 'curve25519Legacy', userIDs: [{ email: 'fixture@example.test' }], passphrase: 'address-token' });
    const tokenMessage = await pgp.createMessage({ text: 'address-token' });
    const token = await pgp.encrypt({ message: tokenMessage, encryptionKeys: userKey.toPublic(), format: 'armored' });
    const signature = await pgp.sign({ message: tokenMessage, signingKeys: userKey, detached: true, format: 'armored' });
    const payloads: Record<string, unknown> = {
      'core/v4/users': { User: { ID: 'user', Name: 'Fixture', Keys: [{ ID: 'user-key', Primary: 1, PrivateKey: user.privateKey }] } },
      'core/v4/keys/salts': { KeySalts: [{ ID: 'user-key', KeySalt: salt }] },
      'core/v4/addresses': { Addresses: [{ ID: 'address', Email: 'fixture@example.test', Status: 1, Keys: [{ ID: 'address-key', Primary: 1, PrivateKey: address.privateKey, Token: token, Signature: signature }] }] },
    };
    const api = { request: async (route: string) => payloads[route] } as ProtonTransport;
    const keyring = new Keyring(api); const session: Credential = { id: 'id', uid: 'uid', username: 'fixture', access: 'token', refresh: 'refresh', remember: false, label: '', color: '', phase: 'mailbox' };
    await keyring.unlock(session, 'offline-fixture-password');
    const encrypted = await pgp.encrypt({ message: await pgp.createMessage({ text: 'Code: Ab12Cd' }), encryptionKeys: await pgp.readKey({ armoredKey: address.publicKey }), format: 'armored' });
    expect(await keyring.decrypt(session, encrypted)).toBe('Code: Ab12Cd');
    expect(session.keyPassword).toBe(derived);
    keyring.clear('id');
    const response = payloads['core/v4/addresses'] as { Addresses: { Keys: { Signature: string }[] }[] };
    response.Addresses[0].Keys[0].Signature = user.revocationCertificate;
    await expect(keyring.unlock(session)).rejects.toThrow('No address keys');
  });
  it('accepts never-used +aliases only for owned base addresses', () => {
    expect(ownsAlias('alex+new-tag@proton.me', 'alex@proton.me')).toBe(true);
    expect(ownsAlias('alex@attacker.test', 'alex@proton.me')).toBe(false);
    expect(ownsAlias('alexander+tag@proton.me', 'alex@proton.me')).toBe(false);
    expect(recipients('a@example.test; b@example.test')).toHaveLength(2);
    expect(() => recipients('header\r\nattack')).toThrow();
  });
});
