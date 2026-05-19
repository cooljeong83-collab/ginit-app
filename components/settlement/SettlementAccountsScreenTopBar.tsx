import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';

/** 프로필 설정 상단 바와 동일 스타일 — 정산 계좌 스택 전용 화면용 */
export function SettlementAccountsScreenTopBar({
  title,
  onBack,
  onShare,
  sharing,
  onEdit,
}: {
  title: string;
  onBack: () => void;
  /** 정산 완료 화면 등 — 우측 공유(카카오톡 등 OS 공유 시트) */
  onShare?: () => void;
  sharing?: boolean;
  /** 장소 리뷰 등 — 우측 수정(연필) */
  onEdit?: () => void;
}) {
  return (
    <View style={styles.topBar}>
      <GinitPressable
        onPress={onBack}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="뒤로"
        style={styles.backBtn}>
        <GinitSymbolicIcon name="chevron-back" size={22} color="#0f172a" />
      </GinitPressable>
      <Text style={styles.topTitle} numberOfLines={1} ellipsizeMode="tail">
        {title}
      </Text>
      {onShare ? (
        <GinitPressable
          onPress={onShare}
          disabled={sharing}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="카카오톡으로 공유"
          style={styles.backBtn}>
          {sharing ? (
            <ActivityIndicator size="small" color="#0f172a" />
          ) : (
            <GinitSymbolicIcon name="share-outline" size={22} color="#0f172a" />
          )}
        </GinitPressable>
      ) : onEdit ? (
        <GinitPressable
          onPress={onEdit}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="후기 수정"
          style={styles.backBtn}>
          <GinitSymbolicIcon name="pencil" size={22} color="#0f172a" />
        </GinitPressable>
      ) : (
        <View style={styles.topBarSpacer} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 48,
  },
  backBtn: { padding: 4 },
  topTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: '#0f172a' },
  topBarSpacer: { width: 30 },
});
