import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';
import { GINIT_HIGH_TRUST_HOST_MIN } from '@/src/lib/ginit-trust';
import type {
  PublicMeetingAgeLimit,
  PublicMeetingApprovalType,
  PublicMeetingDetailsConfig,
  PublicMeetingGenderRatio,
  PublicMeetingSettlement,
} from '@/src/lib/meetings';

const RADIUS = 12;
const FIELD_FILL = 'rgba(31, 42, 68, 0.04)';
const FOCUS_RING = 'rgba(31, 42, 68, 0.45)';

const AGE_OPTIONS: { code: PublicMeetingAgeLimit; label: string }[] = [
  { code: 'TWENTIES', label: '20대' },
  { code: 'THIRTIES', label: '30대' },
  { code: 'FORTY_PLUS', label: '40대 이상' },
  { code: 'NONE', label: '제한 없음' },
];

type FocusKey = 'age' | 'gender' | 'settlement' | 'level' | 'trust' | 'approval' | null;

function clampInt(n: number, min: number, max: number): number {
  const v = Number.isFinite(n) ? Math.trunc(n) : min;
  return Math.max(min, Math.min(max, v));
}

/**
 * 포커스 링 — `DateCandidateEditorCard` 글래스와 동일하게 Android에서는 elevation 미사용(합성 깨짐 방지),
 * `reduceHeavyEffects`(스택 전환 등)일 때는 iOS에서도 shadow 생략.
 */
