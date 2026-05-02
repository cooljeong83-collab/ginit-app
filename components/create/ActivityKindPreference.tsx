import { useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';

import { wizardSpecialtyStyles as S } from './wizard-specialty-styles';

const OPTIONS = [
  '러닝·조깅',
  '등산·트레킹',
  '헬스·근력',
  '요가·필라테스',
  '수영',
  '클라이밍',
  '풋살·축구',
  '배드민턴·테니스',
  '자전거·라이딩',
  '산책·워킹',
  '크로스핏',
  '댄스·에어로빅',
] as const;

export type ActivityKindPreferenceProps = {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
};

/** Active & Life Step2 — `MenuPreference`와 동일한 글래스 칩 레이아웃 */
export function ActivityKindPreference({ value, onChange, disabled }: ActivityKindPreferenceProps) {
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
