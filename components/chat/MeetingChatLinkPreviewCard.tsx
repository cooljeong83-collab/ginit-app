import { GinitPressable } from '@/components/ui/GinitPressable';
import {Image } from 'expo-image';
import { memo } from 'react';
import { Text, View } from 'react-native';

import { meetingChatBodyStyles as styles } from '@/components/chat/meeting-chat-body-styles';
import { openChatLinkInBrowser } from '@/src/lib/chat-text-linkify';
import type { MeetingChatLinkPreview } from '@/src/lib/meeting-chat';

export type MeetingChatLinkPreviewCardProps = {
  preview: MeetingChatLinkPreview;
  mine: boolean;
  fullWidth?: boolean;
  /** 사용자가 입력한 원문 링크 텍스트(표시용) */
  rawUrlText?: string;
  /** 링크-only 메시지 등: 외곽 marginTop 제거 */
  standalone?: boolean;
};

function MeetingChatLinkPreviewCardInner({
  preview,
  mine,
  fullWidth = false,
  rawUrlText: _rawUrlText,
  standalone = false,
}: MeetingChatLinkPreviewCardProps) {
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
          cachePolicy="disk"
          recyclingKey={img}
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

/** 상위(입력 `draft` 등) 리렌더 시 메시지 행의 프리뷰 props가 같으면 다시 그리지 않음 */
export const MeetingChatLinkPreviewCard = memo(MeetingChatLinkPreviewCardInner);
