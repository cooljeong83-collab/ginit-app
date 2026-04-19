import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import * as Font from 'expo-font';
import { LinearGradient } from 'expo-linear-gradient';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';

import { layoutAnimateEaseInEaseOut } from '@/src/lib/android-layout-animation';
import { fetchDailyBoxOfficeTop10 } from '@/src/lib/kobis-daily-box-office';
import type { SelectedMovieExtra } from '@/src/lib/meeting-extra-data';
import { enrichMoviesWithTmdbPosters, normalizeTmdbPosterUrl } from '@/src/lib/tmdb-movie-poster';

import {
  INPUT_PLACEHOLDER,
  movieAddOutlineBtnWebStyle,
  movieListRowWebGlassStyle,
  wizardSpecialtyStyles as S,
} from './wizard-specialty-styles';

const TRUST_BLUE = '#0052CC';

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

const SEARCH_EXTRA: SelectedMovieExtra[] = [
  {
    id: 'wicked',
    title: '위키드',
    year: '2024',
    rating: '7.0',
    posterUrl: demoPosterUrl('Wicked'),
    info: '오즈의 마법사 이전 시대, 서로 다른 성격의 두 마법사가 만나 운명을 바꾸는 뮤지컬 판타지. 무대의 화려함이 스크린으로 옮겨졌다.',
  },
  {
    id: 'gladiator2',
    title: '글래디에이터 II',
    year: '2024',
    rating: '6.6',
    posterUrl: demoPosterUrl('Gladiator'),
    info: '노예에서 검투사로 살아남은 루시우스가 콜로세움과 제국의 음모 속에서 다시 길을 찾는다. 리들리 스콧의史詩 액션 속편.',
  },
];

const SEARCH_LIMIT = 24;

function MovieGlassListRow({ children, pressed }: { children: ReactNode; pressed: boolean }) {
  if (Platform.OS === 'web') {
    return (
      <View
        style={[
          S.movieListRowCardFallback,
          movieListRowWebGlassStyle,
          pressed && S.movieListRowPressedOrange,
        ]}>
        <View style={S.movieListRowInner}>{children}</View>
      </View>
    );
  }
  return (
    <View style={[S.movieListRowOuter, pressed && S.movieListRowPressedOrange]}>
      <BlurView
        tint="dark"
        intensity={26}
        style={StyleSheet.absoluteFill}
        experimentalBlurMethod="dimezisBlurView"
      />
      <View style={S.movieListRowInner}>{children}</View>
    </View>
  );
}

/** TMDB `w500` 절대 URL 우선, 그 외 HTTPS는 그대로, 없으면 폴백 단계에서 그라데이션 */
function resolveDisplayPosterUrl(m: SelectedMovieExtra): string | undefined {
  const n = normalizeTmdbPosterUrl(m.posterUrl);
  if (n) return n;
  const raw = m.posterUrl?.trim();
  if (raw?.startsWith('http')) return raw;
  return undefined;
}

function PosterTrustBlueFallback({ iconSize = 28 }: { iconSize?: number }) {
  return (
    <LinearGradient
      colors={['#010b22', TRUST_BLUE, '#1e40af']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFillObject}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="film" size={iconSize} color="rgba(248, 250, 252, 0.92)" />
      </View>
    </LinearGradient>
  );
}

/** 원격 포스터 로딩·실패 시 Trust Blue 그라데이션 + 아이콘 */
function MoviePosterFill({ item, recyclingKey, iconSize }: { item: SelectedMovieExtra; recyclingKey: string; iconSize?: number }) {
  const uri = useMemo(() => resolveDisplayPosterUrl(item), [item.id, item.posterUrl]);
  const [fatal, setFatal] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setFatal(false);
    setLoaded(false);
  }, [uri, item.id]);

  if (!uri || fatal) {
    return <PosterTrustBlueFallback iconSize={iconSize ?? 28} />;
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
  /** 후보가 1개 이상일 때 하단 주황 버튼(다음 단계) */
  onContinue?: () => void;
  disabled?: boolean;
};

