import { useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';

import { wizardSpecialtyStyles as S } from './wizard-specialty-styles';

const OPTIONS = [
  '독서·스터디',
  '카공·코워킹',
  '강연·세미나',
  '워크숍·실습',
  '자격증·시험',
  '언어·회화',
  '재테크·투자',
  '커리어·멘토링',
  '글쓰기·기획',
  '취미클래스',
  '기타',
] as const;

export type FocusKnowledgePreferenceProps = {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
};

/** Focus & Knowledge Step2 — `MenuPreference` / `ActivityKindPreference`와 동일한 글래스 칩 */
export function FocusKnowledgePreference({ value, onChange, disabled }: FocusKnowledgePreferenceProps) {
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
