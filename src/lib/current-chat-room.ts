let currentChatRoomId: string | null = null;

export function setCurrentChatRoomId(roomId: string | null | undefined): void {
  const v = typeof roomId === 'string' ? roomId.trim() : '';
  currentChatRoomId = v ? v : null;
}

export function getCurrentChatRoomId(): string | null {
  return currentChatRoomId;
}

