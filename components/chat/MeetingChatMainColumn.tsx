import { Ionicons } from '@expo/vector-icons';
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
import {
  ActivityIndicator,
  Animated,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAwareFlatList } from 'react-native-keyboard-aware-scroll-view';

import { meetingChatBodyStyles as styles } from '@/components/chat/meeting-chat-body-styles';
import {
  MeetingChatQuickActionRow,
  type MeetingChatQuickActionDef,
} from '@/components/chat/meeting-chat-quick-action-row';
import { replyPreviewText, replyTargetLabel } from '@/components/chat/meeting-chat-ui-helpers';
import { GinitTheme } from '@/constants/ginit-theme';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import type { UserProfile } from '@/src/lib/user-profile';

export type MeetingChatMainColumnProps = {
  chatError: string | null;
  searchNavigateLoading: boolean;
  setListRef: (r: unknown) => void;
  setInnerFlatListRef: (r: unknown) => void;
  messages: MeetingChatMessage[];
  renderItem: ListRenderItem<MeetingChatMessage>;
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
  plusMenuOpen: boolean;
  composerDockBlockHeight: number;
  jumpToLatest: () => void;
  closePlusMenuThen: (after?: () => void) => void;
  plusQuickActions: MeetingChatQuickActionDef[];
  plusRowAnims: Animated.Value[];
  plusPillMaxWidth: number;
  composerBottomPad: number;
  onComposerDockLayout: (e: LayoutChangeEvent) => void;
  replyTo: MeetingChatMessage['replyTo'];
  setReplyTo: (v: MeetingChatMessage['replyTo']) => void;
  profiles: Map<string, UserProfile>;
  setComposerInputBarHeight: (h: number) => void;
  messageInputRef: RefObject<TextInput | null>;
  draft: string;
  setDraft: (t: string) => void;
  uploadingImage: boolean;
  sending: boolean;
  onSend: () => void;
  openPlusMenu: () => void;
  plusIconMorph: Animated.Value;
};

export function MeetingChatMainColumn({
  chatError,
  searchNavigateLoading,
  setListRef,
  setInnerFlatListRef,
  messages,
  renderItem,
  chatListContentStyle,
  onScrollToIndexFailed,
  onChatScroll,
  listFooterLoading,
  hasNextPage,
  isFetchingNextPage,
  onPrefetchOlderMessages,
  showJumpToBottomFab,
  plusMenuOpen,
  composerDockBlockHeight,
  jumpToLatest,
  closePlusMenuThen,
  plusQuickActions,
  plusRowAnims,
  plusPillMaxWidth,
  composerBottomPad,
  onComposerDockLayout,
  replyTo,
  setReplyTo,
  profiles,
  setComposerInputBarHeight,
  messageInputRef,
  draft,
  setDraft,
  uploadingImage,
  sending,
  onSend,
  openPlusMenu,
  plusIconMorph,
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
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={chatListContentStyle}
            inverted
            onScroll={onChatScroll}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            enableOnAndroid
            extraScrollHeight={12}
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
        {showJumpToBottomFab && !plusMenuOpen ? (
          <Pressable
            style={[styles.jumpFab, { bottom: 12 + composerDockBlockHeight }]}
            onPress={jumpToLatest}
            accessibilityRole="button"
            accessibilityLabel="최신 메시지로">
            <Ionicons name="chevron-down" size={22} color="#334155" />
          </Pressable>
        ) : null}
      </View>
      {plusMenuOpen ? (
        <Pressable
          style={[styles.plusListDismissLayer, { bottom: composerDockBlockHeight }]}
          onPress={() => closePlusMenuThen()}
          accessibilityRole="button"
          accessibilityLabel="퀵 메뉴 닫기"
        />
      ) : null}
      {plusMenuOpen ? (
        <View style={[styles.plusFanFloating, { bottom: composerDockBlockHeight }]} pointerEvents="box-none">
          <View style={styles.plusFanInner} pointerEvents="box-none">
            {plusQuickActions.map((action, i) => (
              <MeetingChatQuickActionRow
                key={action.key}
                action={action}
                progress={plusRowAnims[i]!}
                pillMaxW={plusPillMaxWidth}
              />
            ))}
          </View>
        </View>
      ) : null}
      <View style={[styles.composerDock, { paddingBottom: composerBottomPad }]} onLayout={onComposerDockLayout}>
        {replyTo?.messageId ? (
          <View style={styles.replyPreviewRow}>
            <BlurView tint="light" intensity={55} style={styles.replyPreviewCard}>
              <View style={styles.replyPreviewIconWrap} accessibilityElementsHidden pointerEvents="none">
                <Ionicons name="return-up-back-outline" size={20} color="#0f172a" />
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
                <Ionicons name="close" size={18} color="#475569" />
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
            <Pressable
              style={styles.plusBtn}
              onPress={openPlusMenu}
              disabled={uploadingImage}
              accessibilityRole="button"
              accessibilityLabel={plusMenuOpen ? '퀵 액션 닫기' : '퀵 액션 열기'}
              accessibilityState={{ expanded: plusMenuOpen }}>
              {uploadingImage ? (
                <ActivityIndicator size="small" color="#475569" />
              ) : (
                <View style={styles.plusBtnIconSlot} pointerEvents="none">
                  <Animated.View
                    style={[
                      styles.plusBtnIconLayer,
                      {
                        opacity: plusIconMorph.interpolate({
                          inputRange: [0, 0.42],
                          outputRange: [1, 0],
                          extrapolate: 'clamp',
                        }),
                        transform: [
                          {
                            scale: plusIconMorph.interpolate({
                              inputRange: [0, 1],
                              outputRange: [1, 0.45],
                            }),
                          },
                          {
                            rotate: plusIconMorph.interpolate({
                              inputRange: [0, 1],
                              outputRange: ['0deg', '45deg'],
                            }),
                          },
                        ],
                      },
                    ]}>
                    <Ionicons name="add-sharp" size={26} color="#475569" />
                  </Animated.View>
                  <Animated.View
                    style={[
                      styles.plusBtnIconLayer,
                      {
                        opacity: plusIconMorph.interpolate({
                          inputRange: [0.38, 1],
                          outputRange: [0, 1],
                          extrapolate: 'clamp',
                        }),
                        transform: [
                          {
                            scale: plusIconMorph.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0.45, 1],
                            }),
                          },
                          {
                            rotate: plusIconMorph.interpolate({
                              inputRange: [0, 1],
                              outputRange: ['-45deg', '0deg'],
                            }),
                          },
                        ],
                      },
                    ]}>
                    <Ionicons name="close-sharp" size={26} color="#475569" />
                  </Animated.View>
                </View>
              )}
            </Pressable>
            <View style={styles.inputShell}>
              <TextInput
                ref={messageInputRef}
                style={styles.input}
                placeholder="메시지 보내기"
                placeholderTextColor="#94a3b8"
                value={draft}
                onChangeText={setDraft}
                multiline
                maxLength={4000}
                editable={!uploadingImage}
              />
            </View>
            <Pressable
              onPress={() => void onSend()}
              style={[styles.sendBtn, (sending || uploadingImage) && styles.sendBtnDisabled]}
              disabled={sending || uploadingImage || !draft.trim()}
              accessibilityRole="button"
              accessibilityLabel="보내기">
              {sending || uploadingImage ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="send" size={20} color="#fff" />
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}
