import { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';

export type ScreenTransitionSkeletonVariant = 'list' | 'chat' | 'detail' | 'profile';

export type ScreenTransitionSkeletonProps = {
  variant?: ScreenTransitionSkeletonVariant;
  rows?: number;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
};

function SkeletonBlock({
  style,
}: {
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.block, style]} />;
}

function ListRowSkeleton({ chat }: { chat?: boolean }) {
  return (
    <View style={styles.row}>
      <SkeletonBlock style={chat ? styles.avatarCircle : styles.thumb} />
      <View style={styles.rowTextCol}>
        <SkeletonBlock style={styles.titleLine} />
        <SkeletonBlock style={styles.subLine} />
        <SkeletonBlock style={styles.metaLine} />
      </View>
    </View>
  );
}

export function ScreenTransitionSkeleton({
  variant = 'list',
  rows,
  style,
  contentStyle,
}: ScreenTransitionSkeletonProps) {
  const rowCount = rows ?? (variant === 'detail' ? 4 : variant === 'profile' ? 5 : 7);
  const rowIndexes = useMemo(() => Array.from({ length: rowCount }, (_, i) => i), [rowCount]);

  if (variant === 'detail') {
    return (
      <View style={[styles.root, style]} accessibilityLabel="화면을 불러오는 중">
        <View style={[styles.content, contentStyle]}>
          <SkeletonBlock style={styles.detailHero} />
          <SkeletonBlock style={styles.detailTitle} />
          <SkeletonBlock style={styles.detailSub} />
          {rowIndexes.map((idx) => (
            <View key={idx} style={styles.detailSection}>
              <SkeletonBlock style={styles.sectionTitle} />
              <SkeletonBlock style={styles.sectionLineWide} />
              <SkeletonBlock style={styles.sectionLine} />
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (variant === 'profile') {
    return (
      <View style={[styles.root, style]} accessibilityLabel="화면을 불러오는 중">
        <View style={[styles.content, contentStyle]}>
          <View style={styles.profileHead}>
            <SkeletonBlock style={styles.profileAvatar} />
            <View style={styles.rowTextCol}>
              <SkeletonBlock style={styles.titleLine} />
              <SkeletonBlock style={styles.subLine} />
            </View>
          </View>
          {rowIndexes.map((idx) => (
            <View key={idx} style={styles.menuRow}>
              <SkeletonBlock style={styles.menuIcon} />
              <SkeletonBlock style={idx % 2 === 0 ? styles.menuLineWide : styles.menuLine} />
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, style]} accessibilityLabel="화면을 불러오는 중">
      <View style={[styles.content, contentStyle]}>
        {rowIndexes.map((idx) => (
          <ListRowSkeleton key={idx} chat={variant === 'chat'} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: GinitTheme.colors.bg,
  },
  content: {
    paddingHorizontal: GinitTheme.spacing.lg,
    paddingTop: GinitTheme.spacing.md,
    paddingBottom: GinitTheme.spacing.xl,
  },
  block: {
    backgroundColor: GinitTheme.colors.primarySoft,
    borderRadius: 12,
  },
  row: {
    minHeight: 86,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GinitTheme.colors.border,
  },
  thumb: {
    width: 54,
    height: 54,
    borderRadius: 16,
  },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  rowTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 8,
  },
  titleLine: {
    width: '64%',
    height: 16,
  },
  subLine: {
    width: '82%',
    height: 12,
  },
  metaLine: {
    width: '42%',
    height: 11,
  },
  detailHero: {
    height: 116,
    borderRadius: GinitTheme.radius.card,
    marginBottom: 18,
  },
  detailTitle: {
    width: '72%',
    height: 22,
    marginBottom: 10,
  },
  detailSub: {
    width: '48%',
    height: 14,
    marginBottom: 18,
  },
  detailSection: {
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GinitTheme.colors.border,
    gap: 10,
  },
  sectionTitle: {
    width: '34%',
    height: 15,
  },
  sectionLineWide: {
    width: '88%',
    height: 12,
  },
  sectionLine: {
    width: '58%',
    height: 12,
  },
  profileHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GinitTheme.colors.border,
  },
  profileAvatar: {
    width: 64,
    height: 64,
    borderRadius: 22,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GinitTheme.colors.border,
  },
  menuIcon: {
    width: 30,
    height: 30,
    borderRadius: 12,
  },
  menuLineWide: {
    width: '68%',
    height: 14,
  },
  menuLine: {
    width: '48%',
    height: 14,
  },
});
