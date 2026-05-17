import { GinitPressable } from '@/components/ui/GinitPressable';
import { Image } from 'expo-image';
import { memo, useMemo, useState } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';

import { meetingChatBodyStyles as styles } from '@/components/chat/meeting-chat-body-styles';
import { normalizeLinkPreviewImageUrl } from '@/src/lib/chat-link-preview-normalize';
import { openChatLinkInBrowser } from '@/src/lib/chat-text-linkify';
import type { MeetingChatLinkPreview } from '@/src/lib/meeting-chat';

const PREVIEW_IMAGE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; GinitChatPreview/1.0)',
  Accept: 'image/*,*/*;q=0.8',
};

export type MeetingChatLinkPreviewCardProps = {
  preview: MeetingChatLinkPreview;
  mine: boolean;
  fullWidth?: boolean;
  /** 말풍선 최대 폭(px). `alignItems:flex-end` 래퍼 안에서 `width:'100%'`가 0이 되는 문제 방지 */
  layoutWidth?: number;
  /** 사용자가 입력한 원문 링크 텍스트(표시용) */
  rawUrlText?: string;
  /** 링크-only 메시지 등: 외곽 marginTop 제거 */
  standalone?: boolean;
};

function MeetingChatLinkPreviewCardInner({
  preview,
  mine,
  fullWidth = false,
  layoutWidth,
  rawUrlText: _rawUrlText,
  standalone = false,
}: MeetingChatLinkPreviewCardProps) {
  const { width: windowWidth } = useWindowDimensions();
  const [imageFailed, setImageFailed] = useState(false);

  const url = preview.url?.trim();
  if (!url) return null;

  const cardWidth = useMemo(() => {
    if (typeof layoutWidth === 'number' && layoutWidth > 0) return Math.floor(layoutWidth);
    if (fullWidth) {
      const inner = Math.max(0, windowWidth - 24);
      return Math.max(200, Math.floor(inner * 0.78));
    }
    const inner = Math.max(0, windowWidth - 24);
    return Math.max(200, Math.floor(inner * 0.78));
  }, [fullWidth, layoutWidth, windowWidth]);

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
  const img = normalizeLinkPreviewImageUrl(preview.imageUrl);
  const showThumb = Boolean(img) && !imageFailed;

  return (
    <GinitPressable
      onPress={() => void openChatLinkInBrowser(url)}
      accessibilityRole="link"
      accessibilityLabel={title ? `${title}, 링크 열기` : '링크 열기'}
      style={({ pressed }) => [
        styles.linkPreviewPressable,
        { width: cardWidth, maxWidth: cardWidth },
        standalone && styles.linkPreviewPressableStandalone,
        fullWidth && styles.linkPreviewPressableFull,
        mine && styles.linkPreviewPressableMine,
        pressed && styles.pressed,
      ]}>
      {showThumb ? (
        <Image
          source={{ uri: img!, headers: PREVIEW_IMAGE_HEADERS }}
          style={[styles.linkPreviewThumb, { width: cardWidth }]}
          contentFit="cover"
          contentPosition="center"
          cachePolicy="disk"
          recyclingKey={img!}
          accessibilityIgnoresInvertColors
          onError={() => setImageFailed(true)}
        />
      ) : (
        <View style={[styles.linkPreviewThumb, styles.linkPreviewThumbPlaceholder, { width: cardWidth }]} />
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
      </View>
    </GinitPressable>
  );
}

export const MeetingChatLinkPreviewCard = memo(MeetingChatLinkPreviewCardInner);
