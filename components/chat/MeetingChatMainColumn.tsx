
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import type { RefObject } from 'react';
import type {
  LayoutChangeEvent,
  ListRenderItem,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { KeyboardAwareFlatList } from 'react-native-keyboard-aware-scroll-view';

import { meetingChatBodyStyles as styles } from '@/components/chat/meeting-chat-body-styles';
import { replyPreviewText, replyTargetLabel } from '@/components/chat/meeting-chat-ui-helpers';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import type { MeetingChatListRow } from '@/src/lib/meeting-chat-list-rows';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import type { UserProfile } from '@/src/lib/user-profile';

export type MeetingChatMainColumnProps = {
  chatError: string | null;
  searchNavigateLoading: boolean;
  setListRef: (r: unknown) => void;
  setInnerFlatListRef: (r: unknown) => void;
  chatListRows: MeetingChatListRow[];
  renderItem: ListRenderItem<MeetingChatListRow>;
  chatListContentStyle: StyleProp<ViewStyle>;
  onScrollToIndexFailed: (info: {
    index: number;
    averageItemLength?: number;
  }) => void;
  onChatScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  listFooterLoading: React.ReactElement | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onPrefetchOlderMessages?: () => void;
  showJumpToBottomFab: boolean;
  composerDockBlockHeight: number;
  jumpToLatest: () => void;
  composerBottomPad: number;
  onComposerDockLayout: (e: LayoutChangeEvent) => void;
  replyTo: MeetingChatMessage['replyTo'];
  setReplyTo: (v: MeetingChatMessage['replyTo']) => void;
  profiles: Map<string, UserProfile>;
  setComposerInputBarHeight: (h: number) => void;
  messageInputRef: RefObject<TextInput | null>;
  draft: string;
  setDraft: (t: string) => void;
  sending: boolean;
  onSend: () => void;
  onPressAttach?: () => void;
};

export function MeetingChatMainColumn({
  chatError,
  searchNavigateLoading,
  setListRef,
  setInnerFlatListRef,
  chatListRows,
  renderItem,
  chatListContentStyle,
  onScrollToIndexFailed,
  onChatScroll,
  listFooterLoading,
  hasNextPage,
  isFetchingNextPage,
  onPrefetchOlderMessages,
  showJumpToBottomFab,
  composerDockBlockHeight,
  jumpToLatest,
  composerBottomPad,
  onComposerDockLayout,
  replyTo,
  setReplyTo,
  profiles,
  setComposerInputBarHeight,
  messageInputRef,
  draft,
  setDraft,
  sending,
  onSend,
  onPressAttach,
}: MeetingChatMainColumnProps) {
  return (
    <View style={styles.chatMainColumn}>
      <View style={styles.listWrap}>
        {chatError ? (
          <View style={styles.chatErrorBanner}>
            <Text style={styles.chatErrorText}>{chatError}</Text>
          </View>
        ) : null}
        {searchNavigateLoading ? (
          <View
            style={styles.searchJumpLoadingOverlay}
            pointerEvents="auto"
            accessibilityLabel="이전 대화를 불러오는 중">
            <ActivityIndicator color={GinitTheme.colors.primary} size="large" />
            <Text style={styles.searchJumpLoadingText}>이전 대화를 불러오는 중…</Text>
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <KeyboardAwareFlatList
            ref={setListRef}
            innerRef={setInnerFlatListRef}
            data={chatListRows}
            keyExtractor={(row) => {
              if (row.type === 'message') return row.message.id;
              return `album:${row.batchId}:${row.messages.map((m: MeetingChatMessage) => m.id).join(':')}`;
            }}
            renderItem={renderItem}
            contentContainerStyle={chatListContentStyle}
            inverted
            onScroll={onChatScroll}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            /** 입력창은 리스트 밖에서 이미 `paddingBottom: composerBottomPad`로 키보드를 반영함. HOC가 키보드 높이를 또 넣으면 역전 리스트 하단에 이중 여백이 생김 */
            enableOnAndroid={false}
            extraScrollHeight={0}
            enableAutomaticScroll={false}
            contentInset={{ bottom: 0, top: 0, left: 0, right: 0 }}
            scrollIndicatorInsets={{ bottom: 0 }}
            onScrollToIndexFailed={onScrollToIndexFailed}
            ListEmptyComponent={<Text style={styles.emptyChat}>첫 메시지를 남겨 보세요.</Text>}
            ListFooterComponent={isFetchingNextPage ? listFooterLoading : null}
            onEndReached={hasNextPage ? onPrefetchOlderMessages : undefined}
            onEndReachedThreshold={0.55}
            initialNumToRender={14}
            maxToRenderPerBatch={10}
            windowSize={11}
            updateCellsBatchingPeriod={50}
            removeClippedSubviews={false}
          />
        </View>
        {showJumpToBottomFab ? (
          <Pressable
            style={[styles.jumpFab, { bottom: 12 + composerDockBlockHeight }]}
            onPress={jumpToLatest}
            accessibilityRole="button"
            accessibilityLabel="최신 메시지로">
            <GinitSymbolicIcon name="chevron-down" size={22} color="#334155" />
          </Pressable>
        ) : null}
      </View>
      <View style={[styles.composerDock, { paddingBottom: composerBottomPad }]} onLayout={onComposerDockLayout}>
        {replyTo?.messageId ? (
          <View style={styles.replyPreviewRow}>
            <BlurView tint="light" intensity={55} style={styles.replyPreviewCard}>
              <View style={styles.replyPreviewIconWrap} accessibilityElementsHidden pointerEvents="none">
                <GinitSymbolicIcon name="return-up-back-outline" size={20} color="#0f172a" />
              </View>
              <View style={styles.replyPreviewTextCol} pointerEvents="none">
                <Text style={styles.replyPreviewTitle} numberOfLines={1}>
                  {replyTargetLabel(replyTo, profiles)}에게 답장
                </Text>
                <Text style={styles.replyPreviewBody} numberOfLines={1}>
                  {replyPreviewText(replyTo)}
                </Text>
              </View>
              {replyTo.kind === 'image' && replyTo.imageUrl?.trim() ? (
                <View style={styles.replyPreviewThumbOuter} pointerEvents="none" accessibilityElementsHidden>
                  <Image source={{ uri: replyTo.imageUrl.trim() }} style={styles.replyPreviewThumb} contentFit="cover" />
                </View>
              ) : null}
              <Pressable
                onPress={() => setReplyTo(null)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="답장 취소">
                <GinitSymbolicIcon name="close" size={18} color="#475569" />
              </Pressable>
            </BlurView>
          </View>
        ) : null}
        <View
          style={styles.composerCluster}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (h > 0) setComposerInputBarHeight(h);
          }}>
          <View style={styles.composer}>
            {onPressAttach ? (
              <Pressable
                onPress={onPressAttach}
                style={({ pressed }) => [styles.plusBtn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="사진 첨부">
                <View style={styles.plusBtnIconSlot}>
                  <GinitSymbolicIcon name="add" size={26} color="#475569" />
                </View>
              </Pressable>
            ) : null}
            <View style={styles.inputShell}>
              <TextInput
                ref={messageInputRef}
                style={styles.input}
                placeholder="메시지 보내기"
                placeholderTextColor="#94a3b8"
                value={draft}
                onChangeText={setDraft}
                multiline
                submitBehavior="submit"
                blurOnSubmit={false}
                returnKeyType="send"
                onSubmitEditing={() => {
                  if (sending) return;
                  if (!draft.trim()) return;
                  void onSend();
                }}
                maxLength={4000}
              />
            </View>
            <Pressable
              onPress={() => void onSend()}
              style={[styles.sendBtn, sending && styles.sendBtnDisabled]}
              disabled={sending || !draft.trim()}
              accessibilityRole="button"
              accessibilityLabel="보내기">
              {sending ? (
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
