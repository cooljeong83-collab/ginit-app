import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import type { ProfileBundledNotificationSoundId, ProfileNotificationSoundId } from '@/src/lib/profile-notification-sound-preference';

const BUNDLE_REQUIRES: Record<ProfileBundledNotificationSoundId, number> = {
  ginit_ring_c1: require('../../assets/sounds/ginit_ring_c1.wav'),
  ginit_ring_w: require('../../assets/sounds/ginit_bell_1.wav'),
};

let playing: AudioPlayer | null = null;
let statusListener: { remove: () => void } | null = null;

export async function stopProfileNotificationSoundPreview(): Promise<void> {
  if (statusListener) {
    try {
      statusListener.remove();
    } catch {
      /* noop */
    }
    statusListener = null;
  }
  if (!playing) return;
  try {
    playing.pause();
    await playing.seekTo(0);
    playing.remove();
  } catch {
    /* noop */
  }
  playing = null;
}

/**
 * 번들 알림음 WAV 재생. `default`는 호출하지 말 것.
 */
export async function playProfileNotificationSoundPreview(id: ProfileNotificationSoundId): Promise<void> {
  await stopProfileNotificationSoundPreview();
  if (id === 'default') return;

  const src = BUNDLE_REQUIRES[id as ProfileBundledNotificationSoundId];
  if (src == null) return;

  ginitNotifyDbg('notify-sound-diag', 'preview_play', {
    id,
    bundleAssetModuleId: typeof src === 'number' ? src : 'non-number',
  });

  await setAudioModeAsync({
    playsInSilentMode: true,
    allowsRecording: false,
    shouldPlayInBackground: false,
    interruptionMode: 'duckOthers',
    shouldRouteThroughEarpiece: false,
  });

  const player = createAudioPlayer(src);
  playing = player;

  statusListener = player.addListener('playbackStatusUpdate', (status) => {
    if (status.didJustFinish) {
      void stopProfileNotificationSoundPreview();
    }
  });

  player.play();
}
