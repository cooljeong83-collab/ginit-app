import * as MediaLibrary from 'expo-media-library';
import { Alert, Platform, ToastAndroid } from 'react-native';

import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

function guessFilenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() ?? '';
    const clean = last.split('?')[0]?.trim() ?? '';
    if (clean) return clean;
  } catch {
    // ignore
  }
  return `image_${Date.now()}.jpg`;
}

function ensureHasImageExtension(filename: string): string {
  const f = (filename ?? '').trim();
  if (!f) return `image_${Date.now()}.jpg`;
  // Android의 MediaStore 저장은 확장자가 없으면 실패할 수 있어 기본 jpg로 보강합니다.
  if (/\.[a-z0-9]{2,6}$/i.test(f)) return f;
  return `${f}.jpg`;
}

async function downloadRemoteFileToCache(url: string): Promise<string> {
  const u = url.trim();
  if (!u) throw new Error('이미지 주소가 비어 있어요.');
  const dir = new Directory(Paths.cache, 'ginit-chat-downloads');
  try {
    await dir.create({ intermediates: true });
  } catch (e) {
    // 경쟁 조건 등으로 "이미 존재"가 뜨는 경우는 무시합니다.
    const msg = e instanceof Error ? e.message : String(e ?? '');
    if (!/already exists/i.test(msg)) {
      throw e;
    }
  }

  // 임시 디렉토리에 먼저 다운로드(Expo 54+ 최신 API)
  // 같은 폴더에 매번 생성해도 충돌을 피하기 위해 파일명을 랜덤화합니다.
  const name = ensureHasImageExtension(guessFilenameFromUrl(u));
  const rand = Math.random().toString(36).slice(2, 8);
  const file = new File(dir, `${Date.now()}_${rand}_${name}`);
  const downloaded = await File.downloadFileAsync(u, file);
  return downloaded.uri;
}

export async function shareRemoteImageUrl(url: string): Promise<void> {
  const u = url.trim();
  if (!u) return;
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('공유 기능을 사용할 수 없어요.');
  }
  const localUri = await downloadRemoteFileToCache(u);
  await Sharing.shareAsync(localUri);
}

export async function saveRemoteImageUrlToLibrary(url: string): Promise<void> {
  const u = url.trim();
  if (!u) return;
  const notify = (msg: string) => {
    if (Platform.OS === 'android') ToastAndroid.show(msg, ToastAndroid.SHORT);
    else Alert.alert('안내', msg);
  };
  try {
    // 권한 확인 (필수)
    const perm =
      Platform.OS === 'android' && typeof Platform.Version === 'number' && Platform.Version >= 33
        ? // Android 13+(Tiramisu): 사진만 요청(오디오 등 불필요 권한 팝업 방지)
          // NOTE: expo-media-library(stable)은 옵션 객체가 아니라 positional args 입니다.
          await (MediaLibrary.requestPermissionsAsync as any)(true, ['photo'])
        : await (MediaLibrary.requestPermissionsAsync as any)(true);
    if (!perm.granted) {
      Alert.alert('권한 필요', '사진을 저장하려면 사진(미디어) 접근 권한이 필요해요.');
      return;
    }

    notify('사진을 다운로드하는 중…');
    const localUri = await downloadRemoteFileToCache(u);

    // 갤러리(앨범)로 저장
    await MediaLibrary.saveToLibraryAsync(localUri);
    notify('사진을 갤러리에 저장했어요.');
  } catch (e) {
    // 네트워크/파일/권한 등 어떤 경우든 앱이 죽지 않게 안전 처리
    const msg = e instanceof Error ? e.message : String(e ?? '');
    if (__DEV__ && msg) {
      console.warn('[saveRemoteImageUrlToLibrary]', msg);
    }
    notify('저장에 실패했어요. 잠시 후 다시 시도해 주세요.');
  }
}

