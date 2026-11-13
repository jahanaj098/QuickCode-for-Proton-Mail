// Copyright (c) 2026 jahanaj098. SPDX-License-Identifier: GPL-3.0-only
import type { HumanChallenge, HumanVerifier } from '../proton/verification';
export class VerificationRequests {
  private pending = new Map<string, { owner: string; resolve: (token: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private publish: (id: string, challenge: HumanChallenge, owner: string) => Promise<unknown>, private timeout = 180_000) {}
  verifier(id: string, owner: string): HumanVerifier {
    return challenge => new Promise<string>((resolve, reject) => {
      if (!id || !owner || this.pending.has(id)) { reject(new Error('A verification is already pending.')); return; }
      const timer = setTimeout(() => this.finish(id, owner), this.timeout);
      this.pending.set(id, { owner, resolve, reject, timer });
      this.publish(id, challenge, owner).catch(() => this.finish(id, owner));
    });
  }
  finish(id: string, owner: string, token?: string): boolean {
    const request = this.pending.get(id); if (!request || request.owner !== owner) return false;
    this.pending.delete(id); clearTimeout(request.timer);
    if (token && token.length <= 16384 && !/[\r\n]/u.test(token)) request.resolve(token);
    else request.reject(new Error('Verification cancelled or expired. Start sign-in again.'));
    return true;
  }
}
