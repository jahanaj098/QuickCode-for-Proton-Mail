// Copyright (c) 2026 jahanaj098. SPDX-License-Identifier: GPL-3.0-only
import * as pgp from 'openpgp';
import type { Address, Credential, User, EncryptedKey } from '../core/model';
import type { ProtonTransport } from './api';
import { computeKeyPassword } from './sdk.js';
import { join, bytes } from '../core/encoding';
export interface UnlockedMailbox { user: User; addresses: Address[]; keys: pgp.PrivateKey[]; addressKeys: Map<string, pgp.PrivateKey[]> }
export class Keyring {
  private mailboxes = new Map<string, UnlockedMailbox>();
  constructor(private api: ProtonTransport) {}
  clear(id: string): void { this.mailboxes.delete(id); }
  async unlock(session: Credential, password?: string): Promise<UnlockedMailbox> {
    if (this.mailboxes.has(session.id) && !password) return this.mailboxes.get(session.id)!;
    const [{ User: user }, { Addresses: addresses }, { KeySalts: salts }] = await Promise.all([
      this.api.request<{ User: User }>('core/v4/users', {}, session),
      this.api.request<{ Addresses: Address[] }>('core/v4/addresses', {}, session),
      this.api.request<{ KeySalts: { ID: string; KeySalt: string }[] }>('core/v4/keys/salts', {}, session),
    ]);
    if (user.OrganizationPrivateKey) throw new Error('Managed organization keys are not supported in this development version.');
    if (!Array.isArray(user.Keys) || !user.Keys.length) throw new Error('No mailbox keys are available for this account.');
    if (password !== undefined) {
      const salt = salts.find(entry => entry.ID === user.Keys.find(key => key.Primary === 1)?.ID)?.KeySalt || salts.find(entry => entry.ID === user.Keys[0].ID)?.KeySalt;
      if (!salt) throw new Error('This account has legacy keys without a key salt. Legacy unlock is not implemented in this development build.');
      session.keyPassword = await computeKeyPassword(password, salt);
    }
    if (!session.keyPassword) throw new Error('Enter your mailbox password to unlock mail.');
    const userKeys = await this.importKeys(user.Keys, () => Promise.resolve(session.keyPassword!));
    if (!userKeys.length) throw new Error('Mailbox keys could not be unlocked. Check the mailbox password.');
    const addressKeys = new Map<string, pgp.PrivateKey[]>();
    for (const address of addresses) {
      const keys = await this.importKeys(address.Keys || [], async key => {
        if (!key.Token) return session.keyPassword!;
        if (!key.Signature) throw new Error('Address key token is missing its signature.');
        const token = await pgp.decrypt({ message: await pgp.readMessage({ armoredMessage: key.Token }), decryptionKeys: userKeys, format: 'utf8' });
        const verification = await pgp.verify({ message: await pgp.createMessage({ text: token.data }), signature: await pgp.readSignature({ armoredSignature: key.Signature }), verificationKeys: userKeys.map(key => key.toPublic()) });
        if (!verification.signatures.length) throw new Error('Address key token is unsigned.');
        await Promise.any(verification.signatures.map(signature => signature.verified));
        return token.data;
      });
      if (keys.length) addressKeys.set(address.ID, keys);
    }
    const result = { user, addresses, keys: [...userKeys, ...[...addressKeys.values()].flat()], addressKeys };
    if (!addressKeys.size) throw new Error('No address keys could be unlocked. This account may use an unsupported key format.');
    this.mailboxes.set(session.id, result); return result;
  }
  private async importKeys(keys: EncryptedKey[], passphrase: (key: EncryptedKey) => Promise<string>): Promise<pgp.PrivateKey[]> {
    const output: pgp.PrivateKey[] = [];
    for (const key of keys) try {
      const privateKey = await pgp.readPrivateKey({ armoredKey: key.PrivateKey });
      output.push(privateKey.isDecrypted() ? privateKey : await pgp.decryptKey({ privateKey, passphrase: await passphrase(key) }));
    } catch { /* Historical keys can be unavailable; an active key must still unlock. */ }
    return output;
  }
  async decrypt(session: Credential, body: string): Promise<string> {
    if (!body.includes('-----BEGIN PGP MESSAGE-----')) return body;
    const mailbox = await this.unlock(session);
    const decrypted = await pgp.decrypt({ message: await pgp.readMessage({ armoredMessage: body }), decryptionKeys: mailbox.keys, format: 'utf8' });
    return decrypted.data;
  }
  async attachment(session: Credential, keyPackets: string, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
    const mailbox = await this.unlock(session);
    const result = await pgp.decrypt({ message: await pgp.readMessage({ binaryMessage: join(bytes(keyPackets), data) }), decryptionKeys: mailbox.keys, format: 'binary' });
    return result.data;
  }
}
