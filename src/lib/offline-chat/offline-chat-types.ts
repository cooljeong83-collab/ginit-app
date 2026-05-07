export type OfflineChatRoomType = 'meeting' | 'social_dm';

export type OfflineChatRoomKey = {
  roomType: OfflineChatRoomType;
  roomId: string;
};

export function normalizeRoomKey(key: OfflineChatRoomKey): OfflineChatRoomKey {
  return {
    roomType: key.roomType === 'social_dm' ? 'social_dm' : 'meeting',
    roomId: String(key.roomId ?? '').trim(),
  };
}

export function roomKeyToString(key: OfflineChatRoomKey): string {
  const k = normalizeRoomKey(key);
  return `${k.roomType}:${k.roomId}`;
}

