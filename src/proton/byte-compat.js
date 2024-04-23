// Copyright (c) 2026 jahanaj098. SPDX-License-Identifier: GPL-3.0-only
// Minimal byte encodings for the published crypto SDK on Chrome 121+.
// No dynamic code execution, remote imports, or broad DOM polyfills.
import { base64, bytes } from '../core/encoding';
if (!Uint8Array.fromBase64) Object.defineProperty(Uint8Array, 'fromBase64', { value: value => bytes(String(value)), configurable: true });
if (!Uint8Array.prototype.toBase64) Object.defineProperty(Uint8Array.prototype, 'toBase64', { value: function () { return base64(this); }, configurable: true });
if (!Uint8Array.prototype.toHex) Object.defineProperty(Uint8Array.prototype, 'toHex', { value: function () { return [...this].map(byte => byte.toString(16).padStart(2, '0')).join(''); }, configurable: true });
if (!Uint8Array.fromHex) Object.defineProperty(Uint8Array, 'fromHex', { value: value => {
  if (typeof value !== 'string' || value.length % 2 || !/^[a-f\d]*$/iu.test(value)) throw new Error('Invalid hex encoding');
  return Uint8Array.from(value.match(/.{2}/gu) || [], pair => parseInt(pair, 16));
}, configurable: true });
