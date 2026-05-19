import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, type TextStyle, View, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { GinitTheme } from '@/constants/ginit-theme';
import {
  feedReviewCommentRotationHoldMs,
  FEED_REVIEW_COMMENT_FADE_MS,
  formatFeedReviewCommentDisplay,
  shouldRotateCommentsWithFade,
} from '@/src/lib/feed-meeting-review-comment-marquee.logic';

type FeedMeetingReviewCommentMarqueeProps = {
  comments: readonly string[];
  laneStyle?: ViewStyle;
  textStyle?: TextStyle;
  emptyLabel?: string;
};

type EllipsisCommentLineProps = {
  displayText: string;
  textStyles: TextStyle[];
  laneStyles: ViewStyle[];
};

function EllipsisCommentLine({ displayText, textStyles, laneStyles }: EllipsisCommentLineProps) {
  if (!displayText) return null;

  return (
    <View style={laneStyles}>
      <Text
        style={[...textStyles, styles.ellipsisText]}
        numberOfLines={1}
        ellipsizeMode="tail">
        {displayText}
      </Text>
    </View>
  );
}

type FadingCommentRotatorProps = {
  comments: readonly string[];
  textStyles: TextStyle[];
  laneStyles: ViewStyle[];
};

function FadingCommentRotator({ comments, textStyles, laneStyles }: FadingCommentRotatorProps) {
  const [index, setIndex] = useState(0);
  const opacity = useSharedValue(1);

  const count = comments.length;
  const safeIndex = count > 0 ? index % count : 0;
  const displayText = formatFeedReviewCommentDisplay(comments[safeIndex] ?? '');

  const commentsKey = comments.join('\u0001');

  useEffect(() => {
    setIndex(0);
    opacity.value = 1;
  }, [commentsKey, opacity]);

  useEffect(() => {
    if (count <= 1) return;

    let cancelled = false;
    let holdTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const runHoldThenFade = (idx: number) => {
      if (cancelled) return;
      const text = formatFeedReviewCommentDisplay(comments[idx % count] ?? '');
      if (!text) return;

      holdTimeoutId = setTimeout(() => {
        if (cancelled) return;
        opacity.value = withTiming(0, { duration: FEED_REVIEW_COMMENT_FADE_MS }, (finished) => {
          if (!finished || cancelled) return;
          const nextIdx = (idx + 1) % count;
          runOnJS(setIndex)(nextIdx);
          opacity.value = withTiming(1, { duration: FEED_REVIEW_COMMENT_FADE_MS }, (fadeInDone) => {
            if (!fadeInDone || cancelled) return;
            runOnJS(runHoldThenFade)(nextIdx);
          });
        });
      }, feedReviewCommentRotationHoldMs(text));
    };

    runHoldThenFade(0);

    return () => {
      cancelled = true;
      if (holdTimeoutId != null) clearTimeout(holdTimeoutId);
      cancelAnimation(opacity);
      opacity.value = 1;
    };
  }, [comments, commentsKey, count, opacity]);

  const fadeStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  if (!displayText) return null;

  return (
    <Animated.View style={[fadeStyle, styles.fadeWrap]}>
      <EllipsisCommentLine
        displayText={displayText}
        textStyles={textStyles}
        laneStyles={laneStyles}
      />
    </Animated.View>
  );
}

export function FeedMeetingReviewCommentMarquee({
  comments,
  laneStyle,
  textStyle,
  emptyLabel = '생생한 후기가 쌓이고 있어요',
}: FeedMeetingReviewCommentMarqueeProps) {
  const trimmedComments = useMemo(
    () => comments.map((c) => c.trim()).filter(Boolean),
    [comments],
  );

  const useFadeRotation = shouldRotateCommentsWithFade(trimmedComments.length);
  const singleDisplayText = formatFeedReviewCommentDisplay(trimmedComments[0] ?? '');

  const textStyles = [styles.text, textStyle];
  const laneStyles = [styles.lane, laneStyle];

  if (trimmedComments.length === 0) {
    return (
      <View style={laneStyles}>
        <Text style={textStyles} numberOfLines={1} ellipsizeMode="tail">
          {emptyLabel}
        </Text>
      </View>
    );
  }

  return (
    <View style={laneStyles} collapsable={false}>
      {useFadeRotation ? (
        <FadingCommentRotator
          comments={trimmedComments}
          textStyles={textStyles}
          laneStyles={[styles.innerLane]}
        />
      ) : (
        <EllipsisCommentLine
          displayText={singleDisplayText}
          textStyles={textStyles}
          laneStyles={[styles.innerLane]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  lane: {
    height: 30,
    overflow: 'hidden',
    justifyContent: 'center',
    paddingHorizontal: 0,
  },
  innerLane: {
    overflow: 'hidden',
    justifyContent: 'center',
    width: '100%',
    minWidth: 0,
  },
  fadeWrap: {
    width: '100%',
    minWidth: 0,
  },
  ellipsisText: {
    flexShrink: 1,
    minWidth: 0,
    width: '100%',
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.textSub,
    lineHeight: 16,
  },
});
