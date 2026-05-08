import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';
import { meetingChatBodyStyles as chatStyles } from '@/components/chat/meeting-chat-body-styles';

export type MeetingChatBubbleActionMenuAction = {
  key: 'share' | 'reply' | 'copy' | 'delete';
  label: string;
  onPress: () => void | Promise<void>;
};

export function MeetingChatBubbleActionMenu({
  visible,
  anchor,
  onRequestClose,
  actions,
}: {
  visible: boolean;
  anchor: { x: number; y: number } | null;
  onRequestClose: () => void;
  actions: MeetingChatBubbleActionMenuAction[];
}) {
  const { width: winW, height: winH } = useWindowDimensions();

  const menuSize = useMemo(() => {
    const itemH = styles.item.paddingVertical * 2 + styles.itemText.fontSize * 1.25;
    const h = Math.ceil(actions.length * itemH + 2); // + border
    const w = Math.max(styles.menu.minWidth ?? 140, 160);
    return { w, h };
  }, [actions.length]);

  const pos = useMemo(() => {
    if (!anchor) return { left: 12, top: 12 };
    const pad = 8;
    const preferLeft = anchor.x - 18;
    const preferTop = anchor.y - 54;

    // 화면 밖으로 나가면 위로(또는 아래로) 자동 보정
    let left = preferLeft;
    let top = preferTop;

    // X clamp
    left = Math.min(Math.max(pad, left), Math.max(pad, winW - menuSize.w - pad));

    // Y: 기본은 앵커 위쪽, 아래가 가려지면 더 위로 올림.
    if (top + menuSize.h > winH - pad) {
      top = anchor.y - menuSize.h - 12;
    }
    top = Math.min(Math.max(pad, top), Math.max(pad, winH - menuSize.h - pad));

    return { left, top };
  }, [anchor, menuSize.h, menuSize.w, winH, winW]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onRequestClose}
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onRequestClose} />
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <View style={[styles.menu, pos] as StyleProp<ViewStyle>}>
          {actions.map((a) => (
            <Pressable
              key={a.key}
              onPress={() => {
                onRequestClose();
                void a.onPress();
              }}
              style={({ pressed }) => [styles.item, pressed && chatStyles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={a.label}
            >
              <Text style={styles.itemText}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  menu: {
    position: 'absolute',
    minWidth: 140,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
  },
  item: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  itemText: {
    fontSize: 14,
    fontWeight: '700',
    color: GinitTheme.colors.text,
  },
});

