import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitSymbolicIcon, type SymbolicIconName } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo } from 'react';
import { Modal, Platform, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import type {
  GamificationStatChangePayload,
  GamificationStatChangeTone,
  GamificationStatRow,
} from '@/components/gamification/gamification-stat-change-types';
import { useAnimatedStatDelta } from '@/components/gamification/use-animated-stat-delta';
import { useGamificationReducedMotion } from '@/components/gamification/use-gamification-reduced-motion';

type Props = {
  visible: boolean;
  payload: GamificationStatChangePayload;
  onDismiss: () => void;
};

const STAGGER_MS = 120;

export function GamificationStatChangeModal({ visible, payload, onDismiss }: Props) {
  const reducedMotion = useGamificationReducedMotion();
  const shouldAnimateNumbers =
    payload.mode === 'result' && payload.animateNumbers !== false && !reducedMotion;

  const cardScale = useSharedValue(0.92);
  const cardOpacity = useSharedValue(0);

  useEffect(() => {
    if (!visible) return;
    if (reducedMotion) {
      cardScale.value = 1;
      cardOpacity.value = 1;
    } else {
      cardScale.value = withSpring(1, { damping: 18, stiffness: 220 });
      cardOpacity.value = withTiming(1, { duration: 280 });
    }
    if (Platform.OS === 'web') return;
    if (payload.tone === 'reward') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (payload.tone === 'penalty') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  }, [visible, payload.tone, reducedMotion, cardOpacity, cardScale]);

  const cardAnimStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ scale: cardScale.value }],
  }));

  const palette = useMemo(() => tonePalette(payload.tone), [payload.tone]);

  const handlePrimary = () => {
    payload.primaryButton.onPress?.();
    onDismiss();
  };

  const handleSecondary = () => {
    payload.secondaryButton?.onPress?.();
    onDismiss();
  };

  const trustRow = payload.rows.find((r) => r.kind === 'trust');
  const xpRow = payload.rows.find((r) => r.kind === 'xp');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
      accessibilityViewIsModal>
      <View style={styles.backdrop}>
        <GinitPressable onPress={(e) => e.stopPropagation()} accessibilityRole="none">
          <Animated.View style={[styles.card, cardAnimStyle]}>
            <Text style={styles.title}>{payload.title}</Text>
            {payload.body?.trim() ? <Text style={styles.body}>{payload.body.trim()}</Text> : null}

            {trustRow ? (
              <StatRow
                row={trustRow}
                rowBg={palette.rowBg}
                valueColor={palette.valueColor}
                animate={shouldAnimateNumbers}
                delayMs={0}
                reducedMotion={reducedMotion}
              />
            ) : null}
            {xpRow ? (
              <StatRow
                row={xpRow}
                rowBg={palette.rowBg}
                valueColor={palette.valueColor}
                animate={shouldAnimateNumbers}
                delayMs={trustRow ? STAGGER_MS : 0}
                reducedMotion={reducedMotion}
              />
            ) : null}

            {payload.penaltyCountNote?.trim() ? (
              <Text style={styles.penaltyNote}>{payload.penaltyCountNote.trim()}</Text>
            ) : null}
            {payload.footnote?.trim() ? <Text style={styles.footnote}>{payload.footnote.trim()}</Text> : null}

            <View style={styles.actions}>
              {payload.secondaryButton ? (
                <GinitPressable
                  onPress={handleSecondary}
                  style={({ pressed }) => [
                    styles.btn,
                    styles.btnSecondary,
                    pressed && styles.btnPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={payload.secondaryButton.label}>
                  <Text style={styles.btnSecondaryText}>{payload.secondaryButton.label}</Text>
                </GinitPressable>
              ) : null}
              <GinitPressable
                onPress={handlePrimary}
                style={({ pressed }) => [
                  styles.btn,
                  primaryBtnStyle(payload.primaryButton.variant ?? 'primary'),
                  pressed && styles.btnPressed,
                  !payload.secondaryButton && styles.btnFull,
                ]}
                accessibilityRole="button"
                accessibilityLabel={payload.primaryButton.label}>
                <Text
                  style={[
                    styles.btnPrimaryText,
                    (payload.primaryButton.variant === 'destructive' ||
                      payload.primaryButton.variant === 'primary') &&
                      styles.btnPrimaryTextOnFill,
                  ]}>
                  {payload.primaryButton.label}
                </Text>
              </GinitPressable>
            </View>
          </Animated.View>
        </GinitPressable>
      </View>
    </Modal>
  );
}

