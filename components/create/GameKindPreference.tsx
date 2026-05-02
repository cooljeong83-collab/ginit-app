import { useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';

import { wizardSpecialtyStyles as S } from './wizard-specialty-styles';

const OPTIONS = [
  '보드게임',
  '방탈출',
  '볼링',
  '노래방',
  '모바일·e스포츠',
  '콘솔·스위치',
  '당구·포켓볼',
  'VR·체험',
  '카드게임',
  '오락실·아케이드',
  '기타',
] as const;

export type GameKindPreferenceProps = {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
};

/** Play & Vibe Step2 — `ActivityKindPreference`와 동일한 글래스 칩(단일 선택) */
export function GameKindPreference({ value, onChange, disabled }: GameKindPreferenceProps) {
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
