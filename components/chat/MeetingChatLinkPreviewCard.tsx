import { GinitPressable } from '@/components/ui/GinitPressable';
import {Image } from 'expo-image';
import { Text, View } from 'react-native'

import { meetingChatBodyStyles as styles } from '@/components/chat/meeting-chat-body-styles';
import { openChatLinkInBrowser } from '@/src/lib/chat-text-linkify';
import type { MeetingChatLinkPreview } from '@/src/lib/meeting-chat';

export function MeetingChatLinkPreviewCard({
  preview,
  mine,
  fullWidth = false,
  rawUrlText,
  standalone = false,
}: {
  preview: MeetingChatLinkPreview;
  mine: boolean;
  fullWidth?: boolean;
  /** 사용자가 입력한 원문 링크 텍스트(표시용) */
  rawUrlText?: string;
  /** 링크-only 메시지 등: 외곽 marginTop 제거 */
  standalone?: boolean;
}) {
  const url = preview.url?.trim();
  if (!url) return null;

  const site =
    (preview.siteName?.trim() ||
      (() => {
        try {
          return new URL(url).hostname.replace(/^www\./, '');
        } catch {
          return '';
        }
      })()) ||
    '';

  const title = preview.title?.trim();
  const desc = preview.description?.trim();
  const img = preview.imageUrl?.trim();
  const raw = typeof rawUrlText === 'string' ? rawUrlText.trim() : '';

  if (__DEV__ && (!img || !title)) {
    // eslint-disable-next-line no-console
    console.log('[chat:link-preview] render', { url, img, title, site });
  }

  return (
    <GinitPressable
      onPress={() => void openChatLinkInBrowser(url)}
      accessibilityRole="link"
      accessibilityLabel={title ? `${title}, 링크 열기` : '링크 열기'}
      style={({ pressed }) => [
        styles.linkPreviewPressable,
        standalone && styles.linkPreviewPressableStandalone,
        fullWidth && styles.linkPreviewPressableFull,
        mine && styles.linkPreviewPressableMine,
        pressed && styles.pressed,
      ]}>
      {img ? (
        <Image
          source={{ uri: img }}
          style={styles.linkPreviewThumb}
          contentFit="cover"
          contentPosition="center"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={styles.linkPreviewThumb} />
      )}
      <View style={styles.linkPreviewBody}>
        {site ? (
          <Text style={styles.linkPreviewSite} numberOfLines={1}>
            {site}
          </Text>
        ) : null}
        {title ? (
          <Text style={styles.linkPreviewTitle} numberOfLines={2}>
            {title}
          </Text>
        ) : (
          <Text style={styles.linkPreviewTitle} numberOfLines={1}>
            {url}
          </Text>
        )}
        {desc ? (
          <Text style={styles.linkPreviewDesc} numberOfLines={2}>
            {desc}
          </Text>
        ) : null}
        {/*
          요청: 프리뷰 하단에 사용자가 입력한 원문 URL은 표시하지 않음.
          (카드 전체 탭으로 링크는 열 수 있음)
        */}
      </View>
    </GinitPressable>
  );
}
