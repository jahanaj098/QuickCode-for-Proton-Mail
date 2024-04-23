// Copyright (c) 2026 jahanaj098. SPDX-License-Identifier: GPL-3.0-only
import { getSrp, type SrpChallenge } from './sdk.js';
import { equalSecret } from '../core/encoding';
import type { AuthResult, Credential } from '../core/model';
import type { ProtonTransport } from './api';
import type { Keyring } from './keys';
export interface AuthTokenResponse { UID: string; AccessToken: string; RefreshToken: string; ServerProof: string; PasswordMode?: number; '2FA'?: { Enabled: number } }
export class StandaloneLogin {
  constructor(private api: ProtonTransport, private keys: Keyring, private sessions: Map<string, Credential>, private persist: (session: Credential) => Promise<void>) {}
  async start(username: string, password: string, remember: boolean, totp?: string): Promise<AuthResult> {
    username = username.trim();
    if (!username || !password) throw new Error('Enter a Proton username and password.');
    const challenge = await this.api.request<SrpChallenge>('core/v4/auth/info', { method: 'POST', data: { Username: username, Intent: 'Proton' }, refresh: false });
    const proof = await getSrp(challenge, { username, password });
    const token = await this.api.request<AuthTokenResponse>('core/v4/auth', { method: 'POST', refresh: false, data: {
      Username: username, ClientEphemeral: proof.clientEphemeral, ClientProof: proof.clientProof, SRPSession: challenge.SRPSession, PersistentCookies: 0,
    } });
    if (!equalSecret(proof.expectedServerProof, token.ServerProof || '')) throw new Error('Proton server proof could not be verified. No session was saved.');
    if (!token.UID || !token.AccessToken || !token.RefreshToken) throw new Error('Proton did not return a complete session.');
    const existing = [...this.sessions.values()].find(session => session.uid === token.UID);
    if (existing) throw new Error('This Proton session is already connected.');
    const session: Credential = { id: crypto.randomUUID(), username, uid: token.UID, access: token.AccessToken, refresh: token.RefreshToken,
      remember, label: username.split('@')[0], color: '#177668', phase: token['2FA']?.Enabled ? 'totp' : 'mailbox' };
    this.sessions.set(session.id, session);
    // Pending sessions are browser-session only; passwords are never persisted.
    await this.persist(session);
    if (session.phase === 'totp') {
      if (!totp) return { accountId: session.id, phase: 'totp' };
      await this.secondFactor(session.id, totp);
    }
    if (token.PasswordMode !== 2) return this.unlock(session.id, password);
    return { accountId: session.id, phase: 'mailbox' };
  }
  async secondFactor(id: string, code: string): Promise<AuthResult> {
    const session = this.sessions.get(id); if (!session || session.phase !== 'totp') throw new Error('Sign-in attempt expired. Start again.');
    if (!/^\d{6,8}$/u.test(code.trim())) throw new Error('Enter your authenticator code.');
    await this.api.request('core/v4/auth/2fa', { method: 'POST', data: { TwoFactorCode: code.trim() }, refresh: false }, session);
    session.phase = 'mailbox'; await this.persist(session); return { accountId: id, phase: 'mailbox' };
  }
  async unlock(id: string, password: string): Promise<AuthResult> {
    const session = this.sessions.get(id); if (!session || session.phase === 'totp') throw new Error('Complete sign-in first.');
    const mailbox = await this.keys.unlock(session, password); session.phase = 'ready';
    session.label = mailbox.user.Name || session.label;
    await this.persist(session); return { accountId: id, phase: 'ready' };
  }
}
