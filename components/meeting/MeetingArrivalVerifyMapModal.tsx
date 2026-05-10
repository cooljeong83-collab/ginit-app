import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitTheme } from '@/constants/ginit-theme';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  NaverMapCircleOverlay,
  NaverMapMarkerOverlay,
  NaverMapView,
  type Region,
} from '@mj-studio/react-native-naver-map';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMeetingCategories } from '@/src/context/MeetingCategoriesContext';
import { categoryEmojiForMeeting } from '@/src/lib/friend-presence-activity';
import { haversineDistanceMeters } from '@/src/lib/geo-distance';
import { ensureForegroundLocationPermissionWithSettingsFallback } from '@/src/lib/location-permission';
import { getMeetingMapPinAccentColor } from '@/src/lib/map-meeting-marker-appearance';
import { verifyMeetingArrivalWithCoords } from '@/src/lib/meeting-arrival-verify';
import { firstPlaceCandidatePreferredPhotoUri } from '@/src/lib/meeting-list-thumbnail';
import type { Meeting } from '@/src/lib/meetings';
import { centerRegionToNaverRegion, type CenterLatLngRegion } from '@/src/lib/naver-map-region';

import type { MeetingArrivalVerifyMapModalProps } from './MeetingArrivalVerifyMapModal.types';

export type { MeetingArrivalVerifyMapModalProps } from './MeetingArrivalVerifyMapModal.types';

const DEFAULT_MAP_VIEW_RADIUS_M = 70;

/** 인증 반경 물결 파동 레이어 수 */
const RIPPLE_LAYER_COUNT = 4;

function rippleColors(
  inside: boolean | null,
  fillAlpha: number,
  outlineAlpha: number,
): { fill: string; outline: string } {
  const fa = Math.max(0, Math.min(0.28, fillAlpha));
  const oa = Math.max(0, Math.min(0.42, outlineAlpha));
  if (inside === true) {
    return {
      fill: `rgba(34, 197, 94, ${fa})`,
      outline: `rgba(22, 163, 74, ${oa})`,
    };
  }
  if (inside === false) {
    return {
      fill: `rgba(239, 68, 68, ${fa})`,
      outline: `rgba(220, 38, 38, ${oa})`,
    };
  }
  return {
    fill: `rgba(103, 58, 183, ${fa * 0.85})`,
    outline: `rgba(88, 28, 135, ${oa * 0.9})`,
  };
}

/** 중심+반경(미)에 맞는 위도·경도 델타 — `centerRegionToNaverRegion`용 */
function latLngDeltasForRadiusM(latitude: number, radiusM: number): { latitudeDelta: number; longitudeDelta: number } {
  const pad = 2.2;
  const latitudeDelta = Math.max(0.0006, ((radiusM / 111_320) * pad * 2));
  const cosLat = Math.cos((latitude * Math.PI) / 180);
  const longitudeDelta = Math.max(0.0006, latitudeDelta / Math.max(0.35, Math.abs(cosLat)));
  return { latitudeDelta, longitudeDelta };
}

