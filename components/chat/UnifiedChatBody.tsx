
import { BlurView } from 'expo-blur';
import type { Timestamp } from 'firebase/firestore';
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    FlatList,
    Keyboard,
    type LayoutChangeEvent,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassInput } from '@/components/social/GlassInput';
import { NeonBadge } from '@/components/social/NeonBadge';
import { GinitTheme } from '@/constants/ginit-theme';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';

type UnifiedChatMessage = {
  id: string;
  senderId?: string | null;
  text: string;
  createdAt?: Timestamp | null;
};

function formatShortTime(ts: Timestamp | null | undefined): string {
  if (!ts || typeof ts.toDate !== 'function') return '';
  try {
    return ts.toDate().toLocaleString('ko-KR', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch {
    return '';
  }
}

export type UnifiedChatBodyProps<TMessage extends UnifiedChatMessage> = {
  title: string;
  noticeLine: string;
  messages: TMessage[];
  myUserId: string;
  draft: string;
  onChangeDraft: (t: string) => void;
  onSend: () => void;
  sending?: boolean;
  onPressNotice?: () => void;
  listRef?: RefObject<FlatList<TMessage> | null>;
};

export function UnifiedChatBody<TMessage extends UnifiedChatMessage>({
  title,
  noticeLine,
  messages,
  myUserId,
  draft,
  onChangeDraft,
  onSend,
  sending,
  onPressNotice,
  listRef: externalListRef,
}: UnifiedChatBodyProps<TMessage>) {
  const insets = useSafeAreaInsets();
  const innerListRef = useRef<FlatList<TMessage>>(null);
  const listRef = externalListRef ?? innerListRef;
  const myNorm = useMemo(() => (myUserId.trim() ? normalizeParticipantId(myUserId.trim()) ?? myUserId.trim() : ''), [myUserId]);
  const didInitialAutoScrollRef = useRef(false);
  const [composerDockBlockHeight, setComposerDockBlockHeight] = useState(104);
  const [composerInputBarHeight, setComposerInputBarHeight] = useState(56);
  const [showJumpToBottomFab, setShowJumpToBottomFab] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const composerBottomPad = Math.max(insets.bottom, 8);
  const listContentStyle = useMemo(
    () => [
      styles.listContent,
      {
        paddingBottom: keyboardVisible ? composerInputBarHeight : 4,
      },
    ],
    [keyboardVisible, composerInputBarHeight],
  );
  const jumpToLatest = useCallback(() => {
    setShowJumpToBottomFab(false);
    listRef.current?.scrollToEnd({ animated: false });
  }, [listRef]);

  const onComposerDockLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0) setComposerDockBlockHeight(h);
  }, []);

  useEffect(() => {
    const onKeyboardDidShow = () => {
      setKeyboardVisible(true);
      requestAnimationFrame(() => {
        setShowJumpToBottomFab(false);
        listRef.current?.scrollToEnd({ animated: true });
      });
    };
    const onKeyboardHide = () => {
      setKeyboardVisible(false);
    };
    const subs: { remove: () => void }[] = [];
    if (Platform.OS === 'ios') {
      subs.push(Keyboard.addListener('keyboardDidShow', onKeyboardDidShow));
      subs.push(Keyboard.addListener('keyboardWillHide', onKeyboardHide));
    } else {
      subs.push(Keyboard.addListener('keyboardDidShow', onKeyboardDidShow));
      subs.push(Keyboard.addListener('keyboardDidHide', onKeyboardHide));
    }
    return () => subs.forEach((s) => s.remove());
  }, [listRef]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.flex}>
        {noticeLine.trim() ? (
          <Pressable
            onPress={onPressNotice}
            style={styles.announcementBar}
            accessibilityRole="button"
            accessibilityLabel="공지">
            <BlurView tint="light" intensity={60} style={styles.announcementInner}>
              <GinitSymbolicIcon name="megaphone-outline" size={16} color="#0052CC" />
              <Text style={styles.announcementText} numberOfLines={1}>
                {noticeLine}
              </Text>
              <GinitSymbolicIcon name="chevron-forward" size={16} color="#64748b" />
            </BlurView>
          </Pressable>
        ) : null}

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={listContentStyle}
          onScroll={(e) => {
            const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
            const nearBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - 56;
            setShowJumpToBottomFab(!nearBottom);
          }}
          scrollEventThrottle={16}
          onContentSizeChange={() => {
            if (didInitialAutoScrollRef.current) return;
            didInitialAutoScrollRef.current = true;
            listRef.current?.scrollToEnd({ animated: false });
          }}
          onScrollToIndexFailed={(info) => {
            const h = Math.max(100, info.averageItemLength || 120);
            listRef.current?.scrollToOffset?.({ offset: Math.max(0, h * info.index), animated: false });
            requestAnimationFrame(() => {
              listRef.current?.scrollToIndex?.({ index: info.index, viewPosition: 0.35, animated: false });
            });
          }}
          renderItem={({ item }) => {
            const sid = item.senderId?.trim() ?? '';
            const mine = sid && (normalizeParticipantId(sid) ?? sid) === myNorm;
            if (mine) {
              return (
                <View style={styles.rowMine}>
                  <Text style={styles.timeMine}>{formatShortTime(item.createdAt)}</Text>
                  <View style={styles.bubbleMineWrap}>
                    <BlurView tint="light" intensity={55} style={styles.bubbleMine}>
                      <Text style={styles.bubbleMineText}>{item.text}</Text>
                    </BlurView>
                  </View>
                </View>
              );
            }
            return (
              <View style={styles.rowOther}>
                <View style={styles.otherBlock}>
                  <View style={styles.bubbleOtherWrap}>
                    <BlurView tint="light" intensity={60} style={styles.bubbleOther}>
                      <Text style={styles.bubbleOtherText}>{item.text}</Text>
                    </BlurView>
                  </View>
                  <Text style={styles.timeOther}>{formatShortTime(item.createdAt)}</Text>
                </View>
              </View>
            );
          }}
          ListHeaderComponent={
            <Text style={styles.threadTitle} numberOfLines={1}>
              {title}
            </Text>
          }
          ListEmptyComponent={<Text style={styles.empty}>첫 인사를 남겨 보세요.</Text>}
        />
        {showJumpToBottomFab ? (
          <Pressable
            style={[styles.jumpFab, { bottom: 12 + composerDockBlockHeight }]}
            onPress={jumpToLatest}
            accessibilityRole="button"
            accessibilityLabel="최신 메시지로">
            <GinitSymbolicIcon name="chevron-down" size={22} color="#334155" />
          </Pressable>
        ) : null}

        <View style={[styles.composerDock, { paddingBottom: composerBottomPad }]} onLayout={onComposerDockLayout}>
          <View style={styles.composerMeta} accessibilityElementsHidden>
            <NeonBadge label="Social · 1:1" pulse={false} />
          </View>
          <View
            style={styles.composer}
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              if (h > 0) setComposerInputBarHeight(h);
            }}>
            <GlassInput
              value={draft}
              onChangeText={onChangeDraft}
              placeholder="메시지 보내기"
              multiline
              submitBehavior="submit"
              blurOnSubmit={false}
              returnKeyType="send"
              onSubmitEditing={() => {
                if (sending || !draft.trim()) return;
                onSend();
              }}
              dense
              style={styles.composerInput}
            />
            <Pressable
              onPress={onSend}
              disabled={sending || !draft.trim()}
              style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnDisabled]}
              accessibilityRole="button"
              accessibilityLabel="보내기">
              <GinitSymbolicIcon name="send" size={20} color="#fff" />
            </Pressable>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ECEFF1' },
  flex: { flex: 1 },
  threadTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
    marginBottom: 10,
    textAlign: 'center',
  },
  announcementBar: {
    paddingHorizontal: 8,
    paddingTop: 6,
    backgroundColor: '#ECEFF1',
  },
  announcementInner: {
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    overflow: 'hidden',
  },
  announcementText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
  },
  listContent: {
    paddingHorizontal: 14,
    paddingBottom: 4,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  empty: { textAlign: 'center', color: '#94a3b8', marginTop: 24, fontWeight: '600' },
  rowMine: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    gap: 6,
    marginBottom: 10,
  },
  bubbleMineWrap: { maxWidth: '78%' },
  bubbleMine: {
    backgroundColor: 'rgba(0, 82, 204, 0.20)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    borderTopRightRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0, 82, 204, 0.32)',
    overflow: 'hidden',
  },
  bubbleMineText: {
    fontSize: 15,
    color: '#0f172a',
    lineHeight: 20,
    fontWeight: '600',
  },
  timeMine: { fontSize: 11, color: '#94a3b8', marginBottom: 2 },
  rowOther: { flexDirection: 'row', marginBottom: 10 },
  otherBlock: { flex: 1, minWidth: 0 },
  bubbleOtherWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  bubbleOther: {
    maxWidth: '78%',
    backgroundColor: 'rgba(255,255,255,0.62)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    borderTopLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    overflow: 'hidden',
  },
  bubbleOtherText: {
    fontSize: 15,
    color: '#0f172a',
    lineHeight: 20,
    fontWeight: '600',
  },
  timeOther: { fontSize: 11, color: '#94a3b8', marginTop: 4 },
  composerMeta: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(15, 23, 42, 0.08)',
  },
  composerDock: {
    width: '100%',
    flexShrink: 0,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(15, 23, 42, 0.08)',
  },
  composerInput: { minHeight: 40, maxHeight: 120 },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GinitTheme.colors.primary,
  },
  sendBtnDisabled: { opacity: 0.45 },
  jumpFab: {
    position: 'absolute',
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.34)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
    zIndex: 8,
  },
});
