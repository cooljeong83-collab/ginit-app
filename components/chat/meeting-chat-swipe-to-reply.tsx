import { type ReactNode, useCallback, useMemo, useRef } from 'react';
import { Animated } from 'react-native';
import { PanGestureHandler, type PanGestureHandlerGestureEvent, State } from 'react-native-gesture-handler';

export function MeetingChatSwipeToReply({
  children,
  onTriggerReply,
  simultaneousHandlers,
}: {
  children: ReactNode;
  onTriggerReply: () => void;
  simultaneousHandlers?: React.Ref<unknown> | unknown[] | unknown;
}) {
  const dragX = useRef(new Animated.Value(0)).current;
  const didTriggerRef = useRef(false);
  const triggerRef = useRef(onTriggerReply);
  triggerRef.current = onTriggerReply;

  const onGestureEvent = useMemo(
    () =>
      Animated.event<PanGestureHandlerGestureEvent>(
        [{ nativeEvent: { translationX: dragX } }],
        {
          useNativeDriver: true,
          listener: (e) => {
            const tx = (e as unknown as PanGestureHandlerGestureEvent).nativeEvent.translationX;
            if (typeof tx === 'number' && tx < -56 && !didTriggerRef.current) {
              didTriggerRef.current = true;
              triggerRef.current();
            }
          },
        },
      ),
    [dragX],
  );

  const reset = useCallback(() => {
    dragX.stopAnimation();
    Animated.spring(dragX, {
      toValue: 0,
      useNativeDriver: true,
      tension: 180,
      friction: 18,
    }).start();
  }, [dragX]);

  const onHandlerStateChange = useCallback(
    (e: PanGestureHandlerGestureEvent) => {
      const s = e.nativeEvent.state;

      if (s === State.BEGAN) {
        didTriggerRef.current = false;
      }

      if (s === State.END || s === State.CANCELLED || s === State.FAILED) {
        reset();
      }
    },
    [reset],
  );

  const translateX = useMemo(
    () =>
      dragX.interpolate({
        inputRange: [-140, 0, 140],
        outputRange: [-72, 0, 0],
        extrapolate: 'clamp',
      }),
    [dragX],
  );

  return (
    <PanGestureHandler
      activeOffsetX={[-18, 9999]}
      failOffsetY={[-6, 6]}
      simultaneousHandlers={simultaneousHandlers as never}
      onGestureEvent={onGestureEvent}
      onHandlerStateChange={onHandlerStateChange}
    >
      <Animated.View style={{ transform: [{ translateX }] }}>{children}</Animated.View>
    </PanGestureHandler>
  );
}
