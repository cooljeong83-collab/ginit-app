import * as SecureStore from 'expo-secure-store';

/** 네이티브: Expo SecureStore */
export async function compatSetItemAsync(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

export async function compatGetItemAsync(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

export async function compatDeleteItemAsync(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* noop */
  }
}
