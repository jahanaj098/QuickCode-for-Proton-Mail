import { describe, it, expect } from 'vitest';
import * as pgp from 'openpgp';
import { readToEnd } from '@openpgp/web-stream-tools';
import { Keyring } from '../src/proton/keys';
import type { ProtonTransport } from '../src/proton/api';
import type { Credential } from '../src/core/model';
function fixture(privateKey: () => string) {
  const calls: string[] = [];
  const api = { request: async (route: string) => {
    calls.push(route);
    if (route === 'core/v4/keys/salts') throw new Error('Salt access must not be needed');
    if (route === 'core/v4/users') return { User: { ID: 'user', Keys: [{ ID: 'key', PrivateKey: privateKey() }] } };
    return { Addresses: [{ ID: 'address', Email: 'fixture@example.test', Keys: [{ ID: 'key', PrivateKey: privateKey() }] }] };
  } } as unknown as ProtonTransport;
  const session = { id: 'fixture', keyPassword: 'derived-fixture' } as Credential;
  return { keyring: new Keyring(api), session, calls };
}
describe('stored-message decryption compatibility', () => {
  it('reads legacy RSA signing-key ciphertext without changing global policy or accepting tampered data', async () => {
    const previous = pgp.config.allowInsecureDecryptionWithSigningKeys;
    pgp.config.allowInsecureDecryptionWithSigningKeys = false;
    try {
    const generated = await pgp.generateKey({ type: 'rsa', rsaBits: 2048, subkeys: [], userIDs: [{ email: 'fixture@example.test' }], passphrase: 'derived-fixture' });
    const publicKey = await pgp.readKey({ armoredKey: generated.publicKey });
    // Reproduce the historical producer bug in the fixture only: encrypt to the
    // signing-only primary RSA key rather than a permitted encryption key.
    publicKey.getEncryptionKey = async () => publicKey;
    const body = await pgp.encrypt({ message: await pgp.createMessage({ text: 'Historical message' }), encryptionKeys: publicKey, format: 'armored' });
    const privateKey = await pgp.decryptKey({ privateKey: await pgp.readPrivateKey({ armoredKey: generated.privateKey }), passphrase: 'derived-fixture' });
    await expect(pgp.decrypt({ message: await pgp.readMessage({ armoredMessage: body }), decryptionKeys: privateKey })).rejects.toThrow('No decryption key packets found');
    const test = fixture(() => generated.privateKey);
    expect(await test.keyring.decrypt(test.session, body)).toBe('Historical message');
    expect(pgp.config.allowInsecureDecryptionWithSigningKeys).toBe(false);
    expect(test.calls).not.toContain('core/v4/keys/salts');
    const data = new Uint8Array(await readToEnd((await pgp.readMessage({ armoredMessage: body })).write()) as Uint8Array<ArrayBuffer>); data[data.length - 8] ^= 1;
    const damaged = await readToEnd((await pgp.readMessage({ binaryMessage: data })).armor()) as string;
    await expect(test.keyring.decrypt(test.session, damaged)).rejects.toThrow();
    } finally { pgp.config.allowInsecureDecryptionWithSigningKeys = previous; }
  });
  it('refreshes a stale key cache once when mail targets a newly added key', async () => {
    const first = await pgp.generateKey({ type: 'ecc', curve: 'curve25519Legacy', userIDs: [{ email: 'fixture@example.test' }], passphrase: 'derived-fixture' });
    const next = await pgp.generateKey({ type: 'ecc', curve: 'curve25519Legacy', userIDs: [{ email: 'fixture@example.test' }], passphrase: 'derived-fixture' });
    let current = first.privateKey; const test = fixture(() => current);
    await test.keyring.unlock(test.session); current = next.privateKey;
    const encrypted = await pgp.encrypt({ message: await pgp.createMessage({ text: 'New key message' }), encryptionKeys: await pgp.readKey({ armoredKey: next.publicKey }), format: 'armored' });
    expect(await test.keyring.decrypt(test.session, encrypted)).toBe('New key message');
    expect(test.calls.filter(route => route === 'core/v4/users')).toHaveLength(2);
    expect(test.calls).not.toContain('core/v4/keys/salts');
  });
});
