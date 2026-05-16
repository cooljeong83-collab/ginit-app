import type { Meeting } from '@/src/lib/meetings';
import type { MeetingExtraData, SelectedMovieExtra } from '@/src/lib/meeting-extra-data';
import { withSupabaseStorageListThumbnail } from '@/src/lib/supabase-public-image-thumbnail';

function trimMovieForList(mv: SelectedMovieExtra | null | undefined): SelectedMovieExtra | null {
  if (!mv || typeof mv !== 'object') return null;
  const id = typeof mv.id === 'string' ? mv.id.trim() : '';
  const title = typeof mv.title === 'string' ? mv.title.trim() : '';
  const posterUrl = typeof mv.posterUrl === 'string' ? mv.posterUrl.trim() : '';
  if (!id && !posterUrl) return null;
  const out: SelectedMovieExtra = { id: id || 'movie', title: title || '제목 미정' };
  if (posterUrl) out.posterUrl = posterUrl;
  return out;
}

function slimExtraDataForList(m: Meeting): Meeting['extraData'] {
  const raw = m.extraData;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const ex = raw as MeetingExtraData;
  if (ex.specialtyKind !== 'movie') return null;
  const movie = trimMovieForList(ex.movie ?? null);
  const movies = Array.isArray(ex.movies)
    ? (ex.movies.map(trimMovieForList).filter((x): x is SelectedMovieExtra => Boolean(x)) as SelectedMovieExtra[])
    : null;
  if (!movie && (!movies || movies.length === 0)) return null;
  return { specialtyKind: 'movie', movie, movies: movies && movies.length > 0 ? movies : null };
}

function trimPlaceCandidatesForList(m: Meeting): Meeting['placeCandidates'] {
  const pc = m.placeCandidates;
  if (!Array.isArray(pc) || pc.length === 0) return null;
  const first = pc[0];
  if (!first || typeof first !== 'object') return null;
  return [
    {
      id: typeof first.id === 'string' ? first.id : '',
      placeName: typeof first.placeName === 'string' ? first.placeName : '',
      address: typeof first.address === 'string' ? first.address : '',
      latitude: typeof first.latitude === 'number' ? first.latitude : 0,
      longitude: typeof first.longitude === 'number' ? first.longitude : 0,
      category: typeof first.category === 'string' ? first.category : null,
      naverPlaceLink: typeof first.naverPlaceLink === 'string' ? first.naverPlaceLink : null,
      preferredPhotoMediaUrl:
        typeof first.preferredPhotoMediaUrl === 'string' ? first.preferredPhotoMediaUrl : null,
    },
  ];
}

/**
 * 피드·목록용 경량 `Meeting` — 캐시 원본은 유지하고 `select` 경로에서만 사용합니다.
 * (상세 설명·투표·채팅 읽음·정산 등 목록에서 쓰지 않는 큰 필드 제거)
 */
export function slimMeetingForFeedList(m: Meeting): Meeting {
  const imageUrl = withSupabaseStorageListThumbnail(m.imageUrl, 320);
  return {
    ...m,
    description: '',
    extraData: slimExtraDataForList(m),
    dateCandidates: null,
    placeCandidates: trimPlaceCandidatesForList(m),
    voteTallies: null,
    participantVoteLog: null,
    joinRequests: null,
    chatReadAtBy: null,
    chatReadMessageIdBy: null,
    kickedParticipantIds: null,
    settlementInfo: null,
    locationData: null,
    imageUrl: imageUrl ?? m.imageUrl,
  };
}
