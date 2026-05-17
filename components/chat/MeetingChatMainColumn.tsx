import { GinitPressable } from '@/components/ui/GinitPressable';

import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import type { ReactNode, RefObject } from 'react';
import { memo } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, StyleProp, ViewStyle } from 'react-native';
import {ActivityIndicator, Text, TextInput, View} from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import { KeyboardStickyView } from 'react-native-keyboard-controller';

import { meetingChatBodyStyles as styles } from '@/components/chat/meeting-chat-body-styles';
import { replyPreviewText, replyTargetLabel } from '@/components/chat/meeting-chat-ui-helpers';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import type { MeetingChatListRow } from '@/src/lib/meeting-chat-list-rows';
import { meetingChatFlashListItemType } from '@/src/lib/meeting-chat-list-rows';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import type { UserProfile } from '@/src/lib/user-profile';

export type MeetingChatMainColumnProps = {
  chatError: string | null;
  /** transport 끊김 등 — 에러(빨강) 대신 재연결(보라) 배너 */
  chatReconnecting?: boolean;
  searchNavigateLoading: boolean;
  setListRef: (r: unknown) => void;
  setInnerFlashListRef: (r: unknown) => void;
  chatListRows: MeetingChatListRow[];
  renderItem: ListRenderItem<MeetingChatListRow>;
  chatListContentStyle: StyleProp<ViewStyle>;
  onChatScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onChatListContentSizeChange?: (width: number, height: number) => void;
  listFooterLoading: React.ReactElement | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onPrefetchOlderMessages?: () => void;
  showJumpToBottomFab: boolean;
  composerDockBlockHeight: number;
  /** 키보드가 올라온 높이(px). 리스트/FAB 위치 보정용 */
  keyboardHeight?: number;
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
  canSend?: boolean;
  onSend: () => void;
  onPressAttach?: () => void;
  /** 기본: multiline. 소셜 DM처럼 엔터 즉시 전송이 필요하면 false */
  inputMultiline?: boolean;
  /** 카카오처럼 검색 결과 탐색 UI를 하단 입력 영역에 붙일 때 사용 */
  bottomSearchNavigator?: ReactNode;
  /** 검색 모드에서는 입력 컴포저를 숨깁니다 */
  hideComposer?: boolean;
  /**
   * `data`(chatListRows)와 별도로 바뀌는 값 — 읽음 등으로 `renderItem`만 갱신돼야 할 때 FlashList가
   * 가시 행을 다시 그리도록 합니다.
   */
  listExtraData?: unknown;
};

