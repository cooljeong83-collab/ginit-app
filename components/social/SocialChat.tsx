import type { RefObject } from 'react';
import { FlatList } from 'react-native';

import { UnifiedChatBody } from '@/components/chat/UnifiedChatBody';
import type { SocialChatMessage } from '@/src/lib/social-chat-rooms';

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
  /** 검색 결과 탭 시 특정 메시지로 스크롤하기 위한 외부 ref(선택) */
  listRef?: RefObject<FlatList<SocialChatMessage> | null>;
};

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
  listRef: externalListRef,
}: SocialChatProps) {
  return (
    <UnifiedChatBody
      title={title}
      noticeLine={noticeLine}
      messages={messages}
      myUserId={myUserId}
      draft={draft}
      onChangeDraft={onChangeDraft}
      onSend={onSend}
      sending={sending}
      onPressNotice={onPressNotice}
      listRef={externalListRef}
    />
  );
}