export function MeetingArrivalVerifyMapModal({
  visible,
  onRequestClose,
  placeCoords,
  authRadiusM,
  minAccuracyM,
  meetingId,
  appUserId,
  pinMeeting,
  mapViewRadiusM = DEFAULT_MAP_VIEW_RADIUS_M,
  onRpcResult,
}: MeetingArrivalVerifyMapModalProps) {
  const insets = useSafeAreaInsets();
  const { height: windowH } = useWindowDimensions();
  const mapHeight = Math.round(Math.min(420, Math.max(260, windowH * 0.42)));
  const { categories } = useMeetingCategories();

  const [permDenied, setPermDenied] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [userAccuracy, setUserAccuracy] = useState<number | null>(null);
  const [userMocked, setUserMocked] = useState(false);
  const [userHeadingDeg, setUserHeadingDeg] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** 0~1 루프 — 반경 물결 애니메이션 */
  const [ripplePhase, setRipplePhase] = useState(0);

  const markerMeeting = pinMeeting as Meeting;
  const pinColor = useMemo(() => getMeetingMapPinAccentColor(markerMeeting, categories), [markerMeeting, categories]);
  const pinEmoji = useMemo(() => categoryEmojiForMeeting(markerMeeting, categories), [markerMeeting, categories]);
  const pinPhotoUri = useMemo(() => firstPlaceCandidatePreferredPhotoUri(markerMeeting), [markerMeeting]);

  const initialNaverRegion = useMemo((): Region => {
    const { latitudeDelta, longitudeDelta } = latLngDeltasForRadiusM(placeCoords.latitude, mapViewRadiusM);
    const center: CenterLatLngRegion = {
      latitude: placeCoords.latitude,
      longitude: placeCoords.longitude,
      latitudeDelta,
      longitudeDelta,
    };
    return centerRegionToNaverRegion(center);
  }, [placeCoords.latitude, placeCoords.longitude, mapViewRadiusM]);

  useEffect(() => {
    if (!visible) {
      setPermDenied(false);
      setLocError(null);
      setUserCoords(null);
      setUserAccuracy(null);
      setUserMocked(false);
      setUserHeadingDeg(null);
      setSubmitting(false);
      return;
    }

    let alive = true;
    let sub: Location.LocationSubscription | null = null;
    let headSub: Location.LocationSubscription | null = null;

    void (async () => {
      const perm = await ensureForegroundLocationPermissionWithSettingsFallback({
        title: '위치 권한이 필요해요',
        message: '장소 인증을 하려면 지도에 내 위치를 표시해야 해요.\n\n설정에서 위치 권한을 허용해 주세요.',
      });
      if (!alive) return;
      if (!perm.granted) {
        setPermDenied(true);
        setLocError(null);
        return;
      }
      setPermDenied(false);

      try {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        if (!alive) return;
        const mocked = Boolean((pos.coords as { mocked?: boolean }).mocked);
        setUserMocked(mocked);
        setUserCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        const acc =
          typeof pos.coords.accuracy === 'number' && Number.isFinite(pos.coords.accuracy)
            ? pos.coords.accuracy
            : null;
        setUserAccuracy(acc);
      } catch (e) {
        if (!alive) return;
        setLocError(e instanceof Error ? e.message : '위치를 가져오지 못했어요.');
        setUserCoords(null);
      }

      try {
        sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: 5,
            timeInterval: 2500,
          },
          (loc) => {
            if (!alive) return;
            setUserMocked(Boolean((loc.coords as { mocked?: boolean }).mocked));
            setUserCoords({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
            const acc =
              typeof loc.coords.accuracy === 'number' && Number.isFinite(loc.coords.accuracy)
                ? loc.coords.accuracy
                : null;
            setUserAccuracy(acc);
          },
        );
      } catch {
        /* watch 실패 시 초기 스냅샷만 사용 */
      }

      try {
        headSub = await Location.watchHeadingAsync((h) => {
          if (!alive) return;
          const deg = h.trueHeading ?? h.magHeading;
          if (typeof deg === 'number' && Number.isFinite(deg)) setUserHeadingDeg(deg);
        });
      } catch {
        /* 나침반 미지원·권한 없음 등 */
      }
    })();

    return () => {
      alive = false;
      sub?.remove();
      try {
        headSub?.remove();
      } catch {
        /* ignore */
      }
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      setRipplePhase(0);
      return;
    }
    const id = setInterval(() => {
      setRipplePhase((p) => {
        const n = p + 0.0085;
        return n >= 1 ? n - 1 : n;
      });
    }, 56);
    return () => clearInterval(id);
  }, [visible]);

  const distanceM = useMemo(() => {
    if (!userCoords) return null;
    return haversineDistanceMeters(userCoords, placeCoords);
  }, [userCoords, placeCoords]);

  const canSubmit = useMemo(() => {
    if (!userCoords || userMocked || submitting) return false;
    if (userAccuracy != null && userAccuracy > minAccuracyM) return false;
    if (distanceM == null || !Number.isFinite(distanceM)) return false;
    return distanceM <= authRadiusM;
  }, [userCoords, userMocked, submitting, userAccuracy, minAccuracyM, distanceM, authRadiusM]);

  /** 거리만 기준(지도 반경 색). 위치 없으면 null → 중립 보라 */
  const userInsideRadiusGeom = useMemo(() => {
    if (!userCoords || distanceM == null || !Number.isFinite(distanceM)) return null;
    return distanceM <= authRadiusM;
  }, [userCoords, distanceM, authRadiusM]);

  const onPressSubmit = useCallback(async () => {
    if (!userCoords || !canSubmit) return;
    setSubmitting(true);
    try {
      const res = await verifyMeetingArrivalWithCoords({
        meetingId,
        appUserId,
        lat: userCoords.latitude,
        lng: userCoords.longitude,
        clientAccuracyM: userAccuracy,
        isMockLocation: userMocked,
        suppressDiagnosticAlerts: true,
      });
      onRpcResult(res);
    } catch (e) {
      onRpcResult({ rpc: null, errorMessage: e instanceof Error ? e.message : '인증에 실패했어요.' });
    } finally {
      setSubmitting(false);
    }
  }, [userCoords, userAccuracy, userMocked, canSubmit, meetingId, appUserId, onRpcResult]);

  const footerHint = useMemo(() => {
    if (permDenied) return '위치 권한을 허용해야 지도와 인증이 가능해요.';
    if (locError) return locError;
    if (userMocked) return '모의(mock) 위치에서는 인증할 수 없어요.';
    if (userAccuracy != null && userAccuracy > minAccuracyM) {
      return `GPS 정확도가 약 ${Math.round(userAccuracy)}m예요. ${minAccuracyM}m 이하로 안정되면 인증할 수 있어요.`;
    }
    if (distanceM != null && Number.isFinite(distanceM)) {
      if (distanceM > authRadiusM) {
        return `모임 장소 반경 ${authRadiusM}m 안으로 이동하면 인증할 수 있어요. (현재 약 ${Math.round(distanceM)}m)`;
      }
      return '반경 안에 있어요. 아래에서 인증을 완료해 주세요.';
    }
    return '내 위치를 불러오는 중이에요…';
  }, [permDenied, locError, userMocked, userAccuracy, minAccuracyM, distanceM, authRadiusM]);

  const locationOverlay = useMemo(() => {
    if (!userCoords) return { isVisible: false as const };
    const inG = userInsideRadiusGeom === true;
    const outG = userInsideRadiusGeom === false;
    return {
      isVisible: true as const,
      position: { latitude: userCoords.latitude, longitude: userCoords.longitude },
      bearing: typeof userHeadingDeg === 'number' && Number.isFinite(userHeadingDeg) ? userHeadingDeg : 0,
      circleRadius: 22,
      circleColor: outG ? 'rgba(239, 68, 68, 0.16)' : inG ? 'rgba(34, 197, 94, 0.11)' : 'rgba(100, 116, 139, 0.1)',
      circleOutlineWidth: 1,
      circleOutlineColor: outG ? 'rgba(220, 38, 38, 0.42)' : inG ? 'rgba(22, 163, 74, 0.28)' : 'rgba(71, 85, 105, 0.22)',
    };
  }, [userCoords, userHeadingDeg, userInsideRadiusGeom]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onRequestClose}>
      <GestureHandlerRootView style={styles.gestureRoot}>
        <View style={[styles.sheet, { paddingBottom: 12 + insets.bottom }]}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>장소 인증</Text>
            <GinitPressable
              onPress={onRequestClose}
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.75 }]}
              accessibilityRole="button"
              accessibilityLabel="닫기">
              <Text style={styles.closeBtnText}>닫기</Text>
            </GinitPressable>
          </View>

          <View style={[styles.mapWrap, { height: mapHeight }]}>
            {visible ? (
              <NaverMapView
                key={`arrival-naver-${meetingId}-${placeCoords.latitude}-${placeCoords.longitude}`}
                style={StyleSheet.absoluteFill}
                initialRegion={initialNaverRegion}
                locationOverlay={locationOverlay}
                isScrollGesturesEnabled
                isZoomGesturesEnabled
                isRotateGesturesEnabled={false}
                isTiltGesturesEnabled={false}
                isShowZoomControls={false}
                isShowCompass={false}
                isShowScaleBar={false}
                isShowLocationButton={false}
                isExtentBoundedInKorea
                locale="ko"
                {...(Platform.OS === 'android' ? { isUseTextureViewAndroid: true } : {})}
                accessibilityLabel="장소 인증 지도 (네이버맵)">
                <NaverMapCircleOverlay
                  latitude={placeCoords.latitude}
                  longitude={placeCoords.longitude}
                  radius={authRadiusM}
                  zIndex={8}
                  color={
                    userInsideRadiusGeom === true
                      ? 'rgba(34, 197, 94, 0.05)'
                      : userInsideRadiusGeom === false
                        ? 'rgba(239, 68, 68, 0.03)'
                        : 'rgba(103, 58, 183, 0.03)'
                  }
                  outlineWidth={1}
                  outlineColor={
                    userInsideRadiusGeom === true
                      ? 'rgba(22, 163, 74, 0.2)'
                      : userInsideRadiusGeom === false
                        ? 'rgba(220, 38, 38, 0.2)'
                        : 'rgba(103, 58, 183, 0.18)'
                  }
                />
                {Array.from({ length: RIPPLE_LAYER_COUNT }).map((_, i) => {
                  const stagger = i / RIPPLE_LAYER_COUNT;
                  const localT = (ripplePhase + stagger) % 1;
                  const radius = Math.max(6, authRadiusM * (0.05 + 0.95 * localT));
                  const fade = 1 - localT;
                  /** easeOut — 앞쪽은 옅고 끝으로 갈수록 살짝만 진해짐 */
                  const fadeSoft = fade * fade * fade;
                  const fillAlpha = 0.1 + 0.12 * fadeSoft;
                  const outlineAlpha = 0.18 + 0.28 * fadeSoft;
                  const { fill, outline } = rippleColors(userInsideRadiusGeom, fillAlpha, outlineAlpha);
                  return (
                    <NaverMapCircleOverlay
                      key={`arrival-ripple-${i}`}
                      latitude={placeCoords.latitude}
                      longitude={placeCoords.longitude}
                      radius={radius}
                      zIndex={12 + i}
                      color={fill}
                      outlineWidth={0}
                      outlineColor={outline}
                    />
                  );
                })}
                <NaverMapMarkerOverlay
                  latitude={placeCoords.latitude}
                  longitude={placeCoords.longitude}
                  width={56}
                  height={60}
                  anchor={{ x: 0.5, y: 1 }}
                  zIndex={600}>
                  <View pointerEvents="none" collapsable={false} style={styles.naverMeetingPinRoot}>
                    <MaterialCommunityIcons
                      name="map-marker"
                      size={60}
                      color={pinColor}
                      style={styles.naverMeetingPinGlyph}
                    />
                    <View style={styles.naverMeetingPinEmojiDisc} collapsable={false}>
                      {pinPhotoUri ? (
                        <Image
                          source={{ uri: pinPhotoUri }}
                          style={styles.naverMeetingPinPhoto}
                          contentFit="cover"
                          transition={120}
                          cachePolicy="disk"
                          recyclingKey={pinPhotoUri}
                          accessibilityIgnoresInvertColors
                        />
                      ) : (
                        <Text style={styles.naverMeetingPinEmojiText} allowFontScaling={false}>
                          {pinEmoji}
                        </Text>
                      )}
                    </View>
                  </View>
                </NaverMapMarkerOverlay>
              </NaverMapView>
            ) : null}
          </View>

          <Text style={styles.hint}>{footerHint}</Text>

          <GinitPressable
            onPress={() => void onPressSubmit()}
            disabled={!canSubmit}
            style={({ pressed }) => [
              styles.submitBtn,
              !canSubmit && styles.submitBtnDisabled,
              canSubmit && pressed && { opacity: 0.88 },
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSubmit }}
            accessibilityLabel="인증하기">
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitBtnText}>인증하기</Text>
            )}
          </GinitPressable>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: GinitTheme.colors.bg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  title: { fontSize: 17, fontWeight: '700', color: GinitTheme.colors.text },
  closeBtn: { paddingVertical: 6, paddingHorizontal: 10 },
  closeBtnText: { fontSize: 15, fontWeight: '600', color: GinitTheme.colors.primary },
  mapWrap: {
    width: '100%',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: GinitTheme.colors.primarySoft,
  },
  hint: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.textSub,
    lineHeight: 18,
  },
  submitBtn: {
    marginTop: 14,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: GinitTheme.colors.deepPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnDisabled: { opacity: 0.45 },
  submitBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  /** `MapScreen` 네이버 핀과 동일 레이아웃 */
  naverMeetingPinRoot: {
    width: 56,
    height: 60,
    position: 'relative',
  },
  naverMeetingPinGlyph: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 0,
    zIndex: 0,
  },
  naverMeetingPinEmojiDisc: {
    position: 'absolute',
    top: 8,
    alignSelf: 'center',
    width: 28,
    height: 28,
    marginLeft: 4,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    zIndex: 1,
  },
  naverMeetingPinPhoto: {
    width: '100%',
    height: '100%',
  },
  naverMeetingPinEmojiText: {
    fontSize: 14,
    lineHeight: 16,
    textAlign: 'center',
    ...Platform.select({
      android: { includeFontPadding: false },
      default: {},
    }),
  },
});
