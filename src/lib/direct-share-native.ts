import { NativeModules, Platform } from 'react-native';

type NativePendingShare = {
  text?: string | null;
  imageUri?: string | null;
};

type DirectShareNativeModule = {
  consumePendingShare?: () => Promise<NativePendingShare | null> | NativePendingShare | null;
  setShareShortcuts?: (items: unknown[]) => Promise<void> | void;
};

function getModule(): DirectShareNativeModule | null {
  if (Platform.OS !== 'android') return null;
  const m = (NativeModules as Record<string, unknown> | undefined)?.GinitDirectShare;
  if (!m || typeof m !== 'object') return null;
  return m as DirectShareNativeModule;
}

export async function consumeNativePendingShare(): Promise<NativePendingShare | null> {
  const m = getModule();
  const fn = m?.consumePendingShare;
  if (typeof fn !== 'function') return null;
  try {
    const out = await fn();
    if (!out || typeof out !== 'object') return null;
    return out as NativePendingShare;
  } catch {
    return null;
  }
}

export async function setNativeShareShortcuts(items: unknown[]): Promise<void> {
  const m = getModule();
  const fn = m?.setShareShortcuts;
  if (typeof fn !== 'function') return;
  try {
    await fn(items);
  } catch {
    // ignore
  }
}

