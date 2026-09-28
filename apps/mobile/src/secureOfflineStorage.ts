import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';

const secretKey = (userId: string) => `schoolconnect:offline-secret:${userId}`;
const keyPromises = new Map<string, Promise<AESEncryptionKey>>();

async function userKey(userId: string): Promise<AESEncryptionKey> {
  const existing = keyPromises.get(userId);
  if (existing) return existing;
  const pending = (async () => {
    const stored = await SecureStore.getItemAsync(secretKey(userId));
    if (stored) return AESEncryptionKey.import(stored, 'base64');
    const generated = await AESEncryptionKey.generate();
    await SecureStore.setItemAsync(secretKey(userId), await generated.encoded('base64'), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return generated;
  })();
  keyPromises.set(userId, pending);
  try { return await pending; }
  catch (error) { keyPromises.delete(userId); throw error; }
}

export const secureOfflineStorage = {
  async getItem(userId: string, key: string) {
    const stored = await AsyncStorage.getItem(key);
    if (!stored || Platform.OS === 'web') return stored;
    if (!stored.startsWith('v1:')) {
      // Upgrade previously stored local data in place after the user unlocks the app.
      await this.setItem(userId, key, stored);
      return stored;
    }
    const sealed = AESSealedData.fromCombined(stored.slice(3));
    return new TextDecoder().decode(await aesDecryptAsync(sealed, await userKey(userId)));
  },
  async setItem(userId: string, key: string, value: string) {
    if (Platform.OS === 'web') { await AsyncStorage.setItem(key, value); return; }
    const sealed = await aesEncryptAsync(new TextEncoder().encode(value), await userKey(userId));
    await AsyncStorage.setItem(key, `v1:${await sealed.combined('base64')}`);
  },
  getAllKeys: () => AsyncStorage.getAllKeys(),
  removeItem: (key: string) => AsyncStorage.removeItem(key),
  multiRemove: (keys: string[]) => AsyncStorage.multiRemove(keys),
  async clearUserKey(userId: string) {
    keyPromises.delete(userId);
    if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(secretKey(userId));
  },
};
