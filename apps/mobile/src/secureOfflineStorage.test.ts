/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const state = vi.hoisted(() => ({ stored: new Map<string, string>(), keys: new Map<string, string>(), platform: { OS: 'android' } }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (key: string) => state.stored.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { state.stored.set(key, value); }),
  getAllKeys: async () => [...state.stored.keys()],
  removeItem: async (key: string) => { state.stored.delete(key); },
  multiRemove: async (keys: string[]) => { keys.forEach(key => state.stored.delete(key)); },
} }));
vi.mock('react-native', () => ({ Platform: state.platform }));
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
  getItemAsync: async (key: string) => state.keys.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { state.keys.set(key, value); },
  deleteItemAsync: async (key: string) => { state.keys.delete(key); },
}));
vi.mock('expo-crypto', () => ({
  AESEncryptionKey: {
    generate: async () => ({ bytes: randomBytes(32), async encoded() { return this.bytes.toString('base64'); } }),
    import: async (value: string, encoding: string) => { expect(encoding).toBe('base64'); return { bytes: Buffer.from(value, 'base64') }; },
  },
  AESSealedData: { fromCombined: (value: unknown) => {
    // Model Android's real Kotlin ByteArray contract, not the permissive JS type.
    if (!(value instanceof Uint8Array)) throw new Error('Cannot convert string to Kotlin byte array');
    return { bytes: Buffer.from(value) };
  } },
  aesEncryptAsync: async (plaintext: Uint8Array, key: { bytes: Buffer }) => {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key.bytes, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const combined = Buffer.concat([iv, encrypted, cipher.getAuthTag()]);
    return { combined: async (encoding: string) => { expect(encoding).toBe('base64'); return combined.toString('base64'); } };
  },
  aesDecryptAsync: async (sealed: { bytes: Buffer }, key: { bytes: Buffer }) => {
    const decipher = createDecipheriv('aes-256-gcm', key.bytes, sealed.bytes.subarray(0, 12));
    decipher.setAuthTag(sealed.bytes.subarray(-16));
    return Buffer.concat([decipher.update(sealed.bytes.subarray(12, -16)), decipher.final()]);
  },
}));

import { secureOfflineStorage } from './secureOfflineStorage';
beforeEach(async () => { await secureOfflineStorage.clearUserKey('one'); await secureOfflineStorage.clearUserKey('two'); state.stored.clear(); state.keys.clear(); state.platform.OS = 'android'; });
afterEach(() => { state.platform.OS = 'android'; });
describe('native encrypted draft storage regression', () => {
  it('reads an existing v1 base64 envelope as native bytes without rotating its key', async () => {
    const text = JSON.stringify({ title: 'Midyear result', body: 'हिन्दी · محمد', student: 'child-1' });
    await secureOfflineStorage.setItem('one', 'draft', text);
    const before = state.stored.get('draft')!; const originalKey = [...state.keys.values()][0];
    expect(before).toMatch(/^v1:/); expect(before).not.toContain('Midyear');
    expect(await secureOfflineStorage.getItem('one', 'draft')).toBe(text);
    expect(state.stored.get('draft')).toBe(before); expect([...state.keys.values()][0]).toBe(originalKey);
  });
  it('imports the saved key after an app restart and still decrypts the old envelope', async () => {
    await secureOfflineStorage.setItem('one', 'draft', 'saved result');
    vi.resetModules(); const restarted = (await import('./secureOfflineStorage')).secureOfflineStorage;
    expect(await restarted.getItem('one', 'draft')).toBe('saved result');
    await restarted.clearUserKey('one');
  });
  it('fails closed for another user without deleting or rewriting the draft', async () => {
    await secureOfflineStorage.setItem('one', 'draft', 'private result'); const before = state.stored.get('draft');
    await expect(secureOfflineStorage.getItem('two', 'draft')).rejects.toThrow();
    expect(state.stored.get('draft')).toBe(before);
  });
  it('rejects a tampered authentication tag and preserves the original bytes', async () => {
    await secureOfflineStorage.setItem('one', 'draft', 'private result');
    const bytes = Buffer.from(state.stored.get('draft')!.slice(3), 'base64'); bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    const tampered = `v1:${bytes.toString('base64')}`; state.stored.set('draft', tampered);
    await expect(secureOfflineStorage.getItem('one', 'draft')).rejects.toThrow(); expect(state.stored.get('draft')).toBe(tampered);
  });
  it('upgrades legacy plaintext locally without changing its content', async () => {
    state.stored.set('draft', '{"title":"legacy"}');
    expect(await secureOfflineStorage.getItem('one', 'draft')).toBe('{"title":"legacy"}');
    expect(state.stored.get('draft')).toMatch(/^v1:/);
  });
  it('preserves the existing web storage behavior', async () => {
    state.platform.OS = 'web'; await secureOfflineStorage.setItem('one', 'draft', 'web draft');
    expect(await secureOfflineStorage.getItem('one', 'draft')).toBe('web draft'); expect(state.keys.size).toBe(0);
  });
});
