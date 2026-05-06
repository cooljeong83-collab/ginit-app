import type { ReactNode } from 'react';
import { Image } from 'expo-image';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { meetingChatBodyStyles as styles } from '@/components/chat/meeting-chat-body-styles';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';

const CLUSTER_W = 240;
/** 셀 사이 여백 없이 한 장처럼 보이게 */
const GAP = 0;

function imageMsgs(messages: MeetingChatMessage[]): MeetingChatMessage[] {
  return messages.filter((m) => m.kind === 'image' && m.imageUrl?.trim());
}

function Cell({
  msg,
  onPress,
  style,
  overlay,
  imageContentFit,
}: {
  msg: MeetingChatMessage;
  onPress: (m: MeetingChatMessage) => void;
  style: StyleProp<ViewStyle>;
  overlay?: ReactNode;
  /** 묶음(콜라주)은 말풍선 영역을 가득 채우도록 cover, 단일 장은 비율 유지 contain */
  imageContentFit: 'contain' | 'cover';
}) {
  const u = msg.imageUrl?.trim() ?? '';
  return (
    <Pressable
      onPress={() => onPress(msg)}
      style={({ pressed }) => [styles.kakaoCellInner, style, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel="사진 크게 보기">
      {u ? <Image source={{ uri: u }} style={styles.kakaoCellImage} contentFit={imageContentFit} /> : null}
      {overlay}
    </Pressable>
  );
}

/**
 * 카카오톡 스타일: 단일은 비율 유지(contain), 다장은 한 덩어리 콜라주.
 */
export function MeetingChatKakaoImageCluster({
  messages,
  onPressImage,
  alignEnd,
}: {
  messages: MeetingChatMessage[];
  onPressImage: (m: MeetingChatMessage) => void;
  alignEnd?: boolean;
}) {
  const imgs = imageMsgs(messages);
  const n = imgs.length;
  if (n === 0) return null;

  const fitSingle: 'contain' | 'cover' = 'contain';
  const fitCollage: 'contain' | 'cover' = 'cover';

  const outer: StyleProp<ViewStyle> = [
    styles.kakaoClusterOuter,
    { width: CLUSTER_W, alignSelf: alignEnd ? 'flex-end' : 'flex-start' },
  ];

  if (n === 1) {
    const m = imgs[0]!;
    return (
      <View style={outer}>
        <Cell msg={m} onPress={onPressImage} style={styles.kakaoSingleCell} imageContentFit={fitSingle} />
      </View>
    );
  }

  if (n === 2) {
    const h = CLUSTER_W / 2;
    const wCell = CLUSTER_W / 2;
    return (
      <View style={outer}>
        <View style={[styles.kakaoRow, { gap: GAP }]}>
          <Cell
            msg={imgs[0]!}
            onPress={onPressImage}
            style={{ width: wCell, height: h }}
            imageContentFit={fitCollage}
          />
          <Cell
            msg={imgs[1]!}
            onPress={onPressImage}
            style={{ width: wCell, height: h }}
            imageContentFit={fitCollage}
          />
        </View>
      </View>
    );
  }

  if (n === 3) {
    return (
      <View style={outer}>
        <View style={[styles.kakaoRow, { width: CLUSTER_W, height: CLUSTER_W, gap: GAP }]}>
          <Cell
            msg={imgs[0]!}
            onPress={onPressImage}
            style={{ flex: 2, minWidth: 0, minHeight: 0 }}
            imageContentFit={fitCollage}
          />
          <View style={[styles.kakaoCol, { flex: 1, gap: GAP }]}>
            <Cell msg={imgs[1]!} onPress={onPressImage} style={{ flex: 1, minHeight: 0 }} imageContentFit={fitCollage} />
            <Cell msg={imgs[2]!} onPress={onPressImage} style={{ flex: 1, minHeight: 0 }} imageContentFit={fitCollage} />
          </View>
        </View>
      </View>
    );
  }

  const cell = CLUSTER_W / 2;

  if (n === 4) {
    return (
      <View style={outer}>
        <View style={[styles.kakaoGrid4, { width: CLUSTER_W, height: CLUSTER_W, gap: GAP }]}>
          {imgs.map((m) => (
            <Cell key={m.id} msg={m} onPress={onPressImage} style={{ width: cell, height: cell }} imageContentFit={fitCollage} />
          ))}
        </View>
      </View>
    );
  }

  const extra = n - 4;
  return (
    <View style={outer}>
      <View style={[styles.kakaoGrid4, { width: CLUSTER_W, height: CLUSTER_W, gap: GAP }]}>
        {imgs.slice(0, 3).map((m) => (
          <Cell key={m.id} msg={m} onPress={onPressImage} style={{ width: cell, height: cell }} imageContentFit={fitCollage} />
        ))}
        <Cell
          msg={imgs[3]!}
          onPress={onPressImage}
          style={{ width: cell, height: cell }}
          imageContentFit={fitCollage}
          overlay={
            extra > 0 ? (
              <View style={styles.kakaoMoreOverlay} pointerEvents="none">
                <Text style={styles.kakaoMoreText}>+{extra}</Text>
              </View>
            ) : null
          }
        />
      </View>
    </View>
  );
}
