// Copyright (c) 2026 jahanaj098. SPDX-License-Identifier: GPL-3.0-only
import { base64, bytes } from './encoding';
interface SealedValue { version: 1; nonce: string; ciphertext: string }
export interface LocalArea { get(key: string): Promise<Record<string, unknown>>; set(value: Record<string, unknown>): Promise<void>; remove(key: string): Promise<void> }
export class DeviceVault {
  private key: Promise<CryptoKey> | undefined;
  constructor(private area: LocalArea, private keyProvider = deviceKey) {}
  private getKey(): Promise<CryptoKey> { return this.key ??= this.keyProvider(); }
  async put(id: string, value: unknown): Promise<void> {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(id) }, await this.getKey(), new TextEncoder().encode(JSON.stringify(value)));
    await this.area.set({ [id]: { version: 1, nonce: base64(nonce), ciphertext: base64(new Uint8Array(ciphertext)) } satisfies SealedValue });
  }
  async get<T>(id: string): Promise<T | undefined> {
    const result = (await this.area.get(id))[id] as SealedValue | undefined;
    if (!result) return undefined;
    if (result.version !== 1) throw new Error('Unsupported vault record');
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(result.nonce), additionalData: new TextEncoder().encode(id) }, await this.getKey(), bytes(result.ciphertext));
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  }
  remove(id: string): Promise<void> { return this.area.remove(id); }
}
async function deviceKey(): Promise<CryptoKey> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('quickcode-vault', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('keys');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    const stored = await new Promise<CryptoKey | undefined>((resolve, reject) => {
      const request = database.transaction('keys').objectStore('keys').get('device');
      request.onsuccess = () => resolve(request.result as CryptoKey | undefined); request.onerror = () => reject(request.error);
    });
    if (stored) return stored;
    const created = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('keys', 'readwrite');
      transaction.objectStore('keys').put(created, 'device'); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
    });
    return created;
  } finally { database.close(); }
}
