import { Pressable, Text, View } from 'react-native';

import type { SportIntensityLevel } from '@/src/lib/meeting-extra-data';

import { GinitTheme } from '@/constants/ginit-theme';
import { wizardSpecialtyStyles as S } from './wizard-specialty-styles';

const LEVELS: { key: SportIntensityLevel; title: string; sub: string }[] = [
  { key: 'easy', title: '즐겁게', sub: '가볍게' },
  { key: 'normal', title: '보통', sub: '적당히' },
  { key: 'hard', title: '빡세게', sub: '풀코스' },
];

export type IntensityPickerProps = {
  value: SportIntensityLevel;
  onChange: (next: SportIntensityLevel) => void;
  disabled?: boolean;
};

export function IntensityPicker({ value, onChange, disabled }: IntensityPickerProps) {
  return (
    <View>
      <Text style={S.fieldLabel}>운동 강도</Text>
      <Text style={S.fieldHint}>모임 템포를 정해 주세요.</Text>
      <View style={S.segmentRow}>
        {LEVELS.map((L, i) => {
          const on = value === L.key;
          return (
            <Pressable
              key={L.key}
              onPress={() => onChange(L.key)}
              disabled={disabled}
              style={[
                S.segmentThird,
                on && S.segmentThirdOn,
                i > 0 && { borderLeftWidth: 1, borderLeftColor: GinitTheme.colors.border },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}>
              <Text style={[S.segmentTitle, on && S.segmentTitleOn]}>{L.title}</Text>
              <Text style={S.segmentSub}>{L.sub}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
