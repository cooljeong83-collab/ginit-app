import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

type Point = { x: number; y: number };

function sampleCircle(cx: number, cy: number, radius: number, segments: number, startAngle: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = startAngle + t * Math.PI * 2;
    pts.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  }
  return pts;
}

type Props = {
  cx: number;
  cy: number;
  radius: number;
  progress: SharedValue<number>;
  color: string;
  segments?: number;
  startAngle?: number;
  strokeWidth?: number;
};

export function OnboardingCircleRing({
  cx,
  cy,
  radius,
  progress,
  color,
  segments = 72,
  startAngle = -Math.PI / 2,
  strokeWidth = 2.5,
}: Props) {
  const points = useMemo(
    () => sampleCircle(cx, cy, radius, segments, startAngle),
    [cx, cy, radius, segments, startAngle],
  );

  return (
    <>
      {Array.from({ length: segments }, (_, i) => {
        const a = points[i]!;
        const b = points[i + 1]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.hypot(dx, dy) || 1;
        const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
        return (
          <RingSegment
            key={i}
            x={a.x}
            y={a.y}
            length={length}
            angleDeg={angleDeg}
            index={i}
            segments={segments}
            progress={progress}
            color={color}
            strokeWidth={strokeWidth}
          />
        );
      })}
    </>
  );
}

function RingSegment({
  x,
  y,
  length,
  angleDeg,
  index,
  segments,
  progress,
  color,
  strokeWidth,
}: {
  x: number;
  y: number;
  length: number;
  angleDeg: number;
  index: number;
  segments: number;
  progress: SharedValue<number>;
  color: string;
  strokeWidth: number;
}) {
  const style = useAnimatedStyle(() => {
    const threshold = (index + 1) / segments;
    const on = progress.value >= threshold - 0.5 / segments;
    return { opacity: on ? 0.75 : 0 };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.segment,
        {
          left: x,
          top: y,
          width: length,
          height: strokeWidth,
          backgroundColor: color,
          transform: [{ rotate: `${angleDeg}deg` }],
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  segment: {
    position: 'absolute',
    borderRadius: 2,
    transformOrigin: 'left center',
  },
});
