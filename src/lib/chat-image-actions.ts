import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export async function shareRemoteImageUrl(url: string): Promise<void> {
  const u = url.trim();
  if (!u) return;
  const dl = await FileSystem.downloadAsync(u, FileSystem.cacheDirectory + `ginit-chat-${Date.now()}.jpg`);
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('공유 기능을 사용할 수 없어요.');
  }
  await Sharing.shareAsync(dl.uri);
}

export async function saveRemoteImageUrlToLibrary(url: string): Promise<void> {
  const u = url.trim();
  if (!u) return;
  const dl = await FileSystem.downloadAsync(u, FileSystem.cacheDirectory + `ginit-chat-${Date.now()}.jpg`);
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('저장 기능을 사용할 수 없어요.');
  }
  // iOS/Android: 공유 시트에서 "사진 저장" 등으로 저장 가능
  await Sharing.shareAsync(dl.uri, { dialogTitle: '사진 저장' });
}