function StatRow({
  row,
  rowBg,
  valueColor,
  animate,
  delayMs,
  reducedMotion,
}: {
  row: GamificationStatRow;
  rowBg: string;
  valueColor: string;
  animate: boolean;
  delayMs: number;
  reducedMotion: boolean;
}) {
  const isGain = row.delta > 0;
  const target = Math.abs(Math.trunc(row.delta));
  const { displayText, pulseScale } = useAnimatedStatDelta({
    target,
    isGain,
    animate,
    delayMs,
    reducedMotion,
  });

  const valueAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  const icon: SymbolicIconName = row.kind === 'trust' ? 'shield-checkmark-outline' : 'flash-outline';
  const label = row.kind === 'trust' ? '신뢰' : 'XP';

  return (
    <View style={[styles.statRow, { backgroundColor: rowBg }]} accessibilityLabel={`${label} ${displayText}`}>
      <View style={styles.statRowLeft}>
        <GinitSymbolicIcon name={icon} size={20} color={valueColor} />
        <Text style={styles.statLabel}>{label}</Text>
      </View>
      <Animated.Text style={[styles.statValue, { color: valueColor }, valueAnimStyle]}>{displayText}</Animated.Text>
    </View>
  );
}

function tonePalette(tone: GamificationStatChangeTone) {
  if (tone === 'reward') {
    return { rowBg: '#ECFDF5', valueColor: GinitTheme.colors.success };
  }
  if (tone === 'penalty') {
    return { rowBg: '#FEF2F2', valueColor: GinitTheme.colors.danger };
  }
  return { rowBg: '#F1F5F9', valueColor: GinitTheme.colors.text };
}

function primaryBtnStyle(variant: 'primary' | 'destructive' | 'secondary') {
  if (variant === 'destructive') return styles.btnDestructive;
  if (variant === 'secondary') return styles.btnSecondary;
  return styles.btnPrimary;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 22,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.35)',
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(15, 23, 42, 0.12)',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 1,
        shadowRadius: 16,
      },
      android: { elevation: 8 },
      default: {},
    }),
  },
  title: {
    ...GinitTheme.typography.title,
    color: GinitTheme.colors.text,
    textAlign: 'center',
  },
  body: {
    marginTop: 10,
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 22,
    color: GinitTheme.colors.textSub,
    textAlign: 'center',
  },
  statRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  statRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: GinitTheme.colors.text,
  },
  statValue: {
    fontSize: 26,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  penaltyNote: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.danger,
    textAlign: 'center',
  },
  footnote: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 18,
    color: GinitTheme.colors.textMuted,
    textAlign: 'center',
  },
  actions: {
    marginTop: 18,
    flexDirection: 'row',
    gap: 10,
  },
  btn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  btnFull: {
    flex: 1,
  },
  btnPrimary: {
    backgroundColor: GinitTheme.colors.primary,
  },
  btnDestructive: {
    backgroundColor: GinitTheme.colors.danger,
  },
  btnSecondary: {
    backgroundColor: '#F1F5F9',
  },
  btnPressed: {
    opacity: 0.88,
  },
  btnPrimaryText: {
    fontSize: 15,
    fontWeight: '700',
    color: GinitTheme.colors.text,
  },
  btnPrimaryTextOnFill: {
    color: '#FFFFFF',
  },
  btnSecondaryText: {
    fontSize: 15,
    fontWeight: '700',
    color: GinitTheme.colors.textSub,
  },
});
