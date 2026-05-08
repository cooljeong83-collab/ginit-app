import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';
import { meetingChatBodyStyles as chatStyles } from '@/components/chat/meeting-chat-body-styles';

export type MeetingChatBubbleActionMenuAction = {
  key: 'share' | 'reply' | 'copy';
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
  const pos = useMemo(() => {
    if (!anchor) return { left: 12, top: 12 };
    // 너무 아래에서 열리면 가려질 수 있어 살짝 위로 띄웁니다.
    return { left: Math.max(8, anchor.x - 18), top: Math.max(8, anchor.y - 54) };
  }, [anchor]);

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

