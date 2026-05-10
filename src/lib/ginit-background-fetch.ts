import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

/** OS가 주기적으로 깨울 때 실행되는 작업 이름(전역 등록 필수) */
export const GINIT_BACKGROUND_FETCH_TASK = 'ginit-background-fetch';

TaskManager.defineTask(GINIT_BACKGROUND_FETCH_TASK, async () => {
  try {
    await AsyncStorage.setItem('ginit_last_background_fetch_ms', String(Date.now()));
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/**
 * 백그라운드에서 주기적으로 JS가 깨어나도록 등록합니다.
 * - iOS: 사용자가 설정에서 "백그라운드 앱 새로고침"을 허용한 경우에만 의미가 있습니다.
 * - Android: 강제 종료(swipe away) 후에는 제조사/OS 정책에 따라 중단될 수 있습니다.
 */
export async function registerGinitBackgroundFetchAsync(): Promise<void> {
  const status = await BackgroundTask.getStatusAsync();
  if (status === BackgroundTask.BackgroundTaskStatus.Restricted) {
    return;
  }
  const registered = await TaskManager.isTaskRegisteredAsync(GINIT_BACKGROUND_FETCH_TASK);
  if (registered) return;
  await BackgroundTask.registerTaskAsync(GINIT_BACKGROUND_FETCH_TASK, {
    /** 분 단위(최소 15). 실제 간격은 OS가 조절합니다. */
    minimumInterval: 15,
  });
}