function blockFocusStyle(active: boolean, reduceHeavyEffects: boolean) {
  // 상세 설정(선택): 각 섹션이 “박스”처럼 보이지 않도록 포커스 링을 사용하지 않습니다.
  void active;
  void reduceHeavyEffects;
  return null;
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
}) {
  return (
    <View style={styles.segmentWrap}>
      {options.map((o) => {
        const on = value === o.id;
        return (
          <Pressable
            key={o.id}
            onPress={() => onChange(o.id)}
            style={({ pressed }) => [styles.segmentBtn, on && styles.segmentBtnOn, pressed && styles.pressed]}
            accessibilityRole="button">
            <Text style={[styles.segmentLabel, on && styles.segmentLabelOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function PublicMeetingDetailsCard({
  value,
  onChange,
  reduceHeavyEffects = false,
}: {
  value: PublicMeetingDetailsConfig;
  onChange: (next: PublicMeetingDetailsConfig) => void;
  /** 스택 전환 등 GPU 부하 시 포커스 그림자도 끕니다 (`VoteCandidateCard`와 동일 개념). */
  reduceHeavyEffects?: boolean;
}) {
  const [focused, setFocused] = useState<FocusKey>(null);

  const ageSet = useMemo(() => new Set(value.ageLimit ?? []), [value.ageLimit]);
  const toggleAge = useCallback(
    (code: PublicMeetingAgeLimit) => {
      const next = new Set(value.ageLimit ?? []);
      if (code === 'NONE') {
        next.clear();
        next.add('NONE');
      } else {
        next.delete('NONE');
        if (next.has(code)) next.delete(code);
        else next.add(code);
      }
      onChange({ ...value, ageLimit: Array.from(next) });
    },
    [onChange, value],
  );

  const setGender = useCallback(
    (v: PublicMeetingGenderRatio) => onChange({ ...value, genderRatio: v }),
    [onChange, value],
  );
  const setSettlement = useCallback(
    (v: PublicMeetingSettlement) => {
      onChange({
        ...value,
        settlement: v,
        membershipFeeWon: v === 'MEMBERSHIP_FEE' ? (value.membershipFeeWon ?? null) : undefined,
      });
    },
    [onChange, value],
  );

  const setMembershipFeeDigits = useCallback(
    (raw: string) => {
      const digits = raw.replace(/\D/g, '').slice(0, 6);
      if (digits === '') {
        onChange({ ...value, membershipFeeWon: null });
        return;
      }
      const n = Math.min(100_000, parseInt(digits, 10));
      onChange({ ...value, membershipFeeWon: Number.isFinite(n) ? n : null });
    },
    [onChange, value],
  );
  const setApproval = useCallback(
    (v: PublicMeetingApprovalType) => {
      const next: PublicMeetingDetailsConfig = { ...value, approvalType: v };
      if (v !== 'HOST_APPROVAL') next.requestMessageEnabled = null;
      else next.requestMessageEnabled = true;
      onChange(next);
    },
    [onChange, value],
  );

  const bumpLevel = useCallback(
    (delta: number) => {
      const next = clampInt((value.minGLevel ?? 1) + delta, 1, 50);
      onChange({ ...value, minGLevel: next });
    },
    [onChange, value],
  );

  const toggleRequestMessage = useCallback(() => {
    const cur = value.requestMessageEnabled === true;
    onChange({ ...value, requestMessageEnabled: !cur });
  }, [onChange, value]);

  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <View style={[styles.section, blockFocusStyle(focused === 'age', reduceHeavyEffects)]}>
          <Text style={styles.label}>모집 연령대</Text>
          <View style={styles.chipRow}>
            {AGE_OPTIONS.map((o) => {
              const on = ageSet.has(o.code);
              return (
                <Pressable
                  key={o.code}
                  onPress={() => {
                    setFocused('age');
                    toggleAge(o.code);
                  }}
                  style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.pressed]}
                  accessibilityRole="button">
                  <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.sectionSeparator} />
        <View style={styles.section}>
          <Text style={styles.label}>성별 비율</Text>
          <Segmented
            value={value.genderRatio}
            options={[
              { id: 'ALL', label: '모두' },
              { id: 'SAME_GENDER_ONLY', label: '동성만' },
              { id: 'HALF_HALF', label: '남녀 반반' },
            ]}
            onChange={(id) => {
              setFocused('gender');
              setGender(id as PublicMeetingGenderRatio);
            }}
          />
        </View>

        <View style={styles.sectionSeparator} />
        <View style={[styles.section, blockFocusStyle(focused === 'settlement', reduceHeavyEffects)]}>
          <Text style={styles.label}>정산 방법</Text>
          <Segmented
            value={value.settlement}
            options={[
              { id: 'DUTCH', label: '1/N' },
              { id: 'HOST_PAYS', label: '호스트' },
              { id: 'INDIVIDUAL', label: '개별' },
              { id: 'MEMBERSHIP_FEE', label: '회비' },
            ]}
            onChange={(id) => {
              setFocused('settlement');
              setSettlement(id as PublicMeetingSettlement);
            }}
          />
          <Text style={styles.settlementHint}>
            {value.settlement === 'DUTCH'
              ? '참가자가 비용을 균등하게 나눠요.'
              : value.settlement === 'HOST_PAYS'
                ? '호스트가 먼저 결제한 뒤 참가자와 정산해요.'
                : value.settlement === 'INDIVIDUAL'
                  ? '각자 주문하고 각자 결제해요.'
                  : '참가 시 납부할 회비가 있으면 아래에 금액을 입력해 주세요.'}
          </Text>
          {value.settlement === 'MEMBERSHIP_FEE' ? (
            <View style={styles.feeBlock}>
              <Text style={styles.feeLabel}>회비 금액 (원)</Text>
              <TextInput
                value={value.membershipFeeWon != null ? String(value.membershipFeeWon) : ''}
                onChangeText={setMembershipFeeDigits}
                placeholder="숫자만 입력 (예: 15000)"
                placeholderTextColor={GinitTheme.glassModal.placeholder}
                style={styles.feeInput}
                keyboardType="number-pad"
                maxLength={6}
                editable
                onFocus={() => setFocused('settlement')}
              />
            </View>
          ) : null}
        </View>

        <View style={styles.sectionSeparator} />
        <View style={[styles.section, blockFocusStyle(focused === 'level', reduceHeavyEffects)]}>
          <Text style={styles.label}>참가 자격 (최소 gLevel)</Text>
          <View style={styles.stepperRow}>
            <Pressable
              onPress={() => {
                setFocused('level');
                bumpLevel(-1);
              }}
              style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}
              accessibilityRole="button">
              <Text style={styles.stepBtnText}>−</Text>
            </Pressable>
            <View style={styles.stepValueWrap}>
              <Text style={styles.stepValue}>Lv {clampInt(value.minGLevel ?? 1, 1, 50)}</Text>
              <Text style={styles.stepHint}>높을수록 숙련된 멤버만 참여</Text>
            </View>
            <Pressable
              onPress={() => {
                setFocused('level');
                bumpLevel(1);
              }}
              style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}
              accessibilityRole="button">
              <Text style={styles.stepBtnText}>+</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.sectionSeparator} />
        <View style={[styles.section, blockFocusStyle(focused === 'trust', reduceHeavyEffects)]}>
          <View style={styles.approvalRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>신뢰도 높은 모임</Text>
              <Text style={styles.smallHint}>
                켜면 gTrust <Text style={{ fontWeight: '600' }}>{GINIT_HIGH_TRUST_HOST_MIN}점</Text> 미만은 참여할 수
                없어요.
              </Text>
            </View>
            <Pressable
              onPress={() => {
                setFocused('trust');
                const on = typeof value.minGTrust === 'number' && value.minGTrust >= GINIT_HIGH_TRUST_HOST_MIN;
                onChange({
                  ...value,
                  minGTrust: on ? null : GINIT_HIGH_TRUST_HOST_MIN,
                });
              }}
              style={({ pressed }) => [
                styles.toggleWrap,
                typeof value.minGTrust === 'number' && value.minGTrust >= GINIT_HIGH_TRUST_HOST_MIN && styles.toggleWrapOn,
                pressed && styles.pressed,
              ]}
              accessibilityRole="switch"
              accessibilityState={{
                checked: typeof value.minGTrust === 'number' && value.minGTrust >= GINIT_HIGH_TRUST_HOST_MIN,
              }}>
              <View
                style={[
                  styles.toggleKnob,
                  typeof value.minGTrust === 'number' && value.minGTrust >= GINIT_HIGH_TRUST_HOST_MIN && styles.toggleKnobOn,
                ]}
              />
            </Pressable>
          </View>
        </View>

        <View style={styles.sectionSeparator} />
        <View style={[styles.section, blockFocusStyle(focused === 'approval', reduceHeavyEffects)]}>
          <View style={styles.approvalRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>승인 방식</Text>
              <Text style={styles.smallHint}>
                <Text style={{ color: GinitTheme.colors.accent2, fontWeight: '600' }}>호스트 승인</Text>을 켜면 신청을 받고
                확정해요.
              </Text>
            </View>
            <Pressable
              onPress={() => {
                setFocused('approval');
                setApproval(value.approvalType === 'HOST_APPROVAL' ? 'INSTANT' : 'HOST_APPROVAL');
              }}
              style={({ pressed }) => [
                styles.toggleWrap,
                value.approvalType === 'HOST_APPROVAL' && styles.toggleWrapOn,
                pressed && styles.pressed,
              ]}
              accessibilityRole="switch"
              accessibilityState={{ checked: value.approvalType === 'HOST_APPROVAL' }}>
              <View style={[styles.toggleKnob, value.approvalType === 'HOST_APPROVAL' && styles.toggleKnobOn]} />
            </Pressable>
          </View>

          {value.approvalType === 'HOST_APPROVAL' ? (
            <Pressable
              onPress={toggleRequestMessage}
              style={({ pressed }) => [styles.checkboxRow, pressed && styles.pressed]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: value.requestMessageEnabled === true }}>
              <View style={[styles.checkboxBox, value.requestMessageEnabled === true && styles.checkboxBoxOn]}>
                {value.requestMessageEnabled === true ? <Text style={styles.checkboxTick}>✓</Text> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.checkboxLabel}>신청 메시지 받기</Text>
                <Text style={styles.checkboxHint}>참가자가 한 줄 메시지를 남길 수 있어요.</Text>
              </View>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    marginTop: 0,
  },
  card: {
    borderRadius: 16,
    borderWidth: 0,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  section: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 0,
  },
  sectionSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#FFFFFF',
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: GinitTheme.colors.textSub,
    marginBottom: 8,
  },
  smallHint: {
    marginTop: -4,
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5.5,
  },
  chip: {
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    backgroundColor: '#FFFFFF',
    paddingVertical: 9,
    paddingHorizontal: 12,
    overflow: 'hidden',
  },
  chipOn: {
    borderColor: 'rgba(31, 42, 68, 0.45)',
    backgroundColor: 'rgba(31, 42, 68, 0.06)',
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.text,
  },
  chipLabelOn: {
    color: GinitTheme.colors.primary,
  },
  segmentWrap: {
    flexDirection: 'row',
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  segmentBtnOn: {
    backgroundColor: 'rgba(31, 42, 68, 0.06)',
  },
  segmentLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.textSub,
  },
  segmentLabelOn: {
    color: GinitTheme.colors.primary,
  },
  settlementHint: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    lineHeight: 16,
  },
  feeBlock: {
    marginTop: 12,
  },
  feeLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.textSub,
    marginBottom: 6,
  },
  feeInput: {
    backgroundColor: FIELD_FILL,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 16,
    fontWeight: '700',
    color: GinitTheme.colors.text,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    backgroundColor: FIELD_FILL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: {
    fontSize: 18,
    fontWeight: '600',
    color: GinitTheme.colors.primary,
  },
  stepValueWrap: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    backgroundColor: FIELD_FILL,
  },
  stepValue: {
    fontSize: 14,
    fontWeight: '600',
    color: GinitTheme.colors.text,
  },
  stepHint: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
  },
  approvalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  toggleWrap: {
    width: 56,
    height: 32,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    backgroundColor: FIELD_FILL,
    padding: 3,
    justifyContent: 'center',
  },
  toggleWrapOn: {
    borderColor: 'rgba(31, 42, 68, 0.45)',
    backgroundColor: 'rgba(31, 42, 68, 0.10)',
  },
  toggleKnob: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignSelf: 'flex-start',
  },
  toggleKnobOn: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  checkboxRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    backgroundColor: 'rgba(31, 42, 68, 0.06)',
  },
  checkboxBox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    backgroundColor: FIELD_FILL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxBoxOn: {
    borderColor: 'rgba(31, 42, 68, 0.45)',
    backgroundColor: 'rgba(31, 42, 68, 0.10)',
  },
  checkboxTick: {
    fontSize: 14,
    fontWeight: '600',
    color: GinitTheme.colors.primary,
  },
  checkboxLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.text,
  },
  checkboxHint: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }],
  },
});

