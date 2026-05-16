import { useMutation } from '@tanstack/react-query';

import { clearChatReadOutbox, syncChatMarkReadToServer, type ChatMarkReadInput } from '@/src/lib/chat-mark-read';

export const chatMarkReadMutationKey = ['chat', 'mark-read'] as const;

/**
 * 읽음 서버 동기화만 담당합니다. 로컬 Watermelon 반영은 호출부에서 `markChatRoomReadLocally` 1회로 처리합니다
 * (onMutate와 중복 호출 시 `upsertLocalChatRoomSummary` 폭주 방지).
 */
export function useChatMarkReadMutation() {
  return useMutation({
    mutationKey: chatMarkReadMutationKey,
    mutationFn: async (input: ChatMarkReadInput) => {
      await syncChatMarkReadToServer(input);
    },
    onSuccess: async (_data, input) => {
      await clearChatReadOutbox(input.roomKind, input.roomId);
    },
    retry: 2,
    networkMode: 'always',
  });
}
