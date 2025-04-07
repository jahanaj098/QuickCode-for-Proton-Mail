// Copyright (c) 2026 jahanaj098. SPDX-License-Identifier: GPL-3.0-only
import { decodeHTML } from 'entities';
import type { CodeMatch, OTPPreferences } from './model';
const signal = /\b(?:otp|code|verification|verify|security|one[\s-]?time|passcode|pin|token|login|confirm|2fa|mfa)\b/giu;
export function plainText(input: string): string {
  return decodeHTML(input.replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/giu, ' ').replace(/<(?:br\b[^>]*|\/(?:p|div|tr|li|blockquote))>/giu, '\n').replace(/<blockquote\b[^>]*>/giu, '\n> ').replace(/<[^>]*>/gu, ' '))
    .replace(/[^\S\n]+/gu, ' ').replace(/\n{3,}/gu, '\n\n').trim();
}
export function extractCodes(subject: string, body: string, settings: OTPPreferences): CodeMatch[] {
  const min = Math.max(4, Math.min(16, settings.minimum || 4)); const max = Math.max(min, Math.min(16, settings.maximum || 8));
  const candidates: CodeMatch[] = [];
  for (const source of ['body', 'subject'] as const) {
    const text = plainText(source === 'body' ? body : subject).slice(0, 150_000);
    const keywords = [...text.matchAll(signal)].map(match => match.index);
    const quoteAt = text.search(/(?:^|\n)(?:On .{0,160}wrote:|[- ]*Original Message)/iu);
    function add(raw: string, index: number, custom = false): void {
      const value = raw.replace(/[\s-]+/gu, '');
      if (value.length < min || value.length > max || !/^[a-z\d]+$/iu.test(value) || !/\d/u.test(value)) return;
      if (/^(19|20)\d{2}$/u.test(value)) return;
      if (/^\d+$/u.test(value) && (/[€$£¥₹]\s*$/u.test(text.slice(Math.max(0, index - 3), index)) || /^\s*[€$£¥₹]/u.test(text.slice(index + raw.length, index + raw.length + 3)))) return;
      const start = text.lastIndexOf('\n', Math.max(0, index - 1)) + 1; const next = text.indexOf('\n', index); const end = next < 0 ? text.length : next;
      const near = keywords.reduce((distance, position) => Math.min(distance, Math.abs(position - index)), Infinity);
      const sameBlock = keywords.some(position => position >= start && position < end);
      const prefix = /(?:is\s*:?|[:=])\s*$/iu.test(text.slice(Math.max(0, index - 12), index));
      if (!custom && !settings.builtIn && !(settings.context && (sameBlock || prefix))) return;
      const quoted = /^\s*>/u.test(text.slice(start, end)) || (quoteAt >= 0 && index > quoteAt);
      const score = 20 + (custom ? 100 : 0) + (near < 80 ? 50 : 0) + (settings.context && sameBlock ? 25 : 0) + (settings.context && prefix ? 15 : 0) - (source === 'subject' ? 20 : 0) - (quoted ? 80 : 0);
      candidates.push({ value, position: index, source, distance: near, score });
    }
    if (settings.builtIn || settings.context) for (const match of text.matchAll(/\b(?:\d{2,4}(?:[ -]\d{2,4})+|[a-z\d]{2,4}(?:-[a-z\d]{2,4})+|[a-z\d]+)\b/giu)) add(match[0], match.index);
    if (settings.custom) for (const pattern of settings.patterns) {
      if (!pattern.enabled || pattern.expression.length > 250) continue;
      // Reject common unbounded backtracking constructs before accepting custom input.
      if (/\\[1-9]|\([^)]*[+*][^)]*\)[+*{]/u.test(pattern.expression)) continue;
      try {
        const regex = new RegExp(pattern.expression, [...new Set(pattern.flags.replace(/[^imu]/gu, '') + 'g')].join(''));
        let matches = 0;
        for (const match of text.matchAll(regex)) {
          if (++matches > 100) break;
          const value = match[1] || match[0]; if (value) add(value, match.index + match[0].indexOf(value), true);
        }
      } catch { /* An invalid user pattern cannot break mail polling. */ }
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.distance - b.distance || (a.source !== b.source ? (a.source === 'body' ? -1 : 1) : a.position - b.position));
  return candidates.filter((candidate, index, all) => all.findIndex(other => other.value === candidate.value) === index).slice(0, 3);
}
export async function notificationKey(messageId: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(messageId));
  return 'qc-' + [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
