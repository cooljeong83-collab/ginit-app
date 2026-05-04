import { Audio } from 'expo-av';

import type { ProfileBundledNotificationSoundId, ProfileNotificationSoundId } from '@/src/lib/profile-notification-sound-preference';

const BUNDLE_REQUIRES: Record<ProfileBundledNotificationSoundId, number> = {
  ginit_ring_c1: require('../../assets/sounds/ginit_ring_c1.wav'),
  ginit_ring_w: require('../../assets/sounds/ginit_ring_w.wav'),
};

let playing: Audio.Sound | null = null;

export async function stopProfileNotificationSoundPreview(): Promise<void> {
  if (!playing) return;
  try {
    await playing.stopAsync();
    await playing.unloadAsync();
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

  await Audio.setAudioModeAsync({
    playsInSilentModeIOS: true,
    allowsRecordingIOS: false,
    staysActiveInBackground: false,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  });

  const { sound } = await Audio.Sound.createAsync(src, { shouldPlay: true, volume: 1 });
  playing = sound;

  sound.setOnPlaybackStatusUpdate((status) => {
    if (status.isLoaded && status.didJustFinish) {
      void stopProfileNotificationSoundPreview();
    }
  });
}
