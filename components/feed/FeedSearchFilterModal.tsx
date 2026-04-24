import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';
import type {
  PublicMeetingAgeLimit,
  PublicMeetingApprovalType,
  PublicMeetingGenderRatio,
  PublicMeetingSettlement,
} from '@/src/lib/meetings';
import { defaultFeedSearchFilters, type FeedSearchFilters } from '@/src/lib/feed-meeting-utils';

const AGE_CHIPS: { code: PublicMeetingAgeLimit; label: string }[] = [
  { code: 'TWENTIES', label: '20대' },
  { code: 'THIRTIES', label: '30대' },
  { code: 'FORTY_PLUS', label: '40대+' },
  { code: 'NONE', label: '연령 무제한' },
];

const GENDER_OPTIONS: { value: PublicMeetingGenderRatio; label: string }[] = [
  { value: 'ALL', label: '모두' },
  { value: 'SAME_GENDER_ONLY', label: '동성만' },
  { value: 'HALF_HALF', label: '남녀 반반' },
];

const SETTLE_OPTIONS: { value: PublicMeetingSettlement; label: string }[] = [
  { value: 'DUTCH', label: '1/N' },
  { value: 'HOST_PAYS', label: '호스트' },
  { value: 'INDIVIDUAL', label: '개별' },
  { value: 'MEMBERSHIP_FEE', label: '회비' },
];

const APPROVAL_OPTIONS: { value: PublicMeetingApprovalType; label: string }[] = [
  { value: 'INSTANT', label: '즉시 참여' },
  { value: 'HOST_APPROVAL', label: '호스트 승인' },
];

function toggleAge(ages: PublicMeetingAgeLimit[], code: PublicMeetingAgeLimit): PublicMeetingAgeLimit[] {
  const set = new Set(ages);
  if (set.has(code)) set.delete(code);
  else set.add(code);
  return Array.from(set);
}

type Props = {
  visible: boolean;
  filters: FeedSearchFilters;
  onChangeFilters: (next: FeedSearchFilters) => void;
  onClose: () => void;
  onApply: () => void;
};

