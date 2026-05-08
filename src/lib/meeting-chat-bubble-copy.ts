import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Alert, Platform, ToastAndroid } from 'react-native';

import type { MeetingChatListRow } from '@/src/lib/meeting-chat-list-rows';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';

function lineForCopy(m: MeetingChatMessage): string {
  if (m.kind === 'system') return (m.text ?? '').trim();
  if (m.kind === 'image') {
    const cap = (m.text ?? '').trim();
    const url = (m.imageUrl ?? '').trim();
    if (cap && url) return `${cap}\n${url}`;
    if (cap) return cap;
    if (url) return url;
    return '';
  }
  return (m.text ?? '').trim();
}

/** 답장 인용 줄 없이 본문만(텍스트·캡션·이미지 URL). */
export function copyTextForMeetingChatListRow(row: MeetingChatListRow): string {
  if (row.type === 'message') {
    return lineForCopy(row.message);
  }
  return row.messages.map(lineForCopy).filter(Boolean).join('\n');
}

export async function copyMeetingChatListRowToClipboard(row: MeetingChatListRow): Promise<void> {
  const text = copyTextForMeetingChatListRow(row).trim();
  const notifyEmpty = () => {
    if (Platform.OS === 'android') ToastAndroid.show('복사할 내용이 없어요.', ToastAndroid.SHORT);
    else Alert.alert('복사', '복사할 내용이 없어요.');
  };
  if (!text) {
    notifyEmpty();
    return;
  }
  try {
    await Clipboard.setStringAsync(text);
    if (Platform.OS === 'android') {
      ToastAndroid.show('클립보드에 복사했어요.', ToastAndroid.SHORT);
    } else if (Platform.OS === 'ios') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  } catch {
    Alert.alert('복사', '클립보드에 복사하지 못했어요.');
  }
}