export const MeetingChatMainColumn = memo(function MeetingChatMainColumn({
  chatError,
  chatReconnecting = false,
  searchNavigateLoading,
  setListRef,
  setInnerFlashListRef,
  chatListRows,
  renderItem,
  chatListContentStyle,
  onChatScroll,
  onChatListContentSizeChange,
  listFooterLoading,
  hasNextPage,
  isFetchingNextPage,
  onPrefetchOlderMessages,
  showJumpToBottomFab,
  composerDockBlockHeight,
  keyboardHeight,
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
  canSend = true,
  onSend,
  onPressAttach,
  inputMultiline = true,
  bottomSearchNavigator,
  hideComposer = false,
  listExtraData,
}: MeetingChatMainColumnProps) {
  const setBothRefs = (r: FlashListRef<MeetingChatListRow> | null) => {
    setListRef(r);
    setInnerFlashListRef(r);
  };
  const sendDisabled = !canSend || sending || !draft.trim();

  return (
    <View style={styles.chatMainColumn}>
      <View style={styles.listWrap}>
        {chatReconnecting ? (
          <View style={styles.chatReconnectBanner}>
            <Text style={styles.chatReconnectText}>실시간 연결을 다시 맞추는 중…</Text>
          </View>
        ) : chatError ? (
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
          <FlashList
            ref={setBothRefs as any}
            style={{ flex: 1, minHeight: 0 }}
            data={chatListRows}
            extraData={listExtraData}
            getItemType={(row) => meetingChatFlashListItemType(row)}
            keyExtractor={(row) => {
              if (row.type === 'message') return row.message.id;
              return `album:${row.batchId}:${row.messages.map((m: MeetingChatMessage) => m.id).join(':')}`;
            }}
            renderItem={renderItem}
            contentContainerStyle={chatListContentStyle}
            inverted
            onScroll={onChatScroll}
            onContentSizeChange={onChatListContentSizeChange}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text style={styles.emptyChat}>첫 메시지를 남겨 보세요.</Text>}
            ListFooterComponent={isFetchingNextPage ? listFooterLoading : null}
            onEndReached={hasNextPage ? onPrefetchOlderMessages : undefined}
            onEndReachedThreshold={0.55}
          />
        </View>
        {showJumpToBottomFab ? (
          <GinitPressable
            style={[styles.jumpFab, { bottom: 12 + composerDockBlockHeight + Math.max(0, keyboardHeight ?? 0) }]}
            onPress={jumpToLatest}
            accessibilityRole="button"
            accessibilityLabel="최신 메시지로">
            <GinitSymbolicIcon name="chevron-down" size={22} color="#334155" />
          </GinitPressable>
        ) : null}
      </View>
      <KeyboardStickyView style={styles.composerStickyWrap}>
        <View style={[styles.composerDock, { paddingBottom: composerBottomPad }]} onLayout={onComposerDockLayout}>
        {bottomSearchNavigator ? <View style={styles.bottomSearchNavigatorWrap}>{bottomSearchNavigator}</View> : null}
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
                  <Image
                    source={{ uri: replyTo.imageUrl.trim() }}
                    style={styles.replyPreviewThumb}
                    contentFit="cover"
                    cachePolicy="disk"
                    recyclingKey={replyTo.messageId ? `${replyTo.messageId}:${replyTo.imageUrl.trim()}` : replyTo.imageUrl.trim()}
                  />
                </View>
              ) : null}
              <GinitPressable
                onPress={() => setReplyTo(null)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="답장 취소">
                <GinitSymbolicIcon name="close" size={18} color="#475569" />
              </GinitPressable>
            </BlurView>
          </View>
        ) : null}
        {!hideComposer ? (
          <View
            style={styles.composerCluster}
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              if (h > 0) setComposerInputBarHeight(h);
            }}>
            <View style={styles.composer}>
              {onPressAttach ? (
                <GinitPressable
                  onPress={onPressAttach}
                  style={({ pressed }) => [styles.plusBtn, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="사진 첨부">
                  <View style={styles.plusBtnIconSlot}>
                    <GinitSymbolicIcon name="add" size={26} color="#475569" />
                  </View>
                </GinitPressable>
              ) : null}
              <View style={styles.inputShell}>
                <TextInput
                  ref={messageInputRef}
                  style={styles.input}
                  placeholder="메시지 보내기"
                  placeholderTextColor="#94a3b8"
                  value={draft}
                  onChangeText={setDraft}
                  multiline={inputMultiline}
                  submitBehavior={inputMultiline ? 'submit' : undefined}
                  blurOnSubmit={false}
                  returnKeyType="send"
                  onSubmitEditing={() => {
                    if (sendDisabled) return;
                    void onSend();
                  }}
                  maxLength={4000}
                />
              </View>
              <GinitPressable
                onPress={() => void onSend()}
                style={[styles.sendBtn, sendDisabled && styles.sendBtnDisabled]}
                disabled={sendDisabled}
                accessibilityRole="button"
                accessibilityLabel="보내기">
                {sending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <GinitSymbolicIcon name="send" size={20} color="#fff" />
                )}
              </GinitPressable>
            </View>
          </View>
        ) : null}
        </View>
      </KeyboardStickyView>
    </View>
  );
});
