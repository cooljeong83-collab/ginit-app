import { useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';

import { wizardSpecialtyStyles as S } from './wizard-specialty-styles';

const OPTIONS = ['한식', '일식', '중식', '양식', '분식', '카페·디저트', '아시안', '멕시칸', '브런치'] as const;

export type MenuPreferenceProps = {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
};

export function MenuPreference({ value, onChange, disabled }: MenuPreferenceProps) {
  const toggle = useCallback(
    (label: string) => {
      const on = value.includes(label);
      if (on) {
        onChange(value.filter((x) => x !== label));
      } else {
        onChange([...value, label]);
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
              onPress={() => toggle(label)}
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
