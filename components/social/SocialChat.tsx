import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import type { Timestamp } from 'firebase/firestore';
import { useMemo, useRef } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassInput } from '@/components/social/GlassInput';
import { NeonBadge } from '@/components/social/NeonBadge';
import { GinitTheme } from '@/constants/ginit-theme';
import type { SocialChatMessage } from '@/src/lib/social-chat-rooms';
import { normalizeParticipantId } from '@/src/lib/app-user-id';

function formatShortTime(ts: Timestamp | null | undefined): string {
  if (!ts || typeof ts.toDate !== 'function') return '';
  try {
    return ts.toDate().toLocaleString('ko-KR', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch {
    return '';
  }
}

export type SocialChatProps = {
  title: string;
  /** 모임 채팅 상단 확정 바와 동일 역할 — 약속·공통 취향 한 줄 */
  noticeLine: string;
  messages: SocialChatMessage[];
  myUserId: string;
  draft: string;
  onChangeDraft: (t: string) => void;
  onSend: () => void;
  sending?: boolean;
  onPressNotice?: () => void;
};

/**
 * 1:1 소셜 스레드 UI — 공지 바·말풍선(Trust Blue / 화이트 글래스)·`GlassInput` composer.
 */
export function SocialChat({
  title,
  noticeLine,
  messages,
  myUserId,
  draft,
  onChangeDraft,
  onSend,
  sending,
  onPressNotice,
}: SocialChatProps) {
  const listRef = useRef<FlatList<SocialChatMessage>>(null);
  const myNorm = useMemo(() => (myUserId.trim() ? normalizeParticipantId(myUserId.trim()) ?? myUserId.trim() : ''), [myUserId]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
        {noticeLine.trim() ? (
          <Pressable
            onPress={onPressNotice}
            style={styles.announcementBar}
            accessibilityRole="button"
            accessibilityLabel="공지">
            <BlurView tint="light" intensity={60} style={styles.announcementInner}>
              <Ionicons name="megaphone-outline" size={16} color="#0052CC" />
              <Text style={styles.announcementText} numberOfLines={1}>
                {noticeLine}
              </Text>
              <Ionicons name="chevron-forward" size={16} color="#64748b" />
            </BlurView>
          </Pressable>
        ) : null}

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
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

        <View style={styles.composerMeta} accessibilityElementsHidden>
          <NeonBadge label="Social · 1:1" pulse={false} />
        </View>
        <View style={styles.composer}>
          <GlassInput
            value={draft}
            onChangeText={onChangeDraft}
            placeholder="메시지 보내기"
            multiline
            dense
            style={styles.composerInput}
          />
          <Pressable
            onPress={onSend}
            disabled={sending || !draft.trim()}
            style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnDisabled]}
            accessibilityRole="button"
            accessibilityLabel="보내기">
            <Ionicons name="send" size={20} color="#fff" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ECEFF1' },
  flex: { flex: 1 },
  threadTitle: {
    fontSize: 13,
    fontWeight: '800',
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
    fontWeight: '900',
    color: '#0f172a',
  },
  listContent: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    flexGrow: 1,
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
  /** 모임 상세 공지 칩 + 채팅 mine 톤 결합 — Trust Blue 글래스 */
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
});
