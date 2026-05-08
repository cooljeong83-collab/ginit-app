import { NativeModules, Platform } from 'react-native';

type NativePendingShare = {
  text?: string | null;
  imageUri?: string | null;
};

/** Android `GinitDirectShare.setShareShortcuts` 페이로드(동적 Direct Share). */
export type NativeShareShortcutItem = {
  id: string;
  title: string;
  subtitle?: string | null;
  targetType: string;
  targetId: string;
  avatarUrl?: string | null;
};

type DirectShareNativeModule = {
  consumePendingShare?: () => Promise<NativePendingShare | null> | NativePendingShare | null;
  setShareShortcuts?: (items: NativeShareShortcutItem[]) => Promise<void> | void;
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

export async function setNativeShareShortcuts(items: NativeShareShortcutItem[]): Promise<void> {
  const m = getModule();
  const fn = m?.setShareShortcuts;
  if (typeof fn !== 'function') return;
  try {
    await fn(items);
  } catch {
    // ignore
  }
}

