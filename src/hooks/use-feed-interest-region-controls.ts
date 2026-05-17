import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, Platform } from 'react-native';

import { normalizeFeedRegionLabel } from '@/src/lib/feed-region-match';
import {
  FEED_REGISTERED_REGIONS_MAX,
  loadActiveFeedRegion,
  loadRegisteredFeedRegions,
  saveActiveFeedRegion,
  saveRegisteredFeedRegions,
  syncFeedRegionMapBootMemoryFromSelection,
} from '@/src/lib/feed-registered-regions';
import { emitFeedInterestRegionSelectionChanged } from '@/src/lib/feed-interest-region-events';
import { closestRegisteredFeedRegionNorm } from '@/src/lib/feed-region-map-center';
import type { LatLng } from '@/src/lib/geo-distance';
import { getInterestRegionDisplayLabel, searchKoreaInterestDistricts } from '@/src/lib/korea-interest-districts';

function resolveExploreActiveRegionNorm(
  registeredRegions: readonly string[],
  activeRegionNorm: string | null,
): string {
  if (registeredRegions.length === 0) return '';
  const set = new Set(registeredRegions.map((r) => normalizeFeedRegionLabel(r)));
  const a = activeRegionNorm ? normalizeFeedRegionLabel(activeRegionNorm) : '';
  if (a && set.has(a)) return a;
  return normalizeFeedRegionLabel(registeredRegions[0]!);
}

function resolveActiveFromRegionsAndRaw(
  regions: readonly string[],
  activeRaw: string | null,
): string | null {
  if (regions.length === 0) return null;
  const setN = new Set(regions.map((r) => normalizeFeedRegionLabel(r)));
  const candidate =
    activeRaw && setN.has(activeRaw) ? activeRaw : normalizeFeedRegionLabel(regions[0]!);
  if (activeRaw !== candidate) void saveActiveFeedRegion(candidate);
  return candidate;
}

export type FeedInterestRegionControls = ReturnType<typeof useFeedInterestRegionControls>;

