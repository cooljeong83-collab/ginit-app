import * as ImagePicker from 'expo-image-picker';
import { InteractionManager, Platform } from 'react-native';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Android에서 미디어 권한 요청 직후·레이아웃 전환 직후에 `launchImageLibraryAsync`를 호출하면
 * `ActivityResultLauncher`가 아직 등록되지 않아 `IllegalStateException`(unregistered launcher)이
 * 발생하는 경우가 있어, 다음 프레임 이후에 짧게 지연한 뒤 갤러리를 엽니다.
 * iOS·웹은 지연 없이 즉시 호출합니다.
 */
export async function launchImageLibraryAsyncSafe(
  options?: Parameters<typeof ImagePicker.launchImageLibraryAsync>[0],
): Promise<Awaited<ReturnType<typeof ImagePicker.launchImageLibraryAsync>>> {
  if (Platform.OS === 'android') {
    await new Promise<void>((resolve) => {
      InteractionManager.runAfterInteractions(() => resolve());
    });
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    await sleep(160);
  }
  return ImagePicker.launchImageLibraryAsync(options ?? {});
}
