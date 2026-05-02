
import * as Font from 'expo-font';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { type RefObject, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { NaverPlaceWebViewModal } from '@/components/NaverPlaceWebViewModal';
import { GinitTheme } from '@/constants/ginit-theme';
import { layoutAnimateEaseInEaseOut } from '@/src/lib/android-layout-animation';
import { fetchDailyBoxOfficeTop10 } from '@/src/lib/kobis-daily-box-office';
import type { SelectedMovieExtra } from '@/src/lib/meeting-extra-data';
import { resolveNaverMovieSearchWebUrl } from '@/src/lib/naver-local-search';
import { enrichMoviesWithTmdbPosters, normalizeTmdbPosterUrl } from '@/src/lib/tmdb-movie-poster';

import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { wizardSpecialtyStyles as S } from './wizard-specialty-styles';

const TRUST_BLUE = GinitTheme.colors.primary;

const PRETENDARD_BOLD_URI =
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/public/static/Pretendard-Bold.otf';

/** 데모 포스터(항상 로드). 운영 시 TMDB/KOBIS 등으로 교체 가능. */
function demoPosterUrl(label: string): string {
  return `https://placehold.co/185x278/0f172a/0052CC/png?text=${encodeURIComponent(label.slice(0, 10))}`;
}

/** KOBIS 실패 시에만 쓰는 정적 폴백(최대 10). */
const STATIC_BOX_OFFICE_FALLBACK: SelectedMovieExtra[] = [
  {
    id: 'dune2',
    title: '듄: 파트 2',
    year: '2024',
    rating: '8.5',
    posterUrl: demoPosterUrl('Dune 2'),
    info: '데니 빌뇌브가 연출한 SF 서사로, 아라키스 모래별을 둘러싼 패멀라인 가문과 프레멘의 운명이 교차한다. 압도적인 사막 미학과 정치 음모가 얽히며 전쟁의 서막이 열린다.',
  },
  {
    id: 'oppenheimer',
    title: '오펜하이머',
    year: '2023',
    rating: '8.4',
    posterUrl: demoPosterUrl('Oppen'),
    info: '원자폭탄 개발을 주도한 로버트 오펜하이머의 내면과 윤리적 갈등을 그린 전기 드라마. 거대한 과학과 역사의 무게가 한 사람의 시선으로 압축된다.',
  },
  {
    id: 'concrete',
    title: '콘크리트 유토피아',
    year: '2023',
    rating: '7.3',
    posterUrl: demoPosterUrl('Concrete'),
    info: '서울 대지진 이후 무너진 아파트 단지에 남은 이웃들의 생존과 신뢰가 시험받는 재난 스릴러. 좁은 공간에서 폭발하는 긴장감이 극대화된다.',
  },
  {
    id: 'parasite',
    title: '기생충',
    year: '2019',
    rating: '8.5',
    posterUrl: demoPosterUrl('Parasite'),
    info: '반지하 가족과 박원봉 가문의 삶이 교차하며 계급의 틈이 드러나는 봉준호 감독의 블랙 코미디. 칸 황금종려상과 아카데미 작품상을 수상한 한국 영화의 이정표.',
  },
  {
    id: 'decision',
    title: '헤어질 결심',
    year: '2022',
    rating: '7.3',
    posterUrl: demoPosterUrl('Decision'),
    info: '산에서 추락한 남자의 사건을 수사하던 형사는 그의 아내와 마주치며 사랑과 의심 사이에서 흔들린다. 박찬욱 감독 특유의 서늘한 멜로와 서스펜스가 어우러진다.',
  },
  {
    id: 'broker',
    title: '브로커',
    year: '2022',
    rating: '7.1',
    posterUrl: demoPosterUrl('Broker'),
    info: '아기 박스에 놓인 생명을 둘러싼 이들의 여정을 그린 고레에다 히로카즈 작품. 버려진 아이와 선택의 무게를 조용한 시선으로 포착한다.',
  },
  {
    id: 'hunt',
    title: '헌트',
    year: '2022',
    rating: '6.8',
    posterUrl: demoPosterUrl('Hunt'),
    info: '대통령 암살 미수 사건을 추적하는 정보기관 내부의 스파이를 찾는 액션 스릴러. 이정재·정우성의 대립이 긴장감을 끌어올린다.',
  },
  {
    id: 'suzume',
    title: '스즈메의 문단속',
    year: '2022',
    rating: '7.7',
    posterUrl: demoPosterUrl('Suzume'),
    info: '일본 곳곳에 나타나는 재난의 문을 닫아야 하는 소녀 스즈메의 성장 이야기. 신카이 마코토 특유의 빛과 여정의 서사가 담겼다.',
  },
  {
    id: 'elemental',
    title: '엘리멘탈',
    year: '2023',
    rating: '7.0',
    posterUrl: demoPosterUrl('Elemental'),
    info: '불·물·공기·흙 원소가 공존하는 도시에서 불 원소 엠버와 물 원소 웨이드의 사랑이 펼쳐진다. 편견과 어울림을 담은 디즈니·픽사 판타지.',
  },
  {
    id: 'minari',
    title: '미나리',
    year: '2020',
    rating: '7.4',
    posterUrl: demoPosterUrl('Minari'),
    info: '1980년대 아칸소로 이주한 한인 가족이 농장 일과 삶의 터전을 일구는 이야기. 할머니 순자와 손주 데이빗의 유대가 섬세하게 그려진다.',
  },
];

/** TMDB `w500` 절대 URL 우선, 그 외 HTTPS는 그대로, 없으면 폴백 단계에서 그라데이션 */
function resolveDisplayPosterUrl(m: SelectedMovieExtra): string | undefined {
  const n = normalizeTmdbPosterUrl(m.posterUrl);
  if (n) return n;
  const raw = m.posterUrl?.trim();
  if (raw?.startsWith('http')) return raw;
  return undefined;
}

function PosterthemeMainColorFallback({ iconSize = 28 }: { iconSize?: number }) {
  return (
    <LinearGradient
      colors={[GinitTheme.colors.surfaceStrong, 'rgba(220, 238, 255, 0.9)', 'rgba(239, 255, 250, 0.9)']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFillObject}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <GinitSymbolicIcon name="film" size={iconSize} color={GinitTheme.colors.primary} />
      </View>
    </LinearGradient>
  );
}

/** 원격 포스터 로딩·실패 시 Trust Blue 그라데이션 + 아이콘 */
function MoviePosterFill({
  item,
  recyclingKey,
  iconSize,
}: {
  item: SelectedMovieExtra;
  recyclingKey: string;
  iconSize?: number;
}) {
  const uri = useMemo(() => resolveDisplayPosterUrl(item), [item.id, item.posterUrl]);
  const [fatal, setFatal] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setFatal(false);
    setLoaded(false);
  }, [uri, item.id]);

  if (!uri || fatal) {
    return <PosterthemeMainColorFallback iconSize={iconSize ?? 28} />;
  }

  return (
    <>
      {!loaded ? (
        <View style={S.moviePosterSkeleton} pointerEvents="none">
          <ActivityIndicator size="small" color={TRUST_BLUE} />
        </View>
      ) : null}
      <Image
        key={uri}
        source={{ uri }}
        style={S.moviePosterImgFill}
        contentFit="cover"
        recyclingKey={recyclingKey}
        onLoad={() => setLoaded(true)}
        onError={() => setFatal(true)}
      />
    </>
  );
}

