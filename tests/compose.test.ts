import { describe, it, expect } from 'vitest';
import * as pgp from 'openpgp';
import { Mailbox, type ComposeInput } from '../src/proton/mail';
import type { Keyring } from '../src/proton/keys';
import type { ProtonTransport } from '../src/proton/api';
import { defaults, type Credential } from '../src/core/model';
import { base64, bytes, join } from '../src/core/encoding';
describe('Encrypted compose assembly', () => {
  it('creates an encrypted draft and a recipient-decryptable send package with attachment keys', async () => {
    const sender = await pgp.generateKey({ type: 'ecc', curve: 'curve25519Legacy', userIDs: [{ email: 'sender@example.test' }] });
    const recipient = await pgp.generateKey({ type: 'ecc', curve: 'curve25519Legacy', userIDs: [{ email: 'recipient@example.test' }] });
    const privateKey = await pgp.readPrivateKey({ armoredKey: sender.privateKey });
    let sent: any; let draft: any; let upload: FormData | undefined;
    const api = { request: async (route: string, options: any) => {
      if (route === 'mail/v4/messages') { draft = options.data; return { Message: { ID: 'draft' } }; }
      if (route === 'mail/v4/attachments') { upload = options.data; return { Attachment: { ID: 'attachment' } }; }
      if (route.startsWith('core/v4/keys/all')) return { Address: { Keys: [{ PublicKey: recipient.publicKey }] } };
      sent = options.data; return { Code: 1000, Sent: { ID: 'sent-message' } };
    } } as unknown as ProtonTransport;
    const keyring = { unlock: async () => ({ addresses: [{ ID: 'address', Email: 'sender@example.test', Status: 1 }], user: { Name: 'Sender' }, addressKeys: new Map([['address', [privateKey]]]) }) } as unknown as Keyring;
    const mailbox = new Mailbox(api, keyring, defaults);
    const session = { id: 'sender' } as Credential;
    const input: ComposeInput = { accountId: 'sender', from: 'sender+new-alias@example.test', to: 'recipient@example.test', cc: '', bcc: '', subject: 'Offline draft', html: '<p>Original QuickCode body</p>', files: [{ name: 'notes.txt', type: 'text/plain', data: base64(new TextEncoder().encode('Private attachment')) }] };
    const stages: string[] = [];
    await mailbox.send(session, input, async stage => { stages.push(stage); });
    expect(stages).toContain('Saving encrypted draft'); expect(stages.at(-1)).toBe('Submitting message to Proton');
    expect(draft.Message.Body).not.toContain('Original QuickCode body');
    const body = sent.Packages[0]; expect(body.Type).toBe(1); expect(body.BodyKey).toBeUndefined();
    const target = body.Addresses['recipient@example.test'];
    const recipientKey = await pgp.readPrivateKey({ armoredKey: recipient.privateKey });
    const decrypted = await pgp.decrypt({ message: await pgp.readMessage({ binaryMessage: join(bytes(target.BodyKeyPacket), bytes(body.Body)) }), decryptionKeys: recipientKey, verificationKeys: privateKey.toPublic() });
    expect(decrypted.data).toBe(input.html); await decrypted.signatures[0].verified;
    expect(upload).toBeInstanceOf(FormData);
    const encryptedAttachment = new Uint8Array(await (upload!.get('DataPacket') as Blob).arrayBuffer());
    const file = await pgp.decrypt({ message: await pgp.readMessage({ binaryMessage: join(bytes(target.AttachmentKeyPackets.attachment), encryptedAttachment) }), decryptionKeys: recipientKey });
    expect(file.data).toBe('Private attachment');
  });
});
