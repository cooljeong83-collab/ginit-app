import { useMemo } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';

import { HighlightedText } from '@/components/ui/HighlightedText';
import { openChatLinkInBrowser, splitChatTextIntoLinkSegments } from '@/src/lib/chat-text-linkify';

type Props = {
  text: string;
  /** 검색 하이라이트(모임/소셜 DM) — 링크가 아닌 구간만 적용 */
  highlightQuery?: string;
  style?: StyleProp<TextStyle>;
  highlightBackgroundColor?: string;
  highlightTextColor?: string;
  /** 링크 색(기본 브랜드 톤에 맞춘 파랑) */
  linkColor?: string;
};

export function LinkableChatText({
  text,
  highlightQuery = '',
  style,
  highlightBackgroundColor = '#4527A0',
  highlightTextColor = '#FFFFFF',
  linkColor = '#1565C0',
}: Props) {
  const segments = useMemo(() => splitChatTextIntoLinkSegments(String(text ?? '')), [text]);
  const q = String(highlightQuery ?? '').trim();

  const linkStyle = useMemo(
    () => ({
      color: linkColor,
      textDecorationLine: 'underline' as const,
    }),
    [linkColor],
  );

  if (segments.length === 1 && segments[0]!.kind === 'text' && !q) {
    return <Text style={style}>{segments[0]!.value}</Text>;
  }

  return (
    <Text style={style}>
      {segments.map((seg, i) => {
        if (seg.kind === 'link') {
          return (
            <Text
              key={i}
              style={[style, linkStyle]}
              accessibilityRole="link"
              onPress={() => void openChatLinkInBrowser(seg.href)}>
              {seg.value}
            </Text>
          );
        }
        if (!seg.value) return null;
        if (!q) {
          return (
            <Text key={i} style={style}>
              {seg.value}
            </Text>
          );
        }
        return (
          <HighlightedText
            key={i}
            text={seg.value}
            query={q}
            style={style}
            highlightBackgroundColor={highlightBackgroundColor}
            highlightTextColor={highlightTextColor}
          />
        );
      })}
    </Text>
  );
}
