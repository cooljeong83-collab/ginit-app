import { useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';

import { wizardSpecialtyStyles as S } from './wizard-specialty-styles';

/** PC방에서 자주 검색되는 최신·인기 타이틀(한국 기준, 단일 선택 칩) */
const OPTIONS = [
  '델타포스',
  '발로란트',
  '리그 오브 레전드',
  '오버워치 2',
  '배틀그라운드',
  '로스트아크',
  '메이플스토리',
  '몬스터헌터 와일즈',
  '엘든 링',
  '디아블로 IV',
  'FC 온라인',
  '마인크래프트',
  '스타크래프트',
  '기타',
] as const;

export type PcGameKindPreferenceProps = {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
};

/** PcGame major Step2 — `GameKindPreference`와 동일한 글래스 칩(단일 선택) */
export function PcGameKindPreference({ value, onChange, disabled }: PcGameKindPreferenceProps) {
  const selectOne = useCallback(
    (label: string) => {
      if (value.length === 1 && value[0] === label) {
        onChange([]);
      } else {
        onChange([label]);
      }
    },
    [onChange, value],
  );

  return (
    <View>
      <View style={S.chipWrap}>
        {OPTIONS.map((label) => {
          const active = value.includes(label);
          return (
            <Pressable
              key={label}
              onPress={() => selectOne(label)}
              disabled={disabled}
              style={({ pressed }) => [
                S.glassChip,
                active && S.glassChipOn,
                pressed && S.glassChipPressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}>
              <Text style={S.glassChipText}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