export function MovieSearch({ value, onChange, onSelect, onContinue, disabled }: MovieSearchProps) {
  const [query, setQuery] = useState('');
  const [addingMore, setAddingMore] = useState(false);
  const [pretendardFamily, setPretendardFamily] = useState<string | undefined>(undefined);
  const [rankRows, setRankRows] = useState<SelectedMovieExtra[]>([]);
  const [rankReady, setRankReady] = useState(false);
  const [rankErr, setRankErr] = useState<string | null>(null);

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

  const pickerOpen = value.length === 0 || addingMore;

  useEffect(() => {
    if (value.length === 0) {
      setAddingMore(false);
    }
  }, [value.length]);

  useEffect(() => {
    if (!pickerOpen) return;
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
  }, [pickerOpen]);

  const searchCatalog = useMemo(() => {
    const map = new Map<string, SelectedMovieExtra>();
    [...SEARCH_EXTRA, ...rankRows].forEach((m) => map.set(m.id, m));
    return [...map.values()];
  }, [rankRows]);

  const windowH = Dimensions.get('window').height;
  const heroMinH = useMemo(() => {
    const ratio = value.length > 0 && addingMore ? 0.44 : 0.7;
    return Math.round(windowH * ratio);
  }, [addingMore, value.length, windowH]);

  const isRankingView = query.trim().length === 0;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      if (!rankReady) return [];
      return rankRows;
    }
    return searchCatalog.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        (m.info && m.info.toLowerCase().includes(q)) ||
        (m.year && m.year.includes(q)),
    ).slice(0, SEARCH_LIMIT);
  }, [query, rankReady, rankRows, searchCatalog]);

  const titleFontStyle = useMemo(
    () => (pretendardFamily ? { fontFamily: pretendardFamily } : undefined),
    [pretendardFamily],
  );

  const onPick = useCallback(
    (m: SelectedMovieExtra) => {
      if (value.some((x) => x.id === m.id)) {
        layoutAnimateEaseInEaseOut();
        setQuery('');
        setAddingMore(false);
        return;
      }
      layoutAnimateEaseInEaseOut();
      onChange([...value, m]);
      setQuery('');
      setAddingMore(false);
      onSelect?.(m);
    },
    [onChange, onSelect, value],
  );

  const removeCandidate = useCallback(
    (id: string) => {
      layoutAnimateEaseInEaseOut();
      onChange(value.filter((x) => x.id !== id));
    },
    [onChange, value],
  );

  const onToggleAddMore = useCallback(() => {
    layoutAnimateEaseInEaseOut();
    setAddingMore((prev) => !prev);
    setQuery('');
  }, []);

  const listScroll = (
    <ScrollView
      style={S.movieListScroll}
      contentContainerStyle={[
        S.movieListStack,
        Platform.OS === 'web' && ({ width: '100%', maxWidth: '100%', flexDirection: 'column' } as const),
      ]}
      nestedScrollEnabled
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}>
      {isRankingView && !rankReady ? (
        <View style={{ paddingVertical: 28, alignItems: 'center', gap: 12 }}>
          <ActivityIndicator size="large" color="#0052CC" />
          <Text style={S.resultMeta}>목록을 불러오는 중이에요…</Text>
        </View>
      ) : rows.length === 0 ? (
        <View style={{ paddingVertical: 16 }}>
          <Text style={S.resultMeta}>
            {isRankingView
              ? rankErr || '목록이 비어 있어요.'
              : '검색 결과가 없어요. 다른 키워드를 써 보세요.'}
          </Text>
        </View>
      ) : (
        rows.map((item, index) => (
          <Animated.View
            key={`${query}-${item.id}`}
            style={S.movieListItemOuter}
            entering={FadeInDown.duration(360).delay(Math.min(index * 52, 480))}>
            <Pressable
              onPress={() => onPick(item)}
              disabled={disabled}
              style={Platform.OS === 'web' ? ({ width: '100%' } as const) : undefined}
              accessibilityRole="button"
              accessibilityLabel={
                isRankingView ? `${item.kobisRank ?? index + 1}위 ${item.title}` : item.title
              }>
              {({ pressed }) => (
                <MovieGlassListRow pressed={pressed}>
                  <View style={S.movieListPosterWrap}>
                    {isRankingView ? (
                      <View style={S.movieRankBadge} pointerEvents="none">
                        <Text style={S.movieRankBadgeText}>{item.kobisRank ?? index + 1}</Text>
                      </View>
                    ) : null}
                    <View style={S.movieListPosterImg}>
                      <MoviePosterFill item={item} recyclingKey={item.id} />
                    </View>
                  </View>
                  <View style={S.movieRightCol}>
                    <View style={S.movieTitleGlass}>
                      <Text style={[S.movieListTitle, titleFontStyle]} numberOfLines={2}>
                        {item.title}
                      </Text>
                      {item.year ? <Text style={S.movieYearUnderTitle}>{item.year}</Text> : null}
                    </View>
                    {item.rating ? (
                      <View style={S.movieRatingRow}>
                        {item.rating.includes('%') ? (
                          <Text style={S.movieRatingNumber}>매출 {item.rating}</Text>
                        ) : (
                          <>
                            <Text style={S.movieStarIcon}>★</Text>
                            <Text style={S.movieRatingNumber}>{item.rating}</Text>
                          </>
                        )}
                      </View>
                    ) : null}
                    {item.info ? (
                      <Text style={S.movieSynopsis} numberOfLines={3} ellipsizeMode="tail">
                        {item.info}
                      </Text>
                    ) : null}
                  </View>
                </MovieGlassListRow>
              )}
            </Pressable>
          </Animated.View>
        ))
      )}
    </ScrollView>
  );

  const searchHeader = (
    <View>
      <Text style={S.fieldLabel}>영화 검색</Text>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="제목 검색…"
        placeholderTextColor={INPUT_PLACEHOLDER}
        style={[S.textInput, { marginTop: 4 }]}
        editable={!disabled}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        {...(Platform.OS === 'ios' ? { clearButtonMode: 'while-editing' as const } : {})}
      />
    </View>
  );

  if (value.length === 0) {
    return (
      <View style={[S.movieHeroShell, { height: heroMinH }]}>
        {searchHeader}
        {listScroll}
      </View>
    );
  }

  return (
    <View style={Platform.OS === 'web' ? ({ width: '100%', flexDirection: 'column' } as const) : undefined}>
      <Text style={S.fieldLabel}>확정된 영화 후보</Text>
      <Animated.View
        layout={LinearTransition.springify().damping(18).stiffness(220)}
        style={S.movieCandidatesColumn}>
        {value.map((item, index) => (
          <Animated.View
            key={item.id}
            layout={LinearTransition.springify().damping(18).stiffness(220)}
            entering={FadeInDown.duration(420).delay(Math.min(index * 72, 280))}>
            <View style={S.movieConfirmedCard}>
              <Pressable
                onPress={() => removeCandidate(item.id)}
                disabled={disabled}
                style={({ pressed }) => [S.movieConfirmedRemoveHit, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
                accessibilityLabel={`${item.title} 후보에서 제거`}>
                <Ionicons name="close" size={18} color="rgba(248, 250, 252, 0.92)" />
              </Pressable>
              <View style={S.movieListPosterWrap}>
                <View style={S.movieListPosterImg}>
                  <MoviePosterFill item={item} recyclingKey={`pick-${item.id}`} />
                </View>
              </View>
              <View style={S.movieRightCol}>
                <View style={S.movieTitleGlass}>
                  <Text style={[S.movieListTitle, titleFontStyle]} numberOfLines={2}>
                    {item.title}
                  </Text>
                  {item.year ? <Text style={S.movieYearUnderTitle}>{item.year}</Text> : null}
                </View>
                {item.rating ? (
                  <View style={S.movieRatingRow}>
                    {item.rating.includes('%') ? (
                      <Text style={S.movieRatingNumber}>매출 {item.rating}</Text>
                    ) : (
                      <>
                        <Text style={S.movieStarIcon}>★</Text>
                        <Text style={S.movieRatingNumber}>{item.rating}</Text>
                      </>
                    )}
                  </View>
                ) : null}
                {item.info ? (
                  <Text style={S.movieSynopsis} numberOfLines={3} ellipsizeMode="tail">
                    {item.info}
                  </Text>
                ) : null}
              </View>
            </View>
          </Animated.View>
        ))}
      </Animated.View>

      <Pressable
        onPress={onToggleAddMore}
        disabled={disabled}
        style={({ pressed }) => [
          S.movieAddOutlineBtn,
          Platform.OS === 'web' && movieAddOutlineBtnWebStyle,
          pressed && S.movieAddOutlineBtnPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={addingMore ? '영화 검색 접기' : '다른 영화 후보 추가'}>
        <Text style={S.movieAddOutlineBtnLabel}>
          {addingMore ? '검색 닫기' : '+ 다른 후보 추가하기'}
        </Text>
      </Pressable>

      {addingMore ? (
        <View style={[S.movieHeroShell, { marginTop: 12, height: heroMinH }]}>
          {searchHeader}
          {listScroll}
        </View>
      ) : null}

      {onContinue && value.length >= 1 ? (
        <Pressable
          onPress={onContinue}
          disabled={disabled}
          style={({ pressed }) => [
            S.movieProceedOrangeBtn,
            pressed && S.movieProceedOrangeBtnPressed,
            disabled && { opacity: 0.45 },
          ]}
          accessibilityRole="button">
          <Text style={S.movieProceedOrangeBtnLabel}>이 후보들로 모임 만들기</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
