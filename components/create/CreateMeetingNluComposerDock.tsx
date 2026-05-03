import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Keyboard,
  type KeyboardEvent,
  LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { meetingChatBodyStyles } from '@/components/chat/meeting-chat-body-styles';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';

function VoiceWaveformMini({ active, color }: { active: boolean; color: string }) {
  const v1 = useRef(new Animated.Value(0)).current;
  const v2 = useRef(new Animated.Value(0)).current;
  const v3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) return;
    const mk = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, { toValue: 1, duration: 220, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 260, useNativeDriver: true }),
        ]),
      );
    const l1 = mk(v1, 0);
    const l2 = mk(v2, 90);
    const l3 = mk(v3, 180);
    l1.start();
    l2.start();
    l3.start();
    return () => {
      l1.stop();
      l2.stop();
      l3.stop();
      v1.setValue(0);
      v2.setValue(0);
      v3.setValue(0);
    };
  }, [active, v1, v2, v3]);

  if (!active) return null;

  const barStyle = (v: Animated.Value) => ({
    transform: [
      {
        scaleY: v.interpolate({
          inputRange: [0, 1],
          outputRange: [0.35, 1.0],
        }),
      },
    ],
  });

  return (
    <View style={dockStyles.voiceWaveWrap} pointerEvents="none">
      <Animated.View style={[dockStyles.voiceWaveBar, { backgroundColor: color }, barStyle(v1)]} />
      <Animated.View style={[dockStyles.voiceWaveBar, { backgroundColor: color }, barStyle(v2)]} />
      <Animated.View style={[dockStyles.voiceWaveBar, { backgroundColor: color }, barStyle(v3)]} />
    </View>
  );
}

export type CreateMeetingNluComposerDockProps = {
  draft: string;
  onChangeDraft: (t: string) => void;
  onSend: () => void | Promise<void>;
  onPressVoice: () => void | Promise<void>;
  voiceRecognizing: boolean;
  nluBusy: boolean;
  catLoading: boolean;
  busy: boolean;
  /** `SafeAreaView` 등 부모 `paddingHorizontal`만큼 음수 마진으로 채팅 도크 풀블리드 */
  horizontalBleedPx: number;
  onDockHeightChange: (heightPx: number) => void;
  /** 키보드 올라옴 여부 — 상위에서 배경 흐림 등에 사용 */
  onKeyboardOpenChange?: (open: boolean) => void;
};

export function CreateMeetingNluComposerDock({
  draft,
  onChangeDraft,
  onSend,
  onPressVoice,
  voiceRecognizing,
  nluBusy,
  catLoading,
  busy,
  horizontalBleedPx,
  onDockHeightChange,
  onKeyboardOpenChange,
}: CreateMeetingNluComposerDockProps) {
  const insets = useSafeAreaInsets();
  /** 모임 채팅과 동일한 이벤트로 키보드 높이 추적 — 적용 방식은 플랫폼·부모 SafeArea와 맞춤 */
  const [keyboardBottomInset, setKeyboardBottomInset] = useState(0);

  useEffect(() => {
    const slack = Platform.select({ ios: 8, android: 10, default: 8 });
    const apply = (e: KeyboardEvent) => {
      const { height, screenY } = e.endCoordinates;
      const h = typeof height === 'number' ? height : 0;
      if (h < 32) return;
      const winH = Dimensions.get('window').height;
      const fromBottom = Number.isFinite(screenY) ? Math.max(0, winH - screenY) : 0;
      let pad = h + slack;
      if (fromBottom > h + 28) {
        pad = fromBottom + Math.min(slack + 4, 12);
      }
      setKeyboardBottomInset(Math.ceil(pad));
    };
    const clear = () => {
      setKeyboardBottomInset(0);
    };

    const subs: { remove: () => void }[] = [];
    if (Platform.OS === 'ios') {
      subs.push(Keyboard.addListener('keyboardWillShow', apply));
      subs.push(Keyboard.addListener('keyboardWillChangeFrame', apply));
      subs.push(Keyboard.addListener('keyboardWillHide', clear));
    } else {
      subs.push(Keyboard.addListener('keyboardDidShow', apply));
      subs.push(Keyboard.addListener('keyboardDidHide', clear));
    }
    return () => subs.forEach((s) => s.remove());
  }, []);

  useEffect(() => {
    onKeyboardOpenChange?.(keyboardBottomInset > 0);
  }, [keyboardBottomInset, onKeyboardOpenChange]);

  /** 모임 채팅방과 동일 — 부모는 `SafeAreaView` `bottom` 없이 풀블리드 하단( `details.tsx` ) */
  const composerBottomPad =
    keyboardBottomInset > 0 ? keyboardBottomInset : Math.max(insets.bottom, 8);

  const onRootLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const h = e.nativeEvent.layout.height;
      if (h > 0) onDockHeightChange(h);
    },
    [onDockHeightChange],
  );

  const inputDisabled = busy || nluBusy;
  const sendDisabled = busy || nluBusy || catLoading || !draft.trim();

  return (
    <View
      style={[dockStyles.root, horizontalBleedPx !== 0 && { marginHorizontal: -horizontalBleedPx }]}
      onLayout={onRootLayout}
      accessibilityElementsHidden={false}>
      <View style={[meetingChatBodyStyles.composerDock, { paddingBottom: composerBottomPad }]}>
        <View style={meetingChatBodyStyles.composerCluster}>
          <View style={meetingChatBodyStyles.composer}>
            <Pressable
              style={meetingChatBodyStyles.plusBtn}
              onPress={() => void onPressVoice()}
              disabled={busy || nluBusy}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="모임 내용 음성 입력">
              {voiceRecognizing ? (
                <VoiceWaveformMini active color={GinitTheme.colors.primary} />
              ) : (
                <GinitSymbolicIcon name="mic" size={22} color="#475569" />
              )}
            </Pressable>
            <View style={meetingChatBodyStyles.inputShell}>
              <TextInput
                value={draft}
                onChangeText={onChangeDraft}
                placeholder="말 한마디로 모임을 완성해 보세요."
                placeholderTextColor="#94a3b8"
                style={meetingChatBodyStyles.input}
                multiline
                submitBehavior="submit"
                blurOnSubmit={false}
                returnKeyType="send"
                onSubmitEditing={() => {
                  if (sendDisabled) return;
                  void onSend();
                }}
                maxLength={4000}
                editable={!inputDisabled}
                keyboardType="default"
                inputMode="text"
              />
            </View>
            <Pressable
              onPress={() => void onSend()}
              disabled={sendDisabled}
              style={[meetingChatBodyStyles.sendBtn, sendDisabled && meetingChatBodyStyles.sendBtnDisabled]}
              accessibilityRole="button"
              accessibilityLabel="보내기">
              {nluBusy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <GinitSymbolicIcon name="send" size={20} color="#fff" />
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const dockStyles = StyleSheet.create({
  root: {
    flexShrink: 0,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(15, 23, 42, 0.08)',
  },
  voiceWaveWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 3,
    height: 18,
  },
  voiceWaveBar: {
    width: 3,
    height: 18,
    borderRadius: 2,
    opacity: 0.95,
  },
});
