import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';

let currentChatRoomId: string | null = null;

export function setCurrentChatRoomId(roomId: string | null | undefined): void {
  const v = typeof roomId === 'string' ? roomId.trim() : '';
  const next = v ? v : null;
  if (next !== currentChatRoomId) {
    ginitNotifyDbg('current-chat-room', 'set', { roomId: next, prev: currentChatRoomId });
  }
  currentChatRoomId = next;
}

export function getCurrentChatRoomId(): string | null {
  return currentChatRoomId;
}