export function useFeedInterestRegionControls() {
  const [registeredRegions, setRegisteredRegions] = useState<string[]>([]);
  const registeredRegionsRef = useRef<string[]>([]);
  const [activeRegionNorm, setActiveRegionNorm] = useState<string | null>(null);
  const [draftRegisteredRegions, setDraftRegisteredRegions] = useState<string[]>([]);
  const [feedLocationReady, setFeedLocationReady] = useState(false);
  const [regionModalOpen, setRegionModalOpen] = useState(false);
  const [draftActiveRegionNorm, setDraftActiveRegionNorm] = useState<string | null>(null);
  const [regionSearchModalOpen, setRegionSearchModalOpen] = useState(false);
  const [regionSearchQuery, setRegionSearchQuery] = useState('');
  const [regionSearchKeyboardVisible, setRegionSearchKeyboardVisible] = useState(false);

  const exploreActiveRegionNorm = useMemo(
    () =>
      feedLocationReady && registeredRegions.length > 0
        ? resolveExploreActiveRegionNorm(registeredRegions, activeRegionNorm)
        : '',
    [feedLocationReady, registeredRegions, activeRegionNorm],
  );

  useEffect(() => {
    registeredRegionsRef.current = registeredRegions;
  }, [registeredRegions]);

  useEffect(() => {
    if (!feedLocationReady) return;
    syncFeedRegionMapBootMemoryFromSelection(registeredRegions, activeRegionNorm);
  }, [feedLocationReady, registeredRegions, activeRegionNorm]);

  const applyRegionsAndActive = useCallback((regions: string[], nextActive: string | null) => {
    registeredRegionsRef.current = regions;
    setRegisteredRegions(regions);
    setActiveRegionNorm(nextActive);
    void saveRegisteredFeedRegions(regions);
    void saveActiveFeedRegion(nextActive);
    syncFeedRegionMapBootMemoryFromSelection(regions, nextActive);
    emitFeedInterestRegionSelectionChanged();
  }, []);

  const refreshFromStorage = useCallback(async () => {
    const regions = await loadRegisteredFeedRegions();
    const activeRaw = await loadActiveFeedRegion();
    const nextActive = resolveActiveFromRegionsAndRaw(regions, activeRaw);
    registeredRegionsRef.current = regions;
    setRegisteredRegions(regions);
    setActiveRegionNorm(nextActive);
    syncFeedRegionMapBootMemoryFromSelection(regions, nextActive);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const regions = await loadRegisteredFeedRegions();
        if (cancelled) return;
        const activeRaw = await loadActiveFeedRegion();
        if (cancelled) return;
        const nextActive = resolveActiveFromRegionsAndRaw(regions, activeRaw);
        registeredRegionsRef.current = regions;
        setRegisteredRegions(regions);
        setActiveRegionNorm(nextActive);
        syncFeedRegionMapBootMemoryFromSelection(regions, nextActive);
      } finally {
        setFeedLocationReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshFromStorage();
    }, [refreshFromStorage]),
  );

  const openRegionModal = useCallback(() => {
    const regions = [...registeredRegionsRef.current];
    setDraftRegisteredRegions(regions);
    const currentActive = activeRegionNorm ? normalizeFeedRegionLabel(activeRegionNorm) : null;
    const setN = new Set(regions.map((r) => normalizeFeedRegionLabel(r)));
    const initialActive =
      currentActive && setN.has(currentActive)
        ? currentActive
        : regions.length > 0
          ? normalizeFeedRegionLabel(regions[0]!)
          : null;
    setDraftActiveRegionNorm(initialActive);
    setRegionSearchModalOpen(false);
    setRegionSearchQuery('');
    setRegionModalOpen(true);
  }, [activeRegionNorm]);

  const closeRegionModal = useCallback(() => {
    if (registeredRegionsRef.current.length === 0) {
      Alert.alert(
        '관심 지역 필요',
        '탐색을 사용하려면 관심 지역을 한 곳 이상 추가한 뒤 「적용」을 눌러 주세요.',
      );
      return;
    }
    setRegionSearchModalOpen(false);
    setRegionSearchQuery('');
    setRegionModalOpen(false);
  }, []);

  const pickDraftActiveRegion = useCallback((normRaw: string) => {
    setDraftActiveRegionNorm(normalizeFeedRegionLabel(normRaw));
  }, []);

  const openRegionSearchModal = useCallback(() => {
    if (draftRegisteredRegions.length >= FEED_REGISTERED_REGIONS_MAX) {
      Alert.alert('알림', `관심 지역은 최대 ${FEED_REGISTERED_REGIONS_MAX}곳까지 등록할 수 있어요.`);
      return;
    }
    setRegionSearchQuery('');
    setRegionSearchModalOpen(true);
  }, [draftRegisteredRegions.length]);

  const closeRegionSearchModal = useCallback(() => {
    setRegionSearchKeyboardVisible(false);
    setRegionSearchModalOpen(false);
    setRegionSearchQuery('');
  }, []);

  useEffect(() => {
    if (!regionSearchModalOpen) {
      setRegionSearchKeyboardVisible(false);
      return undefined;
    }
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subShow = Keyboard.addListener(showEvt, () => setRegionSearchKeyboardVisible(true));
    const subHide = Keyboard.addListener(hideEvt, () => setRegionSearchKeyboardVisible(false));
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [regionSearchModalOpen]);

  const removeDraftRegion = useCallback((regionRaw: string) => {
    const norm = normalizeFeedRegionLabel(regionRaw);
    setDraftRegisteredRegions((prev) => {
      if (registeredRegionsRef.current.length >= 1 && prev.length <= 1) return prev;
      const next = prev.filter((x) => normalizeFeedRegionLabel(x) !== norm);
      setDraftActiveRegionNorm((active) => {
        const a = active ? normalizeFeedRegionLabel(active) : '';
        if (a !== norm) return active;
        return next.length > 0 ? normalizeFeedRegionLabel(next[0]!) : null;
      });
      return next;
    });
  }, []);

  const pickSearchResultDistrict = useCallback((districtKey: string) => {
    const norm = normalizeFeedRegionLabel(districtKey);
    setDraftRegisteredRegions((prev) => {
      if (prev.some((x) => normalizeFeedRegionLabel(x) === norm)) return prev;
      if (prev.length >= FEED_REGISTERED_REGIONS_MAX) {
        Alert.alert('알림', `관심 지역은 최대 ${FEED_REGISTERED_REGIONS_MAX}곳까지 등록할 수 있어요.`);
        return prev;
      }
      const next = [...prev, norm];
      if (next.length === 1) {
        setDraftActiveRegionNorm(norm);
      }
      return next;
    });
    setRegionSearchQuery('');
    setRegionSearchModalOpen(false);
  }, []);

  const regionSearchResults = useMemo(
    () => searchKoreaInterestDistricts(regionSearchQuery, draftRegisteredRegions),
    [regionSearchQuery, draftRegisteredRegions],
  );

  const selectActiveRegionClosestToCoords = useCallback(
    (coords: LatLng) => {
      const regions = registeredRegionsRef.current;
      if (regions.length === 0) return;
      const closest = closestRegisteredFeedRegionNorm(regions, coords);
      if (!closest) return;
      const current = activeRegionNorm ? normalizeFeedRegionLabel(activeRegionNorm) : '';
      if (current === closest) return;
      applyRegionsAndActive(regions, closest);
    },
    [activeRegionNorm, applyRegionsAndActive],
  );

  const applyDraftRegisteredRegions = useCallback(() => {
    const next = draftRegisteredRegions.map((x) => normalizeFeedRegionLabel(x)).filter(Boolean);
    const dedup: string[] = [];
    const seen = new Set<string>();
    for (const r of next) {
      if (seen.has(r)) continue;
      seen.add(r);
      dedup.push(r);
      if (dedup.length >= FEED_REGISTERED_REGIONS_MAX) break;
    }
    if (dedup.length < 1) {
      Alert.alert('관심 지역 필요', '한 곳 이상 추가해 주세요.');
      return;
    }
    const setNorms = new Set(dedup.map((r) => normalizeFeedRegionLabel(r)));
    const draftA = draftActiveRegionNorm ? normalizeFeedRegionLabel(draftActiveRegionNorm) : '';
    const nextActive =
      dedup.length === 0
        ? null
        : draftA && setNorms.has(draftA)
          ? draftA
          : normalizeFeedRegionLabel(dedup[0]!);
    applyRegionsAndActive(dedup, nextActive);
    setRegionModalOpen(false);
  }, [draftRegisteredRegions, draftActiveRegionNorm, applyRegionsAndActive]);

  const displayRegionLabel = useMemo(() => {
    if (!feedLocationReady) return '불러오는 중…';
    if (registeredRegions.length === 0) return '관심 지역 등록';
    return getInterestRegionDisplayLabel(exploreActiveRegionNorm);
  }, [feedLocationReady, registeredRegions.length, exploreActiveRegionNorm]);

  return {
    registeredRegions,
    registeredRegionsRef,
    activeRegionNorm,
    feedLocationReady,
    exploreActiveRegionNorm,
    displayRegionLabel,
    refreshFromStorage,
    selectActiveRegionClosestToCoords,
    regionModalOpen,
    draftActiveRegionNorm,
    regionSearchModalOpen,
    regionSearchQuery,
    setRegionSearchQuery,
    regionSearchKeyboardVisible,
    draftRegisteredRegions,
    regionSearchResults,
    openRegionModal,
    closeRegionModal,
    pickDraftActiveRegion,
    openRegionSearchModal,
    closeRegionSearchModal,
    removeDraftRegion,
    pickSearchResultDistrict,
    applyDraftRegisteredRegions,
    getInterestRegionDisplayLabel,
  };
}
