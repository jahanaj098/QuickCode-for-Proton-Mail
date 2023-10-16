// Copyright (c) 2026 jahanaj098. SPDX-License-Identifier: GPL-3.0-only
export interface Person { Address: string; Name?: string }
export interface EncryptedKey { ID: string; PrivateKey: string; Primary?: number; Token?: string; Signature?: string }
export interface Address { ID: string; Email: string; DisplayName?: string; Status: number; Order?: number; Keys: EncryptedKey[] }
export interface User { ID: string; Name: string; Email?: string; Keys: EncryptedKey[]; OrganizationPrivateKey?: string }
export interface Attachment { ID: string; Name: string; MIMEType: string; Size: number; KeyPackets?: string; Signature?: string }
export interface WireMessage {
  ID: string; ConversationID: string; Subject: string; Sender: Person; Time: number; Unread: number;
  LabelIDs: string[]; NumAttachments?: number; AddressID?: string; ToList?: Person[]; CCList?: Person[]; BCCList?: Person[];
  Body?: string; MIMEType?: string; Header?: string; Attachments?: Attachment[];
}
export interface CodeMatch { value: string; score: number; position: number; source: 'subject' | 'body'; distance: number }
export interface MailItem { accountId: string; message: WireMessage; preview: string; codes: CodeMatch[] }
export interface MailDetail extends MailItem { body: string; attachments: Attachment[]; signature: 'unverified' | 'valid' | 'invalid' }
export interface Credential {
  id: string; username: string; uid: string; access: string; refresh: string; keyPassword?: string;
  label: string; color: string; remember: boolean; phase: 'totp' | 'mailbox' | 'ready';
}
export interface AccountPreferences { label?: string; color?: string; folders: string[]; notifications: boolean; otp?: Partial<OTPPreferences> }
export interface AccountSummary { id: string; email: string; label: string; color: string; status: string; unread: number; error?: string }
export interface Pattern { id: string; name: string; expression: string; flags: string; enabled: boolean }
export interface OTPPreferences { enabled: boolean; minimum: number; maximum: number; builtIn: boolean; context: boolean; custom: boolean; patterns: Pattern[] }
export interface QuietRule { id: string; field: 'sender' | 'subject'; contains: string; enabled: boolean; accountId?: string }
export interface Preferences {
  scheme: 'auto' | 'light' | 'dark'; theme: 'evergreen' | 'sand' | 'midnight'; density: 'compact' | 'comfortable' | 'relaxed';
  width: number; height: number; pollSeconds: number; limit: number; previews: number; customCSS: string;
  notifications: boolean; otp: OTPPreferences; quiet: QuietRule[]; dndUntil: number;
  accounts: Record<string, AccountPreferences>; appVersion: string;
}
export interface Dashboard { accounts: AccountSummary[]; items: MailItem[]; settings: Preferences; polling: boolean; checkedAt: number }
export type AuthResult = { accountId: string; phase: Credential['phase'] };
export const defaults = (): Preferences => ({
  scheme: 'auto', theme: 'evergreen', density: 'comfortable', width: 620, height: 600, pollSeconds: 60, limit: 30, previews: 1, customCSS: '',
  notifications: true, otp: { enabled: true, minimum: 4, maximum: 8, builtIn: true, context: true, custom: true, patterns: [] },
  quiet: [], dndUntil: 0, accounts: {}, appVersion: 'web-mail@5.0.141.8',
});
export function preferences(value: unknown): Preferences {
  const d = defaults();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return d;
  const v = value as Partial<Preferences>;
  const patterns: Pattern[] = Array.isArray(v.otp?.patterns) ? v.otp.patterns.filter(item => item && typeof item.expression === 'string').slice(0, 50).map(item => ({ id: String(item.id || crypto.randomUUID()), name: String(item.name || '').slice(0, 60), expression: item.expression.slice(0, 250), flags: typeof item.flags === 'string' ? item.flags : 'i', enabled: item.enabled !== false })) : [];
  const accounts: Record<string, AccountPreferences> = {};
  if (v.accounts && typeof v.accounts === 'object' && !Array.isArray(v.accounts)) for (const [id, account] of Object.entries(v.accounts)) {
    if (!account || typeof account !== 'object') continue;
    accounts[id] = { label: typeof account.label === 'string' ? account.label.slice(0, 60) : undefined, color: typeof account.color === 'string' && /^#[a-f\d]{6}$/iu.test(account.color) ? account.color : undefined,
      folders: Array.isArray(account.folders) && account.folders.length ? account.folders.filter(folder => typeof folder === 'string').slice(0, 30) : ['0'], notifications: account.notifications !== false,
      otp: typeof account.otp?.enabled === 'boolean' ? { enabled: account.otp.enabled } : undefined };
  }
  const quiet: QuietRule[] = Array.isArray(v.quiet) ? v.quiet.filter(item => item && typeof item.contains === 'string' && item.contains.trim()).slice(0, 100).map(item => ({ id: String(item.id || crypto.randomUUID()), contains: item.contains.slice(0, 200), field: item.field === 'subject' ? 'subject' : 'sender', enabled: item.enabled !== false, accountId: typeof item.accountId === 'string' ? item.accountId : undefined })) : [];
  return { ...d, scheme: ['light', 'dark', 'auto'].includes(v.scheme || '') ? v.scheme! : d.scheme,
    theme: ['evergreen', 'sand', 'midnight'].includes(v.theme || '') ? v.theme! : d.theme,
    density: ['compact', 'comfortable', 'relaxed'].includes(v.density || '') ? v.density! : d.density,
    customCSS: typeof v.customCSS === 'string' ? v.customCSS.slice(0, 30000) : '', previews: Math.max(0, Math.min(3, Number(v.previews) || 0)),
    appVersion: typeof v.appVersion === 'string' && /^web-mail@[\d.]+$/u.test(v.appVersion) ? v.appVersion : d.appVersion,
    notifications: v.notifications !== false, dndUntil: typeof v.dndUntil === 'number' ? v.dndUntil : 0,
    otp: { enabled: v.otp?.enabled !== false, builtIn: v.otp?.builtIn !== false, context: v.otp?.context !== false, custom: v.otp?.custom !== false,
      minimum: Math.max(4, Math.min(16, Number(v.otp?.minimum) || 4)), maximum: Math.max(4, Math.min(16, Number(v.otp?.maximum) || 8)), patterns },
    accounts, quiet,
    pollSeconds: Math.max(30, Math.min(3600, Number(v.pollSeconds) || d.pollSeconds)), limit: Math.max(1, Math.min(100, Number(v.limit) || d.limit)),
    width: Math.max(380, Math.min(800, Number(v.width) || d.width)), height: Math.max(400, Math.min(600, Number(v.height) || d.height)),
  };
}
