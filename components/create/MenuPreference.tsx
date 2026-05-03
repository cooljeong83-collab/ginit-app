import { useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';

import { AgentApplyRippleLayer } from './agent-apply-ripple';
import { wizardSpecialtyStyles as S } from './wizard-specialty-styles';

const OPTIONS = ['한식', '일식', '중식', '양식', '분식', '퓨전', '카페', '브런치', '주점·호프', '이자카야', '와인.바', '포차', '오마카세'] as const;

export type MenuPreferenceProps = {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** FAB 자동 적용 시 해당 칩에 눌림 연출만 표시(상태는 부모가 타이밍에 맞게 갱신). */
  agentCueLabel?: string | null;
};

export function MenuPreference({ value, onChange, disabled, agentCueLabel = null }: MenuPreferenceProps) {
  /** 한 가지만 선택. 동일 칩을 다시 누르면 해제(다른 항목으로 바꿀 수 있게). */
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
          const isAgentCue = agentCueLabel != null && label === agentCueLabel;
          return (
            <Pressable
              key={label}
              onPress={() => selectOne(label)}
              disabled={disabled}
              style={({ pressed }) => [
                S.glassChip,
                active && S.glassChipOn,
                (pressed || isAgentCue) && S.glassChipPressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}>
              <AgentApplyRippleLayer active={isAgentCue} size="md" />
              <Text style={S.glassChipText}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
