// Copyright (c) 2026 jahanaj098. SPDX-License-Identifier: GPL-3.0-only
export interface HumanChallenge { token: string }
export type HumanVerifier = (challenge: HumanChallenge) => Promise<string>;
export const captchaOrigin = 'https://mail-api.proton.me';
export function captchaURL(token: string): string {
  const url = new URL('/core/v4/captcha', captchaOrigin);
  url.searchParams.set('Token', token); url.searchParams.set('ForceWebMessaging', '1');
  return url.href;
}
export function challengeFrom(details: unknown): HumanChallenge {
  const data = details as { HumanVerificationToken?: unknown; HumanVerificationMethods?: unknown } | undefined;
  if (!Array.isArray(data?.HumanVerificationMethods) || !data.HumanVerificationMethods.includes('captcha')) {
    throw new Error('Proton requires a verification method this build does not support. Sign in on Proton’s website to review your account, then try again.');
  }
  if (typeof data.HumanVerificationToken !== 'string' || !data.HumanVerificationToken || data.HumanVerificationToken.length > 16384) throw new Error('Proton returned an invalid verification challenge.');
  return { token: data.HumanVerificationToken };
}
export function captchaResult(event: MessageEvent, source: Window | null): string | undefined {
  if (!source || event.source !== source || event.origin !== captchaOrigin || event.data?.type !== 'pm_captcha') return;
  const token = event.data.token;
  return typeof token === 'string' && token.length > 0 && token.length <= 16384 && !/[\r\n]/u.test(token) ? token : undefined;
}
