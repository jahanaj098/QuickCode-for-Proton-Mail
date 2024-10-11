// Copyright (c) 2026 jahanaj098. SPDX-License-Identifier: GPL-3.0-only
import * as pgp from 'openpgp';
import { readToEnd } from '@openpgp/web-stream-tools';
import { base64, bytes } from '../core/encoding';
import { extractCodes, plainText } from '../core/otp';
import type { Credential, MailItem, MailDetail, WireMessage, Preferences, Person, Attachment } from '../core/model';
import type { ProtonTransport } from './api';
import type { Keyring } from './keys';
export interface ComposeInput {
  accountId: string; from: string; to: string; cc: string; bcc: string; subject: string; html: string;
  parentId?: string; action?: 'reply' | 'reply-all' | 'forward'; deliveryTime?: number; expiresIn?: number;
  files: { name: string; type: string; data: string }[];
}
export interface Label { ID: string; Name: string; Color?: string; Type: number }
export function recipients(value: string): Person[] {
  return value.split(/[,;\n]/u).map(text => text.trim()).filter(Boolean).map(text => {
    if (!/^[^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+$/u.test(text)) throw new Error('Enter recipient addresses separated by commas.');
    return { Address: text };
  });
}
export function ownsAlias(from: string, address: string): boolean {
  const [local, domain] = from.toLowerCase().split('@'); const [owned, ownedDomain] = address.toLowerCase().split('@');
  return !!local && !!domain && domain === ownedDomain && (local === owned || local.startsWith(owned + '+'));
}
export class Mailbox {
  constructor(private api: ProtonTransport, private keyring: Keyring, private preferences: () => Preferences) {}
  async labels(session: Credential): Promise<Label[]> {
    const response = await this.api.request<{ Labels: Label[] }>('core/v4/labels?Type=1', {}, session); return response.Labels;
  }
  async list(session: Credential): Promise<MailItem[]> {
    const options = this.preferences(); const folders = options.accounts[session.id]?.folders || ['0'];
    const found = new Map<string, WireMessage>();
    for (const folder of folders) {
      const response = await this.api.request<{ Messages: WireMessage[] }>('mail/v4/messages?' + new URLSearchParams({ LabelID: folder, Unread: '1', Sort: 'Time', Desc: '1', PageSize: String(options.limit), Page: '0' }), {}, session);
      for (const message of response.Messages || []) found.set(message.ID, message);
    }
    return [...found.values()].sort((a, b) => b.Time - a.Time).slice(0, options.limit).map(message => ({ accountId: session.id, message, codes: extractCodes(message.Subject || '', '', this.otp(session.id)), preview: '' }));
  }
  private otp(id: string) { const settings = this.preferences(); return { ...settings.otp, ...settings.accounts[id]?.otp }; }
  async read(session: Credential, id: string): Promise<MailDetail> {
    const response = await this.api.request<{ Message: WireMessage }>('mail/v4/messages/' + encodeURIComponent(id), {}, session);
    if (!response.Message) throw new Error('Message was not returned by Proton.');
    const body = await this.keyring.decrypt(session, response.Message.Body || '');
    return { accountId: session.id, message: { ...response.Message, Body: undefined }, body, preview: plainText(body).replace(/\s+/gu, ' ').slice(0, 180),
      codes: extractCodes(response.Message.Subject || '', body, this.otp(session.id)), attachments: response.Message.Attachments || [], signature: 'unverified' };
  }
  async action(session: Credential, action: string, ids: string[], label?: string): Promise<void> {
    if (!ids.length || ids.length > 100 || ids.some(id => typeof id !== 'string' || id.length > 512)) throw new Error('Invalid message selection.');
    const data = { IDs: ids }; const method = 'PUT' as const;
    if (action === 'read' || action === 'unread' || action === 'delete') {
      await this.api.request('mail/v4/messages/' + action, { method, data }, session); return;
    }
    const destination = action === 'archive' ? '6' : action === 'trash' ? '3' : action === 'spam' ? '4' : action === 'star' ? '10' : label;
    if (!destination) throw new Error('Choose a folder or label.');
    await this.api.request('mail/v4/messages/' + (action === 'unstar' ? 'unlabel' : 'label'), { method, data: { ...data, LabelID: action === 'unstar' ? '10' : destination } }, session);
    if (['archive', 'trash', 'spam'].includes(action)) await this.api.request('mail/v4/messages/unlabel', { method, data: { ...data, LabelID: '0' } }, session);
  }
  async download(session: Credential, messageId: string, attachmentId: string): Promise<{ name: string; type: string; data: string }> {
    const detail = await this.read(session, messageId); const attachment = detail.attachments.find(item => item.ID === attachmentId);
    if (!attachment) throw new Error('Attachment not found in this message.');
    const encrypted = await this.api.request<Uint8Array<ArrayBuffer>>('mail/v4/attachments/' + encodeURIComponent(attachmentId), { raw: true }, session);
    const decrypted = attachment.KeyPackets ? await this.keyring.attachment(session, attachment.KeyPackets, encrypted) : encrypted;
    return { name: attachment.Name, type: attachment.MIMEType || 'application/octet-stream', data: base64(decrypted) };
  }
  async send(session: Credential, input: ComposeInput): Promise<{ id: string }> {
    const mailbox = await this.keyring.unlock(session);
    const from = mailbox.addresses.find(address => address.Status === 1 && ownsAlias(input.from, address.Email));
    if (!from) throw new Error('The sender must be one of your addresses or its +alias.');
    const privateKey = mailbox.addressKeys.get(from.ID)?.[0]; if (!privateKey) throw new Error('The sender key is locked.');
    const to = recipients(input.to), cc = recipients(input.cc), bcc = recipients(input.bcc);
    if (!to.length) throw new Error('Add at least one To recipient.');
    if (input.html.length > 1_000_000 || input.files.length > 20) throw new Error('This message exceeds QuickCode’s current send limits.');
    const sessionKey = await pgp.generateSessionKey({ encryptionKeys: privateKey.toPublic() });
    const armored = await pgp.encrypt({ message: await pgp.createMessage({ text: input.html }), encryptionKeys: privateKey.toPublic(), signingKeys: privateKey, sessionKey, format: 'armored' });
    const replyAction = input.action === 'forward' ? 2 : input.action ? 0 : undefined;
    const draft = await this.api.request<{ Message: WireMessage }>('mail/v4/messages', { method: 'POST', data: {
      Message: { Subject: input.subject, Sender: { Address: input.from, Name: from.DisplayName || mailbox.user.Name }, ToList: to, CCList: cc, BCCList: bcc, MIMEType: 'text/html', Body: armored, Attachments: [] },
      ...(input.parentId ? { ParentID: input.parentId, Action: replyAction } : {}), AttachmentKeyPackets: {},
    } }, session);
    const draftId = draft.Message?.ID; if (!draftId) throw new Error('Proton did not create the draft.');
    const attachments = new Map<string, pgp.SessionKey>();
    for (const file of input.files) {
      const content = bytes(file.data); if (content.length > 20_000_000) throw new Error('An attachment is larger than the current 20 MB limit.');
      const fileKey = await pgp.generateSessionKey({ encryptionKeys: privateKey.toPublic() });
      const encrypted = await pgp.encrypt({ message: await pgp.createMessage({ binary: content, filename: file.name }), encryptionKeys: privateKey.toPublic(), sessionKey: fileKey, format: 'object' });
      const keyPacket = await readToEnd(encrypted.packets.filterByTag(pgp.enums.packet.publicKeyEncryptedSessionKey).write());
      const dataPacket = await readToEnd(encrypted.packets.filterByTag(pgp.enums.packet.symEncryptedIntegrityProtectedData, pgp.enums.packet.aeadEncryptedData).write());
      if (typeof keyPacket === 'string' || typeof dataPacket === 'string') throw new Error('Cryptography returned a non-binary attachment packet.');
      const signature = await pgp.sign({ message: await pgp.createMessage({ binary: content }), signingKeys: privateKey, detached: true, format: 'binary' });
      const form = new FormData(); form.set('MessageID', draftId); form.set('Filename', file.name); form.set('MIMEType', file.type || 'application/octet-stream');
      form.set('KeyPackets', new Blob([new Uint8Array(keyPacket)]), 'keys');
      form.set('DataPacket', new Blob([new Uint8Array(dataPacket)]), 'data'); form.set('Signature', new Blob([signature]), 'signature');
      const uploaded = await this.api.request<{ Attachment: Attachment }>('mail/v4/attachments', { method: 'POST', data: form }, session);
      if (!uploaded.Attachment?.ID) throw new Error('Attachment upload failed. Your draft remains in Proton Mail.');
      attachments.set(uploaded.Attachment.ID, fileKey);
    }
    const addresses: Record<string, unknown> = {}; let mask = 0;
    for (const recipient of [...to, ...cc, ...bcc]) {
      const keys = await this.api.request<{ Address?: { Keys?: { PublicKey: string }[] }; Keys?: { PublicKey: string }[] }>('core/v4/keys/all?Email=' + encodeURIComponent(recipient.Address), {}, session);
      const records = keys.Address?.Keys || keys.Keys || [];
      if (records.length) {
        const publicKeys = await Promise.all(records.map(key => pgp.readKey({ armoredKey: key.PublicKey })));
        const filePackets: Record<string, string> = {};
        for (const [id, key] of attachments) filePackets[id] = base64(await pgp.encryptSessionKey({ ...key, encryptionKeys: publicKeys, format: 'binary' }));
        addresses[recipient.Address] = { Type: 1, BodyKeyPacket: base64(await pgp.encryptSessionKey({ ...sessionKey, encryptionKeys: publicKeys, format: 'binary' })), AttachmentKeyPackets: filePackets, Signature: 1 }; mask |= 1;
      } else { addresses[recipient.Address] = { Type: 4, Signature: 0 }; mask |= 4; }
    }
    const pgpMessage = await pgp.readMessage({ armoredMessage: armored });
    const bodyPacket = await readToEnd(pgpMessage.packets.filterByTag(pgp.enums.packet.symEncryptedIntegrityProtectedData, pgp.enums.packet.aeadEncryptedData).write());
    const attachmentKeys = Object.fromEntries([...attachments].map(([id, key]) => [id, { Key: base64(key.data), Algorithm: key.algorithm }]));
    const packageData = { Type: mask, MIMEType: 'text/html', Addresses: addresses, Body: base64(bodyPacket as Uint8Array<ArrayBuffer>),
      ...((mask & 4) ? { BodyKey: { Key: base64(sessionKey.data), Algorithm: sessionKey.algorithm }, AttachmentKeys: attachmentKeys } : {}) };
    await this.api.request('mail/v4/messages/' + encodeURIComponent(draftId), { method: 'POST', data: {
      Packages: [packageData], ...(input.deliveryTime ? { DeliveryTime: input.deliveryTime } : {}), ...(input.expiresIn ? { ExpiresIn: input.expiresIn } : {}),
    } }, session);
    return { id: draftId };
  }
}