export function FeedSearchFilterModal({ visible, filters, onChangeFilters, onClose, onApply }: Props) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} accessibilityRole="button" accessibilityLabel="검색 닫기" />
        <View style={styles.card}>
          <Text style={styles.title}>검색 · 조건</Text>
          <Text style={styles.hint}>이름·소개·장소 글자와 공개 모임 상세 조건으로 목록을 좁혀요.</Text>

          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.blockLabel}>검색어</Text>
            <TextInput
              value={filters.textQuery}
              onChangeText={(t) => onChangeFilters({ ...filters, textQuery: t })}
              placeholder="모임 이름, 소개, 장소…"
              placeholderTextColor="#94a3b8"
              style={styles.textInput}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />

            <Text style={[styles.blockLabel, styles.blockLabelSpaced]}>모집 연령대</Text>
            <View style={styles.chipWrap}>
              {AGE_CHIPS.map(({ code, label }) => {
                const on = filters.ageInclude.includes(code);
                return (
                  <Pressable
                    key={code}
                    onPress={() => onChangeFilters({ ...filters, ageInclude: toggleAge(filters.ageInclude, code) })}
                    style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.blockLabel, styles.blockLabelSpaced]}>성별 비율</Text>
            <View style={styles.rowWrap}>
              <Pressable
                onPress={() => onChangeFilters({ ...filters, genderRatio: null })}
                style={({ pressed }) => [
                  styles.segBtn,
                  filters.genderRatio === null && styles.segBtnOn,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button">
                <Text style={[styles.segText, filters.genderRatio === null && styles.segTextOn]}>전체</Text>
              </Pressable>
              {GENDER_OPTIONS.map(({ value, label }) => {
                const on = filters.genderRatio === value;
                return (
                  <Pressable
                    key={value}
                    onPress={() => onChangeFilters({ ...filters, genderRatio: value })}
                    style={({ pressed }) => [styles.segBtn, on && styles.segBtnOn, pressed && styles.pressed]}
                    accessibilityRole="button">
                    <Text style={[styles.segText, on && styles.segTextOn]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.blockLabel, styles.blockLabelSpaced]}>정산</Text>
            <View style={styles.rowWrap}>
              <Pressable
                onPress={() => onChangeFilters({ ...filters, settlement: null })}
                style={({ pressed }) => [
                  styles.segBtn,
                  filters.settlement === null && styles.segBtnOn,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button">
                <Text style={[styles.segText, filters.settlement === null && styles.segTextOn]}>전체</Text>
              </Pressable>
              {SETTLE_OPTIONS.map(({ value, label }) => {
                const on = filters.settlement === value;
                return (
                  <Pressable
                    key={value}
                    onPress={() => onChangeFilters({ ...filters, settlement: value })}
                    style={({ pressed }) => [styles.segBtn, on && styles.segBtnOn, pressed && styles.pressed]}
                    accessibilityRole="button">
                    <Text style={[styles.segText, on && styles.segTextOn]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.blockLabel, styles.blockLabelSpaced]}>승인</Text>
            <View style={styles.rowWrap}>
              <Pressable
                onPress={() => onChangeFilters({ ...filters, approvalType: null })}
                style={({ pressed }) => [
                  styles.segBtn,
                  filters.approvalType === null && styles.segBtnOn,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button">
                <Text style={[styles.segText, filters.approvalType === null && styles.segTextOn]}>전체</Text>
              </Pressable>
              {APPROVAL_OPTIONS.map(({ value, label }) => {
                const on = filters.approvalType === value;
                return (
                  <Pressable
                    key={value}
                    onPress={() => onChangeFilters({ ...filters, approvalType: value })}
                    style={({ pressed }) => [styles.segBtn, on && styles.segBtnOn, pressed && styles.pressed]}
                    accessibilityRole="button">
                    <Text style={[styles.segText, on && styles.segTextOn]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              onPress={() => onChangeFilters(defaultFeedSearchFilters())}
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
              accessibilityRole="button">
              <Text style={styles.secondaryBtnLabel}>초기화</Text>
            </Pressable>
            <Pressable
              onPress={onApply}
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
              accessibilityRole="button">
              <Text style={styles.primaryBtnLabel}>적용</Text>
              <Ionicons name="checkmark" size={20} color="#fff" />
            </Pressable>
          </View>

          <Pressable onPress={onClose} style={styles.closeLink} accessibilityRole="button">
            <Text style={styles.closeLinkLabel}>닫기</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    maxHeight: '88%',
    borderRadius: 20,
    padding: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 4,
  },
  hint: {
    fontSize: 13,
    lineHeight: 18,
    color: '#64748b',
    marginBottom: 12,
  },
  scroll: {
    maxHeight: 420,
  },
  blockLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#64748b',
    marginBottom: 8,
  },
  blockLabelSpaced: {
    marginTop: 14,
  },
  textInput: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
  },
  chipOn: {
    backgroundColor: 'rgba(0, 82, 204, 0.12)',
    borderColor: 'rgba(0, 82, 204, 0.35)',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  chipTextOn: {
    color: GinitTheme.colors.primary,
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  segBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.1)',
  },
  segBtnOn: {
    backgroundColor: 'rgba(0, 82, 204, 0.1)',
    borderColor: 'rgba(0, 82, 204, 0.35)',
  },
  segText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
  },
  segTextOn: {
    color: GinitTheme.colors.primary,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 14,
    paddingTop: 4,
  },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
  },
  secondaryBtnLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#475569',
  },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: GinitTheme.colors.primary,
  },
  primaryBtnLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: '#fff',
  },
  closeLink: {
    marginTop: 10,
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  closeLinkLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: GinitTheme.trustBlue,
  },
  pressed: {
    opacity: 0.88,
  },
});
