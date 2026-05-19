import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

type Point = { x: number; y: number };

function sampleQuadraticBezier(p0: Point, p1: Point, p2: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

type Props = {
  start: Point;
  control: Point;
  end: Point;
  progress: SharedValue<number>;
  color: string;
  segments?: number;
};

export function OnboardingBezierArc({
  start,
  control,
  end,
  progress,
  color,
  segments = 32,
}: Props) {
  const points = useMemo(() => {
    const pts: Point[] = [];
    for (let i = 0; i <= segments; i++) {
      pts.push(sampleQuadraticBezier(start, control, end, i / segments));
    }
    return pts;
  }, [start, control, end, segments]);

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
          <ArcSegment
            key={i}
            x={a.x}
            y={a.y}
            length={length}
            angleDeg={angleDeg}
            index={i}
            segments={segments}
            progress={progress}
            color={color}
          />
        );
      })}
    </>
  );
}

function ArcSegment({
  x,
  y,
  length,
  angleDeg,
  index,
  segments,
  progress,
  color,
}: {
  x: number;
  y: number;
  length: number;
  angleDeg: number;
  index: number;
  segments: number;
  progress: SharedValue<number>;
  color: string;
}) {
  const style = useAnimatedStyle(() => {
    const threshold = (index + 1) / segments;
    const on = progress.value >= threshold - 0.5 / segments;
    return { opacity: on ? 0.88 : 0 };
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
    height: 2.5,
    borderRadius: 2,
    transformOrigin: 'left center',
  },
});
