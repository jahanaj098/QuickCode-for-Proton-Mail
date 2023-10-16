// Copyright (c) 2026 jahanaj098. SPDX-License-Identifier: GPL-3.0-only
export function base64(data: Uint8Array): string {
  let result = '';
  for (let offset = 0; offset < data.length; offset += 16384) result += String.fromCharCode(...data.subarray(offset, offset + 16384));
  return btoa(result);
}
export function bytes(value: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
export function join(...values: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(values.reduce((n, value) => n + value.length, 0));
  let position = 0; for (const value of values) { result.set(value, position); position += value.length; } return result;
}
export function equalSecret(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) difference |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  return difference === 0;
}
