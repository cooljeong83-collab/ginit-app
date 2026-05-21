import { Image } from 'expo-image';
import { useCallback, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';

import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import type { ActiveNoticeItem } from '@/src/features/notices/notices-api';

const ACCENT = '#673AB7';

type Props = {
  notice: ActiveNoticeItem;
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onSnoozeToday: () => void;
};

export function NoticePopupModal({ notice, visible, onClose, onConfirm, onSnoozeToday }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(notice.imageUrl?.trim()) && !imageFailed;

  const onCta = useCallback(() => {
    onConfirm();
  }, [onConfirm]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <GinitPressable
            onPress={onClose}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel="닫기"
            hitSlop={12}>
            <GinitSymbolicIcon name="close" size={22} color={GinitTheme.colors.textMuted} />
          </GinitPressable>
          {showImage ? (
            <Image
              source={{ uri: notice.imageUrl! }}
              style={styles.hero}
              contentFit="cover"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <View style={styles.heroFallback}>
              <GinitSymbolicIcon name="megaphone-outline" size={40} color={ACCENT} />
            </View>
          )}
          <Text style={styles.title}>{notice.title}</Text>
          {notice.content.trim() ? (
            <Text style={styles.body} numberOfLines={4}>
              {notice.content}
            </Text>
          ) : null}
          <View style={styles.actions}>
            {notice.linkUrl ? (
              <GinitPressable
                onPress={onCta}
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
                accessibilityRole="button"
                accessibilityLabel="자세히 보기">
                <Text style={styles.primaryBtnText}>자세히 보기</Text>
              </GinitPressable>
            ) : null}
            <GinitPressable
              onPress={onClose}
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.btnPressed]}
              accessibilityRole="button"
              accessibilityLabel="닫기">
              <Text style={styles.secondaryBtnText}>닫기</Text>
            </GinitPressable>
          </View>
          <GinitPressable
            onPress={onSnoozeToday}
            style={styles.snoozeBtn}
            accessibilityRole="button"
            accessibilityLabel="오늘 하루 안 보기">
            <Text style={styles.snoozeText}>오늘 하루 안 보기</Text>
          </GinitPressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: ACCENT,
    overflow: 'hidden',
    paddingBottom: 16,
  },
  closeBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 2,
    padding: 4,
  },
  hero: {
    width: '100%',
    height: 200,
    backgroundColor: GinitTheme.colors.bgAlt,
  },
  heroFallback: {
    width: '100%',
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3E5F5',
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#311B92',
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  body: {
    fontSize: 14,
    fontWeight: '500',
    color: GinitTheme.colors.textMuted,
    lineHeight: 20,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  actions: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 8,
  },
  primaryBtn: {
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryBtn: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: GinitTheme.colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  btnPressed: {
    opacity: 0.9,
  },
  snoozeBtn: {
    marginTop: 8,
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  snoozeText: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
  },
});