export type MovieSearchProps = {
  /** 확정된 영화 후보(순서대로 누적) */
  value: SelectedMovieExtra[];
  onChange: (next: SelectedMovieExtra[]) => void;
  /** 후보를 하나 추가했을 때 */
  onSelect?: (movie: SelectedMovieExtra) => void;
  disabled?: boolean;
  /** 「다른 후보 추가」로 검색 패널을 열 때 스크롤 정렬(모임 만들기 마법사 등) */
  parentScrollRef?: RefObject<ScrollView | null>;
  /** 부모 ScrollView의 `contentOffset.y` — `onScroll`에서 갱신 */
  parentScrollYRef?: RefObject<number>;
};

export function MovieSearch({
  value,
  onChange,
  onSelect,
  disabled,
  parentScrollRef: _parentScrollRef,
  parentScrollYRef: _parentScrollYRef,
}: MovieSearchProps) {
  const [pretendardFamily, setPretendardFamily] = useState<string | undefined>(undefined);
  const [rankRows, setRankRows] = useState<SelectedMovieExtra[]>([]);
  const [rankReady, setRankReady] = useState(false);
  const [rankErr, setRankErr] = useState<string | null>(null);
  const [movieNaverWeb, setMovieNaverWeb] = useState<{ url: string; title: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await Font.loadAsync({ PretendardBold: PRETENDARD_BOLD_URI });
        if (!cancelled) setPretendardFamily('PretendardBold');
      } catch {
        if (!cancelled) setPretendardFamily(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setRankReady(false);
    setRankErr(null);
    (async () => {
      const r = await fetchDailyBoxOfficeTop10();
      if (!alive) return;
      if (r.ok) {
        const withPosters = await enrichMoviesWithTmdbPosters(r.movies);
        if (!alive) return;
        setRankRows(withPosters);
        setRankErr(null);
      } else {
        setRankRows(STATIC_BOX_OFFICE_FALLBACK.slice(0, 10));
        setRankErr(r.error);
      }
      setRankReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const rows = useMemo(() => {
    if (!rankReady) return [];
    return rankRows;
  }, [rankReady, rankRows]);

  const titleFontStyle = useMemo(
    () => (pretendardFamily ? { fontFamily: pretendardFamily } : undefined),
    [pretendardFamily],
  );

  const isPicked = useCallback((id: string) => value.some((x) => x.id === id), [value]);

  const onTogglePick = useCallback(
    (m: SelectedMovieExtra) => {
      if (disabled) return;
      layoutAnimateEaseInEaseOut();
      if (value.some((x) => x.id === m.id)) {
        onChange(value.filter((x) => x.id !== m.id));
        return;
      }
      onChange([...value, m]);
      onSelect?.(m);
    },
    [disabled, onChange, onSelect, value],
  );

  const centerEmpty = !rankReady || rows.length === 0;
  const showLoadingBlock = !rankReady;

  const carousel = (
    <View style={[S.movieResultsScrollHost, S.movieResultsCarouselHost]}>
      <ScrollView
        horizontal={!centerEmpty}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        style={S.movieListScroll}
        contentContainerStyle={[
          S.movieResultsScrollContent,
          centerEmpty && { flexGrow: 1, justifyContent: 'center', paddingVertical: 0 },
        ]}>
        {showLoadingBlock ? (
          <View style={S.movieResultsStatus}>
            <ActivityIndicator size="large" color={GinitTheme.colors.primary} />
            <Text style={S.movieResultsStatusText}>목록을 불러오는 중이에요…</Text>
          </View>
        ) : rows.length === 0 ? (
          <View style={{ paddingVertical: 16, width: '100%' }}>
            <Text style={S.movieResultsStatusText}>{rankErr || '목록이 비어 있어요.'}</Text>
          </View>
        ) : (
          rows.map((item, index) => {
            const selected = isPicked(item.id);
            const metaLine =
              item.year && item.rating
                ? `${item.year} · ${item.rating.includes('%') ? `매출 ${item.rating}` : `★ ${item.rating}`}`
                : item.year || (item.rating ? (item.rating.includes('%') ? `매출 ${item.rating}` : `★ ${item.rating}`) : '');
            const movieDetailUrl = resolveNaverMovieSearchWebUrl(item.title);
            return (
              <View
                key={item.id}
                style={[
                  S.movieResultImageCard,
                  S.movieResultProposalCardWrap,
                  selected && S.movieResultImageCardSelected,
                ]}>
                <Pressable
                  onPress={() => onTogglePick(item)}
                  disabled={disabled}
                  style={({ pressed }) => [S.movieResultProposalPressFill, pressed && S.movieResultCardPressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.kobisRank ?? index + 1}위 ${item.title}`}>
                  <View style={S.movieResultProposalPressInner}>
                    <View style={S.movieResultImageWrap}>
                      <View style={S.movieRankBadge} pointerEvents="none">
                        <Text style={S.movieRankBadgeText}>{item.kobisRank ?? index + 1}</Text>
                      </View>
                      <MoviePosterFill item={item} recyclingKey={item.id} />
                      {selected ? (
                        <View style={S.movieResultImageOverlay} pointerEvents="none">
                          <GinitSymbolicIcon name="checkmark-circle" size={22} color={GinitTheme.colors.primary} />
                        </View>
                      ) : null}
                    </View>
                    <Text style={[S.movieResultTitle, titleFontStyle]} numberOfLines={2}>
                      {item.title}
                    </Text>
                    {metaLine ? (
                      <Text style={S.movieResultMeta} numberOfLines={2}>
                        {metaLine}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
                {movieDetailUrl ? (
                  <Pressable
                    onPress={() => {
                      const t = item.title.trim() || '영화';
                      setMovieNaverWeb({ url: movieDetailUrl, title: t });
                    }}
                    disabled={disabled}
                    style={({ pressed }) => [S.movieResultDetailBtn, pressed && { opacity: 0.88 }]}
                    accessibilityRole="button"
                    accessibilityLabel="상세 정보">
                    <Text style={S.movieResultDetailBtnText}>상세 정보</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );

  return (
    <View style={Platform.OS === 'web' ? ({ width: '100%', flexDirection: 'column' } as const) : undefined}>
      {carousel}

      <NaverPlaceWebViewModal
        visible={movieNaverWeb != null}
        url={movieNaverWeb?.url}
        pageTitle={movieNaverWeb?.title ?? '상세 정보'}
        onClose={() => setMovieNaverWeb(null)}
      />
    </View>
  );
}
