import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';

/** OS가 주기적으로 깨울 때 실행되는 작업 이름(전역 등록 필수) */
export const GINIT_BACKGROUND_FETCH_TASK = 'ginit-background-fetch';

const LAST_WAKE_KEY = 'ginit_last_background_fetch_ms';

TaskManager.defineTask(GINIT_BACKGROUND_FETCH_TASK, async () => {
  try {
    await AsyncStorage.setItem(LAST_WAKE_KEY, String(Date.now()));
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

/**
 * 백그라운드에서 주기적으로 JS가 깨어나도록 등록합니다.
 * - iOS: 사용자가 설정에서 "백그라운드 앱 새로고침"을 허용한 경우에만 의미가 있습니다.
 * - Android: 강제 종료(swipe away) 후에는 `stopOnTerminate: false`여도 제조사/OS 정책에 따라 중단될 수 있습니다.
 */
export async function registerGinitBackgroundFetchAsync(): Promise<void> {
  const status = await BackgroundFetch.getStatusAsync();
  if (
    status === BackgroundFetch.BackgroundFetchStatus.Denied ||
    status === BackgroundFetch.BackgroundFetchStatus.Restricted
  ) {
    return;
  }
  const registered = await TaskManager.isTaskRegisteredAsync(GINIT_BACKGROUND_FETCH_TASK);
  if (registered) return;
  await BackgroundFetch.registerTaskAsync(GINIT_BACKGROUND_FETCH_TASK, {
    /** 초 단위(권장 최소에 가깝게). 실제 간격은 OS가 조절합니다. */
    minimumInterval: 15 * 60,
    stopOnTerminate: false,
    startOnBoot: true,
  });
}
