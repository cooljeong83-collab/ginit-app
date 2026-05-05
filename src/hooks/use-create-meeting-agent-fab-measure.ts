import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Platform, type LayoutChangeEvent, type View } from 'react-native';

import type { WizardStep } from '@/components/create/meeting-create-wizard-types';

export type AgentFabWindowRect = { x: number; y: number; width: number; height: number };

/**
 * 에이전트 FAB `measureInWindow` 앵커·프로그램 스크롤 중 측정 억제 — `CreateDetailsScreen`에서 ref·콜백 분리.
 * `stepPositions`는 화면이 들고 있는 동일 ref를 넘겨 `captureStepPosition`·`onWizardStepShellLayout`이 동일 맵을 갱신.
 */
export function useCreateMeetingAgentFabMeasure(opts: {
  currentStepRef: RefObject<WizardStep>;
  mainScrollYRef: RefObject<number>;
  currentStep: WizardStep;
  stepPositions: RefObject<Partial<Record<WizardStep, number>>>;
}) {
  const { currentStepRef, mainScrollYRef, currentStep, stepPositions } = opts;

  const programmaticScrollPendingRef = useRef(false);
  const scrollSettleMeasureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollDismissLastNotifyMsRef = useRef(0);
  const scheduleAgentFabMeasureRef = useRef<() => void>(() => {});
  const armAgentFabScrollSettleMeasureRef = useRef<() => void>(() => {});
  const predictAgentFabWindowRectBeforeVerticalScrollRef = useRef(
    (_anchorStep: WizardStep, _targetScrollY: number, runScroll: () => void) => {
      runScroll();
    },
  );
  const agentStepShellRefs = useRef<Partial<Record<WizardStep, View | null>>>({});
  const [agentFabWindowRect, setAgentFabWindowRect] = useState<AgentFabWindowRect | null>(null);
  const agentFabMeasureRafRef = useRef<number | null>(null);

  const measureAgentFabAnchor = useCallback(() => {
    const cs = currentStepRef.current;
    if (cs === 1) {
      setAgentFabWindowRect(null);
      return;
    }
    const node = agentStepShellRefs.current[cs];
    if (!node) {
      setAgentFabWindowRect(null);
      return;
    }
    node.measureInWindow((x, y, w, h) => {
      setAgentFabWindowRect({ x, y, width: w, height: h });
    });
  }, [currentStepRef]);

  const scheduleAgentFabMeasure = useCallback(() => {
    if (agentFabMeasureRafRef.current != null) {
      cancelAnimationFrame(agentFabMeasureRafRef.current);
    }
    agentFabMeasureRafRef.current = requestAnimationFrame(() => {
      agentFabMeasureRafRef.current = null;
      measureAgentFabAnchor();
    });
  }, [measureAgentFabAnchor]);

  scheduleAgentFabMeasureRef.current = scheduleAgentFabMeasure;

  const armAgentFabScrollSettleMeasure = useCallback(() => {
    programmaticScrollPendingRef.current = true;
    if (scrollSettleMeasureTimerRef.current != null) {
      clearTimeout(scrollSettleMeasureTimerRef.current);
      scrollSettleMeasureTimerRef.current = null;
    }
    const settleMs = Platform.OS === 'android' ? 480 : 420;
    scrollSettleMeasureTimerRef.current = setTimeout(() => {
      scrollSettleMeasureTimerRef.current = null;
      programmaticScrollPendingRef.current = false;
      scheduleAgentFabMeasureRef.current();
    }, settleMs);
  }, []);

  armAgentFabScrollSettleMeasureRef.current = armAgentFabScrollSettleMeasure;

  const onAgentFabMainScrollSettled = useCallback(() => {
    if (scrollSettleMeasureTimerRef.current != null) {
      clearTimeout(scrollSettleMeasureTimerRef.current);
      scrollSettleMeasureTimerRef.current = null;
    }
    programmaticScrollPendingRef.current = false;
    scheduleAgentFabMeasureRef.current();
  }, []);

  const predictAgentFabWindowRectBeforeVerticalScroll = useCallback(
    (anchorStep: WizardStep, targetScrollY: number, runScroll: () => void) => {
      if (anchorStep <= 1) {
        runScroll();
        return;
      }
      const node = agentStepShellRefs.current[anchorStep];
      if (!node) {
        runScroll();
        return;
      }
      node.measureInWindow((x, y, w, h) => {
        const cur = mainScrollYRef.current;
        const dy = targetScrollY - cur;
        setAgentFabWindowRect({ x, y: y - dy, width: w, height: h });
        runScroll();
      });
    },
    [mainScrollYRef],
  );

  predictAgentFabWindowRectBeforeVerticalScrollRef.current = predictAgentFabWindowRectBeforeVerticalScroll;

  const captureStepPosition = useCallback((s: WizardStep, e: LayoutChangeEvent) => {
    stepPositions.current[s] = e.nativeEvent.layout.y;
  }, []);

  const onWizardStepShellLayout = useCallback(
    (step: WizardStep, e: LayoutChangeEvent) => {
      captureStepPosition(step, e);
      if (currentStepRef.current === step && !programmaticScrollPendingRef.current) {
        scheduleAgentFabMeasure();
      }
    },
    [captureStepPosition, currentStepRef, scheduleAgentFabMeasure],
  );

  useEffect(() => {
    if (currentStep === 1) {
      programmaticScrollPendingRef.current = false;
      setAgentFabWindowRect(null);
    }
  }, [currentStep]);

  useEffect(
    () => () => {
      if (scrollSettleMeasureTimerRef.current != null) {
        clearTimeout(scrollSettleMeasureTimerRef.current);
        scrollSettleMeasureTimerRef.current = null;
      }
      if (agentFabMeasureRafRef.current != null) {
        cancelAnimationFrame(agentFabMeasureRafRef.current);
        agentFabMeasureRafRef.current = null;
      }
    },
    [],
  );

  return {
    programmaticScrollPendingRef,
    scrollSettleMeasureTimerRef,
    scrollDismissLastNotifyMsRef,
    scheduleAgentFabMeasureRef,
    armAgentFabScrollSettleMeasureRef,
    predictAgentFabWindowRectBeforeVerticalScrollRef,
    agentStepShellRefs,
    agentFabWindowRect,
    setAgentFabWindowRect,
    agentFabMeasureRafRef,
    scheduleAgentFabMeasure,
    armAgentFabScrollSettleMeasure,
    onAgentFabMainScrollSettled,
    predictAgentFabWindowRectBeforeVerticalScroll,
    onWizardStepShellLayout,
    captureStepPosition,
  };
}
