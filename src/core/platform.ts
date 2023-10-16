// Copyright (c) 2026 jahanaj098. SPDX-License-Identifier: GPL-3.0-only
export const extension: typeof chrome = (globalThis as typeof globalThis & { browser?: typeof chrome }).browser ?? chrome;
export interface ResponseEnvelope<T> { ok: boolean; value?: T; error?: string; code?: string }
export async function call<T>(operation: string, data: unknown = {}): Promise<T> {
  const response: ResponseEnvelope<T> = await extension.runtime.sendMessage({ quickcode: 1, operation, data });
  if (!response?.ok) throw new Error(response?.error || 'QuickCode did not respond. Open the extension again.');
  return response.value as T;
}
