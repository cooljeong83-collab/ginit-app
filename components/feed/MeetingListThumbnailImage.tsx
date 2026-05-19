import { Image } from 'expo-image';
import { useMemo } from 'react';
import {
  Image as RNImage,
  Platform,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Grayscale } from 'react-native-color-matrix-image-filters';

import { MEETING_LIST_IMAGE_BLURHASH } from '@/src/lib/expo-image-meeting-placeholder';
import { firstKakaoPlaceDetailPageUrlFromMeeting } from '@/src/lib/feed-meeting-utils';
import {
  firstPlaceCandidatePreferredPhotoUri,
  meetingHasMovieListPoster,
  resolveMeetingListThumbnailUri,
} from '@/src/lib/meeting-list-thumbnail';
import type { Meeting } from '@/src/lib/meetings';
import { useKakaoPlaceListThumbnail } from '@/src/lib/use-kakao-place-list-thumbnail';
import { withSupabaseStorageListThumbnail } from '@/src/lib/supabase-public-image-thumbnail';

const THUMB_GRAYSCALE_WEB = Platform.select<ImageStyle>({
  web: { filter: 'grayscale(100%)' } as ImageStyle,
  default: {},
});

type Props = {
  meeting: Meeting;
  style: StyleProp<ImageStyle>;
  recyclingKey?: string;
  /** 홈 종료 탭·채팅 모임 목록 등 — 썸네일만 흑백 */
  grayscale?: boolean;
};

/**
 * 모임 목록·지도 리스트용 썸네일: 저장된 카카오맵 `place_url`(og:image)이 있으면 우선, 없으면 `resolveMeetingListThumbnailUri`.
 * 영화 포스터가 있으면 카카오를 쓰지 않습니다.
 */
export function MeetingListThumbnailImage({ meeting, style, recyclingKey, grayscale = false }: Props) {
  const baseUri = useMemo(() => resolveMeetingListThumbnailUri(meeting), [meeting]);
  const preferredPlacePhoto = useMemo(
    () => (meetingHasMovieListPoster(meeting) ? undefined : firstPlaceCandidatePreferredPhotoUri(meeting)),
    [meeting],
  );
  const kakaoPage = useMemo(
    () => (meetingHasMovieListPoster(meeting) ? null : firstKakaoPlaceDetailPageUrlFromMeeting(meeting)),
    [meeting],
  );
  const { uri: kakaoUri } = useKakaoPlaceListThumbnail(kakaoPage);
  const rawUri = preferredPlacePhoto ?? kakaoUri ?? baseUri;
  const uri = useMemo(() => {
    const u = typeof rawUri === 'string' ? rawUri.trim() : '';
    if (!u) return '';
    return withSupabaseStorageListThumbnail(u, 280) ?? u;
  }, [rawUri]);

  if (!uri) {
    return <View style={style as StyleProp<ViewStyle>} accessibilityElementsHidden />;
  }

  if (!grayscale) {
    return (
      <Image
        source={{ uri }}
        style={style}
        contentFit="cover"
        cachePolicy="disk"
        recyclingKey={recyclingKey ?? meeting.id}
        placeholder={{ blurhash: MEETING_LIST_IMAGE_BLURHASH }}
        accessibilityIgnoresInvertColors
      />
    );
  }

  if (Platform.OS === 'web') {
    return (
      <Image
        source={{ uri }}
        style={[style, THUMB_GRAYSCALE_WEB]}
        contentFit="cover"
        cachePolicy="disk"
        recyclingKey={recyclingKey ?? meeting.id}
        placeholder={{ blurhash: MEETING_LIST_IMAGE_BLURHASH }}
        accessibilityIgnoresInvertColors
      />
    );
  }

  return (
    <Grayscale style={style as StyleProp<ViewStyle>} pointerEvents="none">
      <RNImage source={{ uri }} style={style} resizeMode="cover" accessibilityIgnoresInvertColors />
    </Grayscale>
  );
}
