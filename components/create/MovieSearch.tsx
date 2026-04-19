import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';

import type { SelectedMovieExtra } from '@/src/lib/meeting-extra-data';

import { INPUT_PLACEHOLDER, wizardSpecialtyStyles as S } from './wizard-specialty-styles';

const CATALOG: SelectedMovieExtra[] = [
  { id: 'parasite', title: '기생충', year: '2019', info: '봉준호 감독, 칸 황금종려상·아카데미 작품상.' },
  { id: 'broker', title: '브로커', year: '2022', info: '고레에다 히로카즈, 아기 박스를 둘러싼 이들의 여정.' },
  { id: 'decision', title: '헤어질 결심', year: '2022', info: '박찬욱 감독, 수사와 사랑이 엇갈리는 미스터리 멜로.' },
  { id: 'concrete', title: '콘크리트 유토피아', year: '2023', info: '대지진 이후 아파트를 둘러싼 생존 스릴러.' },
  { id: 'dune2', title: '듄: 파트 2', year: '2024', info: '데니 빌뇌브 SF 서사, 아라키스 모래별 전쟁.' },
  { id: 'oppenheimer', title: '오펜하이머', year: '2023', info: '노란 과학자와 원폭 개발의 윤리적 무게.' },
  { id: 'suzume', title: '스즈메의 문단속', year: '2022', info: '신카이 마코토, 재난과 성장을 잇는 애니메이션.' },
  { id: 'elemental', title: '엘리멘탈', year: '2023', info: '불·물 원소 도시에서 펼쳐지는 로맨스 판타지.' },
  { id: 'minari', title: '미나리', year: '2020', info: '이삭 춘 감독, 한인 이민 가족의 아칸소 농장 이야기.' },
  { id: 'hunt', title: '헌트', year: '2022', info: '이정재 감독·주연, 내부 스파이를 쫓는 정보 액션.' },
];

export type MovieSearchProps = {
  value: SelectedMovieExtra | null;
  onChange: (next: SelectedMovieExtra | null) => void;
  disabled?: boolean;
};

export function MovieSearch({ value, onChange, disabled }: MovieSearchProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CATALOG.slice(0, 6);
    return CATALOG.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        (m.info && m.info.toLowerCase().includes(q)) ||
        (m.year && m.year.includes(q)),
    ).slice(0, 12);
  }, [query]);

  const onPick = useCallback(
    (m: SelectedMovieExtra) => {
      onChange(m);
      setQuery('');
    },
    [onChange],
  );

  return (
    <View>
      <Text style={S.fieldLabel}>영화 검색</Text>
      <Text style={S.fieldHint}>제목을 입력하면 목록에서 고를 수 있어요.</Text>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="예: 기생충, 듄…"
        placeholderTextColor={INPUT_PLACEHOLDER}
        style={S.textInput}
        editable={!disabled}
      />

      {!value ? (
        <View style={S.resultsBox}>
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            renderItem={({ item }) => (
              <Pressable
                onPress={() => onPick(item)}
                disabled={disabled}
                style={({ pressed }) => [S.resultRow, pressed && { opacity: 0.85 }]}
                accessibilityRole="button">
                <Text style={S.resultTitle}>{item.title}</Text>
                <Text style={S.resultMeta}>
                  {item.year ? `${item.year} · ` : ''}
                  {item.info}
                </Text>
              </Pressable>
            )}
            ListEmptyComponent={
              <View style={[S.resultRow, { borderBottomWidth: 0 }]}>
                <Text style={S.resultMeta}>검색 결과가 없어요. 다른 키워드를 써 보세요.</Text>
              </View>
            }
          />
        </View>
      ) : (
        <View style={S.pickedBlock}>
          <Text style={S.pickedTitle}>{value.title}</Text>
          {value.year ? <Text style={S.resultMeta}>{value.year}</Text> : null}
          {value.info ? <Text style={S.pickedSub}>{value.info}</Text> : null}
          <Pressable
            onPress={() => onChange(null)}
            disabled={disabled}
            style={S.clearLink}
            accessibilityRole="button">
            <Text style={S.clearLinkText}>다시 선택</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
