import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitTheme } from '@/constants/ginit-theme';
import { useEffect, useRef } from 'react';
import { Animated, Modal, Platform, StyleSheet, Text, View } from 'react-native';

import type { AppDialogButton, AppDialogPayload } from '@/components/dialog/app-dialog-types';

type Props = {
  visible: boolean;
  payload: AppDialogPayload;
  onDismiss: () => void;
};

export function AppDialogModal({ visible, payload, onDismiss }: Props) {
  const cardScale = useRef(new Animated.Value(0.96)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const buttons = payload.buttons.slice(0, 3);

  useEffect(() => {
    if (!visible) return;
    cardScale.setValue(0.96);
    cardOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(cardScale, {
        toValue: 1,
        damping: 18,
        stiffness: 220,
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, cardOpacity, cardScale]);

  const pressButton = (btn: AppDialogButton) => {
    btn.onPress?.();
    onDismiss();
  };

  const stacked = buttons.length >= 3;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
      accessibilityViewIsModal>
      <View style={styles.backdrop}>
        <GinitPressable onPress={(e) => e.stopPropagation()} accessibilityRole="none">
          <Animated.View
            style={[styles.card, { opacity: cardOpacity, transform: [{ scale: cardScale }] }]}>
            <Text style={styles.title}>{payload.title}</Text>
            {payload.body?.trim() ? <Text style={styles.body}>{payload.body.trim()}</Text> : null}
            {payload.footnote?.trim() ? (
              <Text style={styles.footnote}>{payload.footnote.trim()}</Text>
            ) : null}

            <View style={[styles.actions, stacked && styles.actionsStacked]}>
              {buttons.map((btn, index) => (
                <GinitPressable
                  key={`${btn.label}-${index}`}
                  onPress={() => pressButton(btn)}
                  style={({ pressed }) => [
                    styles.btn,
                    stacked ? styles.btnStacked : index === 0 && buttons.length === 2 ? styles.btnHalf : styles.btnFull,
                    btnStyle(btn.variant ?? defaultVariantForIndex(index, buttons.length)),
                    pressed && styles.btnPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={btn.label}>
                  <Text
                    style={[
                      styles.btnLabel,
                      isFilledVariant(btn.variant ?? defaultVariantForIndex(index, buttons.length)) &&
                        styles.btnLabelOnFill,
                    ]}>
                    {btn.label}
                  </Text>
                </GinitPressable>
              ))}
            </View>
          </Animated.View>
        </GinitPressable>
      </View>
    </Modal>
  );
}

function defaultVariantForIndex(index: number, total: number): AppDialogButton['variant'] {
  if (total === 1) return 'primary';
  if (index === total - 1) return 'primary';
  return 'secondary';
}

function isFilledVariant(variant: AppDialogButton['variant']): boolean {
  return variant === 'primary' || variant === 'destructive';
}

function btnStyle(variant: AppDialogButton['variant']) {
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
  actionsStacked: {
    flexDirection: 'column',
  },
  btn: {
    minHeight: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  btnHalf: {
    flex: 1,
  },
  btnFull: {
    flex: 1,
  },
  btnStacked: {
    width: '100%',
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
  btnLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: GinitTheme.colors.textSub,
  },
  btnLabelOnFill: {
    color: '#FFFFFF',
  },
});
