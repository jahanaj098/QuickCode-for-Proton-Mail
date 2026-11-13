// Copyright (c) 2026 jahanaj098. SPDX-License-Identifier: GPL-3.0-only
import type { Credential } from '../core/model';
import { challengeFrom, type HumanVerifier } from './verification';
export class ProtonFailure extends Error {
  constructor(message: string, readonly status: number, readonly code: number, readonly details?: unknown) { super(message); this.name = 'ProtonFailure'; }
}
export interface TransportOptions { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; data?: unknown; raw?: boolean; refresh?: boolean; verify?: HumanVerifier; verificationToken?: string }
export class ProtonTransport {
  private rotating = new Map<string, Promise<void>>();
  constructor(private version: () => string, private save: (credential: Credential) => Promise<void>, private fetcher: typeof fetch = (input, init) => fetch(input, init)) {}
  async request<T>(route: string, options: TransportOptions = {}, session?: Credential): Promise<T> {
    if (!/^(?:core|mail|auth|calendar|drive)\/[a-z\d/?&=_.%:+-]+$/iu.test(route)) throw new Error('Invalid Proton API path');
    const headers: Record<string, string> = { Accept: 'application/vnd.protonmail.v1+json', 'x-pm-appversion': this.version(), 'x-pm-apiversion': '3' };
    if (session) { headers['x-pm-uid'] = session.uid; headers.Authorization = 'Bearer ' + session.access; }
    if (options.verificationToken) { headers['x-pm-human-verification-token'] = options.verificationToken; headers['x-pm-human-verification-token-type'] = 'captcha'; }
    const isForm = options.data instanceof FormData;
    if (options.data !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    const response = await this.fetcher('https://mail.proton.me/api/' + route, {
      method: options.method || 'GET', headers, credentials: 'omit', redirect: 'error', cache: 'no-store',
      body: options.data === undefined ? undefined : isForm ? options.data as FormData : JSON.stringify(options.data), signal: AbortSignal.timeout(25_000),
    });
    if (response.status === 401 && session && options.refresh !== false) {
      await this.refresh(session); return this.request<T>(route, { ...options, refresh: false }, session);
    }
    if (options.raw && response.ok) return new Uint8Array(await response.arrayBuffer()) as T;
    const data = await response.json().catch(() => ({})) as { Code?: number; Error?: string; Details?: unknown };
    if (!response.ok || (data.Code !== undefined && data.Code !== 1000 && data.Code !== 1001)) {
      if (data.Code === 9001 && options.verify && !options.verificationToken) {
        const token = await options.verify(challengeFrom(data.Details));
        if (!token || token.length > 16384 || /[\r\n]/u.test(token)) throw new Error('Invalid verification response.');
        return this.request<T>(route, { ...options, verificationToken: token }, session);
      }
      const message = data.Code === 9001 ? (options.verificationToken ? 'Proton did not accept the verification. Start sign-in again.' : 'Proton requires human verification. Connect the account from the sign-in screen to complete it.') : data.Error || 'Proton request failed (' + response.status + ').';
      throw new ProtonFailure(message, response.status, data.Code || 0, data.Details);
    }
    return data as T;
  }
  async refresh(session: Credential): Promise<void> {
    let running = this.rotating.get(session.id);
    if (!running) {
      running = (async () => {
        const result = await this.request<{ AccessToken: string; RefreshToken: string }>('auth/v4/refresh', {
          method: 'POST', refresh: false, data: { UID: session.uid, RefreshToken: session.refresh, ResponseType: 'token', GrantType: 'refresh_token', RedirectURI: 'https://protonmail.com' },
        }, session);
        if (!result.AccessToken || !result.RefreshToken) throw new Error('Proton returned an incomplete refreshed session');
        session.access = result.AccessToken; session.refresh = result.RefreshToken; await this.save(session);
      })().finally(() => this.rotating.delete(session.id));
      this.rotating.set(session.id, running);
    }
    await running;
  }
}
