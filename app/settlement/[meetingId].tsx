import { Image } from 'expo-image';
import type { ImagePickerAsset } from 'expo-image-picker';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlaceDetailPopup } from '@/components/places/PlaceDetailPopup';
import {
  placeDetailPopupStateFromMeeting,
  type PlaceDetailPopupState,
} from '@/src/lib/places/place-detail-popup-state';
import { preloadSettlementInterstitial, showSettlementInterstitial } from '@/src/lib/ads/settlement-interstitial-service';
import {
  MeetingChatImageViewerGallery,
  type ImageViewerGalleryItem,
} from '@/components/chat/MeetingChatImageViewerGallery';
import { meetingChatBodyStyles } from '@/components/chat/meeting-chat-body-styles';
import { MeetingArrivalVerifyTopSummary } from '@/components/meeting/MeetingArrivalVerifyTopSummary';
import { SettlementAccountPickerModal } from '@/components/settlement/SettlementAccountPickerModal';
import { SettlementAccountsScreenTopBar } from '@/components/settlement/SettlementAccountsScreenTopBar';
import { SettlementBankLogo } from '@/components/settlement/SettlementBankLogo';
import { ScreenShell } from '@/components/ui';
import { GinitPressable } from '@/components/ui/GinitPressable';
import { showTransientBottomMessage } from '@/components/ui/TransientBottomMessage';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import { useMeetingCategories } from '@/src/context/MeetingCategoriesContext';
import { useUserSession } from '@/src/context/UserSessionContext';
import { useAndroidOverlayHardwareBack } from '@/src/hooks/use-android-overlay-hardware-back';
import { useMeetingPlaceReviewSummary } from '@/src/hooks/use-meeting-place-review-summary';
import { useSyncOnScreenFocus } from '@/src/hooks/use-sync-on-screen-focus';
import { useTransitionRouter } from '@/src/lib/screen-transition-navigation';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { launchImageLibraryAsyncSafe } from '@/src/lib/expo-image-picker-safe-launch';
import {
  composeSettlementHostAccountText,
  getSettlementBankById,
  parseSettlementLegacyHostAccountText,
} from '@/src/lib/korean-banks-settlement';
import {
  markMeetingLifecycleSettled,
  persistMeetingLocationDataPatch,
  persistMeetingSettlementInfoPatch,
  persistParticipantSettlementReceipts,
} from '@/src/lib/meeting-settlement-persist';
import {
  buildMeetingTopNoticeTitleLeft,
  formatMeetingScheduleListLabel,
  formatPublicMeetingSettlementSummary,
  getMeetingById,
  isGinitWebGuestParticipantId,
  parsePublicMeetingDetailsConfig,
  type Meeting,
  type MeetingSettlementReceiptItem,
} from '@/src/lib/meetings';
import { runMeetingsListIncrementalReconcile } from '@/src/lib/meetings-feed-incremental-sync-core';
import { meetingPlaceReviewSummaryQueryKey } from '@/src/lib/meeting-review/meeting-review-api';
import { insertMeetingPlaceReviewNotifications } from '@/src/lib/meeting-place-review-notifications';
import { isMeetingPlaceReviewEligible } from '@/src/lib/meeting-place-review-notice';
import { dispatchRemotePushToRecipientsWithApproxDelivered } from '@/src/lib/remote-push-hub';
import { safeRouterBack } from '@/src/lib/router-safe';
import {
  computeReceiptBasedSettlementNet,
  formatSettlementNetWonLabel,
  formatSettlementNetWonSelfSummary,
  formatSettlementReadonlyParticipantNet,
} from '@/src/lib/settlement-receipt-split';
import {
  isMeetingHost,
  isMeetingSettlementCollaborationEligible,
  isMeetingSettlementCtaEligibleForHost,
} from '@/src/lib/settlement-eligibility';
import {
  fetchSettlementReceiptAnalysesFromSupabase,
  syncSettlementReceiptAnalysesToSupabase,
  type SettlementReceiptAnalysisRecord,
} from '@/src/lib/settlement-receipt-analysis-storage';
import { runSettlementReceiptOcrFromUri } from '@/src/lib/settlement-receipt-ocr';
import type { SettlementReceiptOcrAnalysis, SettlementReceiptOcrProgress } from '@/src/lib/settlement-receipt-ocr-types';
import {
  isRemoteSettlementReceiptImageUri,
  uploadCompressedSettlementReceiptToSupabase,
} from '@/src/lib/settlement-receipt-storage';
import {
  buildSettlementShareMessage,
  maskHolderInHostAccountTextForShare,
  type SettlementShareParticipantAmount,
  type SettlementShareReceiptSummary,
  shareSettlementText,
} from '@/src/lib/settlement-share-channels';
import { getUserProfilesForIds, type UserProfile } from '@/src/lib/user-profile';
import { presentAppDialogAlert, presentAppDialogConfirm, presentAppDialogThreeButton } from '@/src/lib/app-dialog-present';
import {
  getUserSettlementAccountById,
  loadUserSettlementAccounts,
  resolveEffectiveDefaultId,
  type UserSettlementAccountsState,
} from '@/src/lib/user-settlement-accounts';

const MAX_SETTLEMENT_PUSH_RECIPIENTS = 50;
const MAX_RECEIPT_IMAGES_PER_BATCH = 12;

type SettlementAmountTab = 'split_n' | 'manual';
type SettlementPaymentMethod = 'cash' | 'bank_transfer';

function parseWonDigits(raw: string): number {
  const t = raw.replace(/,/g, '').replace(/\s/g, '').trim();
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

function formatWonInput(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '';
  const n = Number(digits);
  return Number.isFinite(n) ? Math.trunc(n).toLocaleString() : digits;
}

/** 총액을 `ids` 순서대로 원 단위로 균등 분배(나머지는 앞쪽부터 1원씩). */
function distributeTotalWonEven(total: number, ids: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  const n = ids.length;
  if (n === 0 || !Number.isFinite(total) || total < 0) return m;
  const tt = Math.trunc(total);
  const base = Math.floor(tt / n);
  let rem = tt - base * n;
  for (let i = 0; i < n; i++) {
    const extra = rem > 0 ? 1 : 0;
    if (rem > 0) rem -= 1;
    m.set(ids[i]!, base + extra);
  }
  return m;
}

type SettlementReceiptRow = {
  id: string;
  previewUri: string;
  amountWon: number;
  uploaderAppUserId?: string;
  naturalWidth?: number;
  analysis?: SettlementReceiptOcrAnalysis;
};

type SettlementReceiptAddition = {
  assetIndex: number;
  uri: string;
  amountWon: number;
  naturalWidth?: number;
  analysis?: SettlementReceiptOcrAnalysis;
};

type SettlementReceiptScanStage = 'scanning' | 'ready' | 'error';

type SettlementReceiptScanPreviewState = {
  assets: ImagePickerAsset[];
  currentIndex: number;
  processingIndex: number | null;
  stage: SettlementReceiptScanStage;
  message: string;
  recognizedText: string[];
  recognizedTextByIndex: Record<number, string[]>;
  scanErrorsByIndex: Record<number, string>;
  additions: SettlementReceiptAddition[];
  accountHint: string | null;
  errorMessage?: string;
};

function newSettlementReceiptId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function mapDraftReceiptsToSettlementRows(
  drRows: readonly MeetingSettlementReceiptItem[],
): SettlementReceiptRow[] {
  return drRows
    .map((r) => {
      const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : newSettlementReceiptId();
      const previewUri = (r.imageUrl ?? '').trim();
      const uploaderRaw = (r.uploaderAppUserId ?? '').trim();
      const uploaderNorm = uploaderRaw ? normalizeParticipantId(uploaderRaw) ?? uploaderRaw : '';
      return {
        id,
        previewUri,
        amountWon: typeof r.amountWon === 'number' && Number.isFinite(r.amountWon) ? Math.trunc(r.amountWon) : 0,
        uploaderAppUserId: uploaderNorm || undefined,
      };
    })
    .filter((row) => row.previewUri.length > 0);
}

function isReceiptUploadedByMeetingHost(
  receipt: MeetingSettlementReceiptItem,
  meetingHostNorm: string,
): boolean {
  if (!meetingHostNorm) return false;
  const u = (receipt.uploaderAppUserId ?? '').trim();
  if (!u) return true;
  const norm = normalizeParticipantId(u) ?? u;
  return norm === meetingHostNorm;
}

function compactReceiptOcrText(chunks: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of chunks) {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= 8) break;
  }
  return out;
}

function summarizeReceiptScanTags(additions: SettlementReceiptAddition[]): string {
  const tags = new Set<string>();
  for (const addition of additions) {
    for (const item of addition.analysis?.review_source.items ?? []) {
      for (const tag of item.tags ?? []) {
        const t = tag.trim();
        if (t) tags.add(t);
      }
    }
  }
  return tags.size > 0 ? [...tags].slice(0, 8).join(', ') : '추출된 태그 없음';
}

function summarizeReceiptAnalysisTags(analysis: SettlementReceiptOcrAnalysis | undefined): string {
  if (!analysis) return '태그 없음';
  return summarizeReceiptScanTags([
    {
      assetIndex: 0,
      uri: '',
      amountWon: analysis.billing.total_amount ?? 0,
      analysis,
    },
  ]);
}

function receiptAnalysisTags(analysis: SettlementReceiptOcrAnalysis | undefined): string[] {
  if (!analysis) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of analysis.review_source.items ?? []) {
    for (const raw of item.tags ?? []) {
      const tag = raw.trim();
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      out.push(tag);
      if (out.length >= 8) return out;
    }
  }
  return out;
}

function settlementReceiptImageKey(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const path = trimmed.split('?')[0] ?? trimmed;
  return decodeURIComponent(path.split('/').filter(Boolean).at(-1) ?? '').trim();
}

type SettlementReceiptAnalysisMaps = {
  byId: Map<string, SettlementReceiptAnalysisRecord>;
  byUrl: Map<string, SettlementReceiptAnalysisRecord>;
  byKey: Map<string, SettlementReceiptAnalysisRecord>;
};

function buildSettlementReceiptAnalysisMaps(
  rows: readonly SettlementReceiptAnalysisRecord[],
): SettlementReceiptAnalysisMaps {
  const byId = new Map<string, SettlementReceiptAnalysisRecord>();
  const byUrl = new Map<string, SettlementReceiptAnalysisRecord>();
  const byKey = new Map<string, SettlementReceiptAnalysisRecord>();
  for (const row of rows) {
    byId.set(row.receiptId, row);
    byUrl.set(row.imageUrl.trim(), row);
    const key = settlementReceiptImageKey(row.imageUrl);
    if (key) byKey.set(key, row);
  }
  return { byId, byUrl, byKey };
}

function lookupSettlementReceiptAnalysis(
  row: SettlementReceiptRow,
  maps: SettlementReceiptAnalysisMaps,
): SettlementReceiptAnalysisRecord | undefined {
  return (
    maps.byId.get(row.id) ??
    maps.byUrl.get(row.previewUri.trim()) ??
    maps.byKey.get(settlementReceiptImageKey(row.previewUri))
  );
}

type SettlementReceiptPayerContext = {
  hostNorm: string;
  meeting: Meeting | null;
  participantProfiles: Map<string, UserProfile>;
  authDisplayName?: string | null;
};

function resolveSettlementParticipantDisplayName(
  pid: string,
  meeting: Meeting | null,
  participantProfiles: Map<string, UserProfile>,
  authDisplayName?: string | null,
): string {
  const createdBy = meeting?.createdBy?.trim() ?? '';
  const hostPid = createdBy ? normalizeParticipantId(createdBy) ?? createdBy : '';
  const isHostRow = Boolean(hostPid && pid === hostPid);
  const profile = participantProfiles.get(pid);
  return (
    profile?.nickname?.trim() || (isHostRow ? authDisplayName?.trim() ?? '' : '') || pid
  );
}

function resolveSettlementReceiptPayerNickname(
  uploaderAppUserId: string | undefined,
  ctx: SettlementReceiptPayerContext,
): string | null {
  const norm = uploaderAppUserId?.trim()
    ? normalizeParticipantId(uploaderAppUserId) ?? uploaderAppUserId.trim()
    : ctx.hostNorm;
  if (!norm) return null;
  const createdBy = ctx.meeting?.createdBy?.trim() ?? '';
  const hostPid = createdBy ? normalizeParticipantId(createdBy) ?? createdBy : '';
  const isHostRow = Boolean(hostPid && norm === hostPid);
  const profile = ctx.participantProfiles.get(norm);
  const nick =
    profile?.nickname?.trim() || (isHostRow ? ctx.authDisplayName?.trim() ?? '' : '') || '';
  return nick.trim() || null;
}

function buildSettlementShareReceiptSummariesFromRows(
  items: readonly SettlementReceiptRow[],
  maps: SettlementReceiptAnalysisMaps,
  payerContext?: SettlementReceiptPayerContext,
): SettlementShareReceiptSummary[] {
  return items.map((it) => {
    const savedAnalysis = lookupSettlementReceiptAnalysis(it, maps);
    const analysis = savedAnalysis?.analysis ?? it.analysis;
    return {
      storeName: savedAnalysis?.storeName?.trim() || analysis?.verification.store_name?.trim() || null,
      bizNum: savedAnalysis?.bizNum?.trim() || analysis?.verification.biz_num?.trim() || null,
      visitedAt: savedAnalysis?.receiptDateText?.trim() || analysis?.verification.datetime?.trim() || null,
      amountWon: analysis?.billing.total_amount ?? savedAnalysis?.amountWon ?? it.amountWon,
      payerNickname: payerContext
        ? resolveSettlementReceiptPayerNickname(it.uploaderAppUserId, payerContext)
        : null,
      tags: receiptAnalysisTags(analysis),
    };
  });
}

function findReceiptScanAdditionByAssetIndex(
  additions: SettlementReceiptAddition[],
  assetIndex: number,
): SettlementReceiptAddition | undefined {
  return additions.find((x) => x.assetIndex === assetIndex);
}

function waitReceiptScanResultPreview(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 650));
}

function SettlementReceiptUploaderBadge(props: {
  uploaderAppUserId?: string;
  hostNorm: string;
  meeting: Meeting | null;
  participantProfiles: Map<string, UserProfile>;
  authDisplayName?: string | null;
  authPhotoUrl?: string | null;
}) {
  const norm = props.uploaderAppUserId?.trim()
    ? normalizeParticipantId(props.uploaderAppUserId) ?? props.uploaderAppUserId.trim()
    : props.hostNorm;
  if (!norm) return null;
  const createdBy = props.meeting?.createdBy?.trim() ?? '';
  const hostPid = createdBy ? normalizeParticipantId(createdBy) ?? createdBy : '';
  const isHostRow = Boolean(hostPid && norm === hostPid);
  const profile = props.participantProfiles.get(norm);
  const nick =
    profile?.nickname?.trim() || (isHostRow ? props.authDisplayName?.trim() ?? '' : '') || '';
  const photoUrl =
    profile?.photoUrl?.trim() || (isHostRow ? props.authPhotoUrl?.trim() ?? '' : '');
  const initial = nick.trim().slice(0, 1) || '?';
  return (
    <View style={styles.receiptUploaderBadge} pointerEvents="none">
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} style={styles.receiptUploaderBadgeImg} contentFit="cover" />
      ) : (
        <View style={styles.receiptUploaderBadgeFallback}>
          <Text style={styles.receiptUploaderBadgeInitial}>{initial}</Text>
        </View>
      )}
    </View>
  );
}

function waitReceiptScanSlideTransition(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 420));
}

function SettlementReceiptScanOverlay({ active }: { active: boolean }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      progress.value = 0;
      return;
    }
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.cubic) }),
      -1,
      true,
    );
  }, [active, progress]);

  const scanLineStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: progress.value * 244 }],
  }));

  if (!active) return null;

  return (
    <View pointerEvents="none" style={styles.receiptScanOverlay}>
      <View style={styles.receiptScanDim} />
      <Animated.View style={[styles.receiptScanLine, scanLineStyle]}>
        <View style={styles.receiptScanLineCore} />
      </Animated.View>
    </View>
  );
}

function normalizeSettlementCompareDigits(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '').trim();
}

function normalizeSettlementCompareText(raw: string | null | undefined): string {
  return (raw ?? '').trim();
}

function sortedSettlementParticipantIds(ids: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const raw of ids) {
    const id = normalizeParticipantId(String(raw)) ?? String(raw).trim();
    if (id) out.add(id);
  }
  return [...out].sort();
}

function sameSettlementStringList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

export default function SettlementMeetingScreen() {
  const router = useTransitionRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const { userId, authProfile } = useUserSession();
  const { categories } = useMeetingCategories();
  const params = useLocalSearchParams<{ meetingId: string | string[] }>();
  const meetingId = Array.isArray(params.meetingId)
    ? (params.meetingId[0] ?? '').trim()
    : typeof params.meetingId === 'string'
      ? params.meetingId.trim()
      : '';

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [settlementHasUnsavedUserChanges, setSettlementHasUnsavedUserChanges] = useState(false);
  const [receiptItems, setReceiptItems] = useState<SettlementReceiptRow[]>([]);
  const [settlementReceiptAnalysesById, setSettlementReceiptAnalysesById] = useState<Map<string, SettlementReceiptAnalysisRecord>>(
    new Map(),
  );
  const [settlementReceiptAnalysesByImageUrl, setSettlementReceiptAnalysesByImageUrl] = useState<
    Map<string, SettlementReceiptAnalysisRecord>
  >(new Map());
  const [settlementReceiptAnalysesByImageKey, setSettlementReceiptAnalysesByImageKey] = useState<
    Map<string, SettlementReceiptAnalysisRecord>
  >(new Map());
  const [receiptScanPreview, setReceiptScanPreview] = useState<SettlementReceiptScanPreviewState | null>(null);
  const [receiptImageViewerIndex, setReceiptImageViewerIndex] = useState<number | null>(null);

  const [totalWonInput, setTotalWonInput] = useState('');
  const [hostBankId, setHostBankId] = useState('');
  const [hostAccountNumber, setHostAccountNumber] = useState('');
  const [hostAccountHolder, setHostAccountHolder] = useState('');
  const [selectedProfileAccountId, setSelectedProfileAccountId] = useState('');
  const [profileAccounts, setProfileAccounts] = useState<UserSettlementAccountsState | null>(null);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [accountPickerAnimationType, setAccountPickerAnimationType] = useState<'none' | 'slide'>('slide');
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<Set<string>>(new Set());
  const [participantProfiles, setParticipantProfiles] = useState<Map<string, UserProfile>>(new Map());
  const [placeDetailPopup, setPlaceDetailPopup] = useState<PlaceDetailPopupState | null>(null);
  const [settlementAmountTab, setSettlementAmountTab] = useState<SettlementAmountTab>('split_n');
  const [settlementPaymentMethod, setSettlementPaymentMethod] = useState<SettlementPaymentMethod>('bank_transfer');
  const [manualAmountsByParticipant, setManualAmountsByParticipant] = useState<Record<string, string>>({});
  const [bulkAmountModalOpen, setBulkAmountModalOpen] = useState(false);
  const [bulkAmountDraft, setBulkAmountDraft] = useState('');
  const reopenAccountPickerOnFocusRef = useRef(false);
  const receiptScanRunIdRef = useRef(0);
  const receiptScanPagerRef = useRef<ScrollView | null>(null);
  const receiptScanLastAutoScrollRef = useRef<{ page: number; width: number } | null>(null);

  const reload = useCallback(async () => {
    if (!meetingId) return;
    const m = await getMeetingById(meetingId);
    setMeeting(m);
  }, [meetingId]);

  useFocusEffect(
    useCallback(() => {
      const uid = (userId ?? '').trim();
      if (!uid) {
        reopenAccountPickerOnFocusRef.current = false;
        setProfileAccounts({ defaultId: null, items: [] });
        return;
      }
      let alive = true;
      loadUserSettlementAccounts(uid).then((s) => {
        if (!alive) return;
        setProfileAccounts(s);
        if (reopenAccountPickerOnFocusRef.current) {
          reopenAccountPickerOnFocusRef.current = false;
          if (s.items.length > 0) {
            setAccountPickerAnimationType('slide');
            setAccountPickerOpen(true);
          }
        }
      });
      return () => {
        alive = false;
      };
    }, [userId]),
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const m = await getMeetingById(meetingId);
      if (!alive) return;
      setMeeting(m);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [meetingId]);

  useSyncOnScreenFocus(
    useCallback(async () => {
      if (!meetingId) return;
      if (settlementHasUnsavedUserChanges || saving || ocrBusy) return;
      await reload();
    }, [meetingId, settlementHasUnsavedUserChanges, saving, ocrBusy, reload]),
    [meetingId, settlementHasUnsavedUserChanges, saving, ocrBusy],
    { enabled: Boolean(meetingId) },
  );

  const hostNorm = useMemo(() => {
    const u = (userId ?? '').trim();
    return u ? normalizeParticipantId(u) ?? u : '';
  }, [userId]);

  const meetingHostNorm = useMemo(() => {
    const createdBy = meeting?.createdBy?.trim() ?? '';
    return createdBy ? normalizeParticipantId(createdBy) ?? createdBy : '';
  }, [meeting?.createdBy]);

  const participantRows = useMemo(() => {
    if (!meeting?.createdBy) return [];
    const host = normalizeParticipantId(meeting.createdBy.trim()) ?? meeting.createdBy.trim();
    const raw = meeting.participantIds ?? [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const x of raw) {
      const id = normalizeParticipantId(String(x)) ?? String(x).trim();
      if (!id || id === host) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }, [meeting]);

  /** 1/N 분모: 주최자(본인) + 참석자 PK 순. */
  const allSettlementParticipantIds = useMemo(() => {
    if (!meeting?.createdBy) return [];
    const host = normalizeParticipantId(meeting.createdBy.trim()) ?? meeting.createdBy.trim();
    const seen = new Set<string>();
    const out: string[] = [];
    if (host) {
      seen.add(host);
      out.push(host);
    }
    for (const p of participantRows) {
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(p);
    }
    return out;
  }, [meeting?.createdBy, participantRows]);

  useEffect(() => {
    let alive = true;
    const ids = allSettlementParticipantIds;
    if (ids.length === 0) {
      setParticipantProfiles(new Map());
      return;
    }
    void (async () => {
      try {
        const profiles = await getUserProfilesForIds(ids);
        if (alive) setParticipantProfiles(profiles);
      } catch {
        if (alive) setParticipantProfiles(new Map());
      }
    })();
    return () => {
      alive = false;
    };
  }, [allSettlementParticipantIds]);

  /** 임시 저장 후 read-after-write 지연으로 빈 settlement이 먼저 오는 경우, meeting.id만으로 스킵하면 영수증 행이 영구히 비게 됨 → 저장 세대·영수증 시그니처 포함 */
  const settlementSaveGenerationRef = useRef(0);
  const lastHydratedSettlementKeyRef = useRef<string | null>(null);
  /** 프로필 계좌 목록·대표가 바뀔 때만 정산 입력란을 프로필 기본값으로 맞춤(사용자가 모달에서 고른 값은 pk 불변으로 유지). */
  const lastAppliedProfileHostKeyRef = useRef<string>('');
  useEffect(
    () => () => {
      lastHydratedSettlementKeyRef.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!meeting?.id || !hostNorm) return;
    const si = meeting.settlementInfo;
    const dr = si?.draftReceipts ?? [];
    const receiptSig = dr.length ? dr.map((r) => `${r.id}:${r.amountWon}:${r.imageUrl}`).join('|') : '_';
    const hydrationKey = `${meeting.id}|g${settlementSaveGenerationRef.current}|r${receiptSig}|t${si?.draftTotalWon ?? ''}`;
    if (lastHydratedSettlementKeyRef.current === hydrationKey) return;
    lastHydratedSettlementKeyRef.current = hydrationKey;
    setTotalWonInput(si?.draftTotalWon != null ? formatWonInput(String(si.draftTotalWon)) : '');
    const legacyHostAccount = parseSettlementLegacyHostAccountText(si?.hostAccountText ?? '');
    setSettlementPaymentMethod(si?.paymentMethod === 'cash' ? 'cash' : 'bank_transfer');
    setHostBankId((si?.hostBankCode ?? '').trim() || legacyHostAccount.bankId || '');
    setHostAccountNumber((si?.hostAccountNumber ?? '').replace(/\D/g, '').trim() || legacyHostAccount.accountNumber || '');
    setHostAccountHolder((si?.hostAccountHolder ?? '').trim() || legacyHostAccount.holder || '');
    const allIds = allSettlementParticipantIds;
    if (si?.selectedParticipantIds?.length) {
      const allowed = new Set(allIds);
      const next = new Set<string>();
      for (const x of si.selectedParticipantIds) {
        const id = normalizeParticipantId(String(x)) ?? String(x).trim();
        if (id && allowed.has(id)) next.add(id);
      }
      setSelectedParticipantIds(next.size > 0 ? next : new Set(allIds));
    } else {
      setSelectedParticipantIds(new Set(allIds));
    }
    const drRows = si?.draftReceipts;
    if (Array.isArray(drRows) && drRows.length > 0) {
      const mapped = mapDraftReceiptsToSettlementRows(drRows);
      const onlyMineInReceiptItems =
        !isMeetingHost(meeting, hostNorm) &&
        meeting.lifecycleStatus !== 'SETTLED' &&
        isMeetingSettlementCollaborationEligible(meeting, hostNorm, Date.now());
      const rowsForState = onlyMineInReceiptItems
        ? mapped.filter((row) => row.uploaderAppUserId === hostNorm)
        : mapped;
      setReceiptItems((prev) =>
        rowsForState.map((row) => {
          const previous = prev.find((item) => item.id === row.id || item.previewUri.trim() === row.previewUri);
          return {
            ...row,
            naturalWidth: previous?.naturalWidth,
            analysis: previous?.analysis,
          };
        }),
      );
    } else {
      setReceiptItems([]);
    }
    setSettlementHasUnsavedUserChanges(false);
  }, [meeting, hostNorm, allSettlementParticipantIds]);

  useEffect(() => {
    if (meeting?.lifecycleStatus === 'SETTLED') return;
    if (receiptItems.length === 0) return;
    if (settlementAmountTab === 'manual') return;
    const sum = receiptItems.reduce((s, x) => s + x.amountWon, 0);
    setTotalWonInput(formatWonInput(String(sum)));
  }, [meeting?.lifecycleStatus, receiptItems, settlementAmountTab]);

  useEffect(() => {
    if (!meeting?.id || !hostNorm || profileAccounts === null) return;
    const pk = `${meeting.id}:${profileAccounts.items.map((i) => i.id).join(',')}:${profileAccounts.defaultId ?? ''}`;
    if (lastAppliedProfileHostKeyRef.current === pk) return;
    lastAppliedProfileHostKeyRef.current = pk;
    const si = meeting.settlementInfo;
    if (
      (si?.hostBankCode ?? '').trim() ||
      (si?.hostAccountNumber ?? '').trim() ||
      (si?.hostAccountHolder ?? '').trim() ||
      (si?.hostAccountText ?? '').trim()
    ) {
      return;
    }

    if (profileAccounts.items.length === 0) {
      setSelectedProfileAccountId('');
      setHostBankId('');
      setHostAccountNumber('');
      setHostAccountHolder('');
      return;
    }
    const rid = resolveEffectiveDefaultId(profileAccounts.items, profileAccounts.defaultId);
    const acc = rid ? getUserSettlementAccountById(profileAccounts, rid) : null;
    if (acc) {
      setSelectedProfileAccountId(acc.id);
      setHostBankId(acc.bankCode);
      setHostAccountNumber(acc.accountNumber.replace(/\D/g, ''));
      setHostAccountHolder(acc.holder);
    }
  }, [meeting?.id, hostNorm, profileAccounts]);

  const selectedBank = useMemo(() => getSettlementBankById(hostBankId), [hostBankId]);

  const composedHostAccountText = useMemo(() => {
    return composeSettlementHostAccountText({
      bankLabel: selectedBank?.label ?? '',
      accountNumberDigits: hostAccountNumber,
      holder: hostAccountHolder,
    });
  }, [selectedBank?.label, hostAccountNumber, hostAccountHolder]);

  const usesBankTransferSettlement = settlementPaymentMethod === 'bank_transfer';

  const totalWonParsed = useMemo(() => {
    const t = totalWonInput.replace(/,/g, '').trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
  }, [totalWonInput]);

  const activeSplitParticipantIds = useMemo(
    () => allSettlementParticipantIds.filter((id) => selectedParticipantIds.has(id)),
    [allSettlementParticipantIds, selectedParticipantIds],
  );

  const selectedCount = activeSplitParticipantIds.length;

  const manualSumParsed = useMemo(() => {
    if (settlementAmountTab !== 'manual') return null;
    const ids = allSettlementParticipantIds.filter((id) => selectedParticipantIds.has(id));
    const sum = ids.reduce((s, id) => s + parseWonDigits(manualAmountsByParticipant[id] ?? ''), 0);
    return sum > 0 ? sum : null;
  }, [settlementAmountTab, manualAmountsByParticipant, allSettlementParticipantIds, selectedParticipantIds]);

  const effectiveTotalWonParsed = useMemo(() => {
    if (settlementAmountTab === 'manual') return manualSumParsed;
    return totalWonParsed;
  }, [settlementAmountTab, manualSumParsed, totalWonParsed]);

  const splitDisplayMap = useMemo(() => {
    if (settlementAmountTab !== 'split_n') return new Map<string, number>();
    if (totalWonParsed == null || activeSplitParticipantIds.length === 0) return new Map<string, number>();
    return distributeTotalWonEven(totalWonParsed, activeSplitParticipantIds);
  }, [settlementAmountTab, totalWonParsed, activeSplitParticipantIds]);

  const perPersonWon = useMemo(() => {
    if (activeSplitParticipantIds.length === 0) return null;
    if (settlementAmountTab === 'manual') {
      if (manualSumParsed == null) return null;
      return Math.round(manualSumParsed / activeSplitParticipantIds.length);
    }
    if (totalWonParsed == null) return null;
    return splitDisplayMap.get(activeSplitParticipantIds[0]!) ?? null;
  }, [settlementAmountTab, totalWonParsed, manualSumParsed, activeSplitParticipantIds, splitDisplayMap]);

  const canEditSettlement = useMemo(() => {
    if (!meeting || !userId?.trim()) return false;
    if (!isMeetingHost(meeting, userId)) return false;
    return isMeetingSettlementCtaEligibleForHost(meeting, userId, Date.now());
  }, [meeting, userId]);

  const canCollaborateSettlement = useMemo(() => {
    if (!meeting || !hostNorm) return false;
    if (isMeetingHost(meeting, hostNorm)) return false;
    return isMeetingSettlementCollaborationEligible(meeting, hostNorm, Date.now());
  }, [meeting, hostNorm]);

  const settlementParticipantMode = canCollaborateSettlement && !canEditSettlement;

  const hostCollaborationReceiptRows = useMemo(() => {
    if (!settlementParticipantMode || !meetingHostNorm) return [] as SettlementReceiptRow[];
    const hostReceipts = (meeting?.settlementInfo?.draftReceipts ?? []).filter((r) =>
      isReceiptUploadedByMeetingHost(r, meetingHostNorm),
    );
    return mapDraftReceiptsToSettlementRows(hostReceipts).map((row) => ({
      ...row,
      uploaderAppUserId: row.uploaderAppUserId ?? meetingHostNorm,
    }));
  }, [settlementParticipantMode, meetingHostNorm, meeting?.settlementInfo?.draftReceipts]);

  const receiptImageGallery = useMemo<ImageViewerGalleryItem[]>(
    () => {
      const rows = settlementParticipantMode
        ? [...receiptItems, ...hostCollaborationReceiptRows]
        : receiptItems;
      return rows
        .map((it) => ({ id: it.id, imageUrl: it.previewUri.trim() }))
        .filter((it) => it.imageUrl.length > 0);
    },
    [receiptItems, hostCollaborationReceiptRows, settlementParticipantMode],
  );

  const receiptImageViewerSafeIndex = useMemo(() => {
    if (receiptImageViewerIndex == null || receiptImageGallery.length === 0) return 0;
    return Math.max(0, Math.min(receiptImageGallery.length - 1, receiptImageViewerIndex));
  }, [receiptImageGallery.length, receiptImageViewerIndex]);

  useEffect(() => {
    if (receiptImageViewerIndex == null) return;
    if (receiptImageGallery.length === 0) {
      setReceiptImageViewerIndex(null);
      return;
    }
    if (receiptImageViewerIndex > receiptImageGallery.length - 1) {
      setReceiptImageViewerIndex(receiptImageGallery.length - 1);
    }
  }, [receiptImageGallery.length, receiptImageViewerIndex]);

  const canViewSettledSettlement = useMemo(() => {
    const uid = (userId ?? '').trim();
    if (!meeting || !uid || meeting.lifecycleStatus !== 'SETTLED') return false;
    if (isMeetingHost(meeting, uid)) return true;
    const viewer = normalizeParticipantId(uid) ?? uid;
    const selected = meeting.settlementInfo?.selectedParticipantIds ?? [];
    if (selected.length > 0) {
      return selected.some((id) => (normalizeParticipantId(String(id)) ?? String(id).trim()) === viewer);
    }
    return allSettlementParticipantIds.includes(viewer);
  }, [meeting, userId, allSettlementParticipantIds]);

  const placeReviewEligible = useMemo(
    () => Boolean(meeting && canViewSettledSettlement && isMeetingPlaceReviewEligible(meeting, userId)),
    [meeting, canViewSettledSettlement, userId],
  );

  const placeReviewSummaryQuery = useMeetingPlaceReviewSummary(meetingId, userId, {
    enabled: placeReviewEligible,
  });

  useFocusEffect(
    useCallback(() => {
      if (!placeReviewEligible || !meetingId.trim()) return;
      void queryClient.invalidateQueries({ queryKey: meetingPlaceReviewSummaryQueryKey(meetingId) });
    }, [placeReviewEligible, meetingId, queryClient]),
  );

  const myPlaceReviewSubmitted = useMemo(() => {
    if (!placeReviewSummaryQuery.isSuccess) return null;
    const summary = placeReviewSummaryQuery.data;
    const uid = userId?.trim() ?? '';
    if (!uid) return false;
    if (summary.myReview) return true;
    const pk = normalizeParticipantId(uid) ?? uid;
    return summary.participants.some(
      (p) => (normalizeParticipantId(p.appUserId) ?? p.appUserId) === pk && p.hasReviewed,
    );
  }, [placeReviewSummaryQuery.isSuccess, placeReviewSummaryQuery.data, userId]);

  const showSettlementReviewCard = useMemo(
    () => placeReviewEligible && myPlaceReviewSubmitted === false,
    [placeReviewEligible, myPlaceReviewSubmitted],
  );

  useEffect(() => {
    preloadSettlementInterstitial();
  }, []);

  const settlementReadOnly =
    canViewSettledSettlement && !canEditSettlement && !canCollaborateSettlement;
  const settlementParticipantDisplayIds = settlementReadOnly ? activeSplitParticipantIds : allSettlementParticipantIds;

  useEffect(() => {
    if (!settlementParticipantMode) return;
    setSelectedParticipantIds(new Set(allSettlementParticipantIds));
  }, [settlementParticipantMode, allSettlementParticipantIds]);

  const mergedDraftReceiptsForSplit = useMemo((): MeetingSettlementReceiptItem[] => {
    const fromServer = meeting?.settlementInfo?.draftReceipts ?? [];
    if (canEditSettlement && settlementHasUnsavedUserChanges) {
      return receiptItems
        .filter((r) => r.previewUri.trim())
        .map((r) => ({
          id: r.id,
          imageUrl: r.previewUri.trim(),
          amountWon: r.amountWon,
          uploaderAppUserId: (r.uploaderAppUserId ?? hostNorm) || undefined,
        }));
    }
    if (settlementParticipantMode && settlementHasUnsavedUserChanges) {
      const others = fromServer.filter((r) => {
        const u = (r.uploaderAppUserId ?? '').trim();
        const norm = u ? normalizeParticipantId(u) ?? u : '';
        return norm !== hostNorm;
      });
      const mine = receiptItems
        .filter((r) => r.previewUri.trim())
        .map((r) => ({
          id: r.id,
          imageUrl: r.previewUri.trim(),
          amountWon: r.amountWon,
          uploaderAppUserId: hostNorm,
        }));
      return [...others, ...mine];
    }
    return fromServer;
  }, [
    meeting?.settlementInfo?.draftReceipts,
    canEditSettlement,
    settlementParticipantMode,
    settlementHasUnsavedUserChanges,
    receiptItems,
    hostNorm,
  ]);

  const useReceiptSplitDisplay = mergedDraftReceiptsForSplit.length > 0;

  const receiptNetDisplayMap = useMemo(() => {
    if (!useReceiptSplitDisplay) return new Map<string, number>();
    const settledSnap = meeting?.settlementInfo?.participantNetWonById;
    if (settlementReadOnly && settledSnap && Object.keys(settledSnap).length > 0) {
      return new Map(
        Object.entries(settledSnap).map(([k, v]) => [normalizeParticipantId(k) ?? k, Math.trunc(v)]),
      );
    }
    return computeReceiptBasedSettlementNet(activeSplitParticipantIds, mergedDraftReceiptsForSplit);
  }, [
    useReceiptSplitDisplay,
    meeting?.settlementInfo?.participantNetWonById,
    settlementReadOnly,
    activeSplitParticipantIds,
    mergedDraftReceiptsForSplit,
  ]);

  const viewerSettlementNetWon = useMemo(() => {
    if (useReceiptSplitDisplay) return receiptNetDisplayMap.get(hostNorm) ?? 0;
    if (settlementAmountTab === 'split_n' && perPersonWon != null) return perPersonWon;
    if (settlementAmountTab === 'manual') return parseWonDigits(manualAmountsByParticipant[hostNorm] ?? '');
    return 0;
  }, [
    useReceiptSplitDisplay,
    receiptNetDisplayMap,
    hostNorm,
    settlementAmountTab,
    perPersonWon,
    manualAmountsByParticipant,
  ]);

  const viewerSettlementSummary = useMemo(
    () => formatSettlementNetWonSelfSummary(viewerSettlementNetWon),
    [viewerSettlementNetWon],
  );

  const otherParticipantsReceipts = useMemo(() => {
    if (!settlementParticipantMode) return [] as MeetingSettlementReceiptItem[];
    return (meeting?.settlementInfo?.draftReceipts ?? []).filter((r) => {
      const u = (r.uploaderAppUserId ?? '').trim();
      const norm = u ? normalizeParticipantId(u) ?? u : '';
      if (!norm || norm === hostNorm) return false;
      return !isReceiptUploadedByMeetingHost(r, meetingHostNorm);
    });
  }, [settlementParticipantMode, meeting?.settlementInfo?.draftReceipts, hostNorm, meetingHostNorm]);
  const receiptAnalysisFetchSig = useMemo(
    () =>
      [...receiptItems, ...hostCollaborationReceiptRows]
        .map((r) => `${r.id}:${r.previewUri.trim()}`)
        .join('|'),
    [receiptItems, hostCollaborationReceiptRows],
  );

  useEffect(() => {
    if (!meetingId.trim()) {
      setSettlementReceiptAnalysesById(new Map());
      setSettlementReceiptAnalysesByImageUrl(new Map());
      setSettlementReceiptAnalysesByImageKey(new Map());
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const rows = await fetchSettlementReceiptAnalysesFromSupabase(meetingId);
        if (!alive) return;
        const maps = buildSettlementReceiptAnalysisMaps(rows);
        setSettlementReceiptAnalysesById(maps.byId);
        setSettlementReceiptAnalysesByImageUrl(maps.byUrl);
        setSettlementReceiptAnalysesByImageKey(maps.byKey);
      } catch {
        if (alive) {
          setSettlementReceiptAnalysesById(new Map());
          setSettlementReceiptAnalysesByImageUrl(new Map());
          setSettlementReceiptAnalysesByImageKey(new Map());
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [meetingId, receiptAnalysisFetchSig]);

  const settlementAccountTextForReadOnly = useMemo(() => {
    const saved = meeting?.settlementInfo?.hostAccountText?.trim() ?? '';
    return saved || composedHostAccountText.trim();
  }, [meeting?.settlementInfo?.hostAccountText, composedHostAccountText]);
  const maskedSettlementAccountTextForReadOnly = useMemo(
    () => maskHolderInHostAccountTextForShare(settlementAccountTextForReadOnly),
    [settlementAccountTextForReadOnly],
  );
  const maskedHostAccountHolder = useMemo(() => {
    const composed = composeSettlementHostAccountText({
      bankLabel: selectedBank?.label ?? '',
      accountNumberDigits: hostAccountNumber,
      holder: hostAccountHolder,
    });
    const masked = maskHolderInHostAccountTextForShare(composed);
    return masked.split(/\s+/).filter(Boolean).at(-1) ?? hostAccountHolder.trim();
  }, [selectedBank?.label, hostAccountNumber, hostAccountHolder]);

  const settlementReceiptAnalysisMaps = useMemo<SettlementReceiptAnalysisMaps>(
    () => ({
      byId: settlementReceiptAnalysesById,
      byUrl: settlementReceiptAnalysesByImageUrl,
      byKey: settlementReceiptAnalysesByImageKey,
    }),
    [settlementReceiptAnalysesById, settlementReceiptAnalysesByImageUrl, settlementReceiptAnalysesByImageKey],
  );

  const settlementShareReceiptSummaries = useMemo<SettlementShareReceiptSummary[]>(
    () =>
      buildSettlementShareReceiptSummariesFromRows(receiptItems, settlementReceiptAnalysisMaps, {
        hostNorm,
        meeting,
        participantProfiles,
        authDisplayName: authProfile?.displayName,
      }),
    [receiptItems, settlementReceiptAnalysisMaps, hostNorm, meeting, participantProfiles, authProfile?.displayName],
  );

  const settlementShareParticipantAmounts = useMemo<SettlementShareParticipantAmount[]>(() => {
    return activeSplitParticipantIds.map((pid) => {
      let amountWon = 0;
      if (useReceiptSplitDisplay) {
        amountWon = receiptNetDisplayMap.get(pid) ?? 0;
      } else if (settlementAmountTab === 'split_n') {
        amountWon = splitDisplayMap.get(pid) ?? 0;
      } else {
        amountWon = parseWonDigits(manualAmountsByParticipant[pid] ?? '');
      }
      return {
        displayName: resolveSettlementParticipantDisplayName(
          pid,
          meeting,
          participantProfiles,
          authProfile?.displayName,
        ),
        amountWon,
      };
    });
  }, [
    activeSplitParticipantIds,
    useReceiptSplitDisplay,
    receiptNetDisplayMap,
    settlementAmountTab,
    splitDisplayMap,
    manualAmountsByParticipant,
    meeting,
    participantProfiles,
    authProfile?.displayName,
  ]);

  const settlementModeSummaryLine = useMemo(() => {
    if (!meeting) return formatPublicMeetingSettlementSummary('DUTCH', null);
    const cfg = parsePublicMeetingDetailsConfig(meeting.meetingConfig);
    return cfg
      ? formatPublicMeetingSettlementSummary(cfg.settlement, cfg.membershipFeeWon ?? null)
      : formatPublicMeetingSettlementSummary('DUTCH', null);
  }, [meeting]);

  const settlementMeetingTitleLine = useMemo(() => {
    if (!meeting) return '모임';
    return buildMeetingTopNoticeTitleLeft(meeting, categories);
  }, [meeting, categories]);

  const savedSettlementReceiptsForShare = useMemo(
    () =>
      (meeting?.settlementInfo?.draftReceipts ?? [])
        .map((r) => ({
          id: (r.id ?? '').trim(),
          imageUrl: (r.imageUrl ?? '').trim(),
          amountWon: typeof r.amountWon === 'number' && Number.isFinite(r.amountWon) ? Math.trunc(r.amountWon) : 0,
        }))
        .filter((r) => r.id.length > 0 && r.imageUrl.length > 0),
    [meeting?.settlementInfo?.draftReceipts],
  );

  const savedParticipantReceiptsForCompare = useMemo(
    () =>
      (meeting?.settlementInfo?.draftReceipts ?? [])
        .map((r) => ({
          id: (r.id ?? '').trim(),
          imageUrl: (r.imageUrl ?? '').trim(),
          amountWon: typeof r.amountWon === 'number' && Number.isFinite(r.amountWon) ? Math.trunc(r.amountWon) : 0,
          uploaderAppUserId: (r.uploaderAppUserId ?? '').trim(),
        }))
        .filter((r) => {
          if (!r.id || !r.imageUrl) return false;
          const uploaderNorm = r.uploaderAppUserId
            ? normalizeParticipantId(r.uploaderAppUserId) ?? r.uploaderAppUserId
            : hostNorm;
          return uploaderNorm === hostNorm;
        }),
    [meeting?.settlementInfo?.draftReceipts, hostNorm],
  );

  const isParticipantSettlementDraftSaved = useMemo(() => {
    if (!settlementParticipantMode) return true;
    if (savedParticipantReceiptsForCompare.length !== receiptItems.length) return false;
    for (const row of receiptItems) {
      const saved = savedParticipantReceiptsForCompare.find((r) => r.id === row.id);
      if (!saved) return false;
      if (saved.amountWon !== row.amountWon) return false;
    }
    return true;
  }, [settlementParticipantMode, savedParticipantReceiptsForCompare, receiptItems]);

  const isCurrentSettlementDraftSavedForShare = useMemo(() => {
    const si = meeting?.settlementInfo;
    if (!si) return false;
    const hasSavedDraft =
      si.draftTotalWon != null ||
      si.paymentMethod != null ||
      (si.selectedParticipantIds?.length ?? 0) > 0 ||
      (si.draftReceipts?.length ?? 0) > 0 ||
      normalizeSettlementCompareText(si.hostBankCode).length > 0 ||
      normalizeSettlementCompareDigits(si.hostAccountNumber).length > 0 ||
      normalizeSettlementCompareText(si.hostAccountHolder).length > 0;
    if (!hasSavedDraft) return false;
    if ((si.draftTotalWon ?? null) !== (effectiveTotalWonParsed ?? null)) return false;
    const savedPaymentMethod = si.paymentMethod === 'cash' ? 'cash' : 'bank_transfer';
    if (savedPaymentMethod !== settlementPaymentMethod) return false;
    if (settlementPaymentMethod === 'bank_transfer') {
      if (normalizeSettlementCompareText(si.hostBankCode) !== normalizeSettlementCompareText(hostBankId)) return false;
      if (
        normalizeSettlementCompareDigits(si.hostAccountNumber) !== normalizeSettlementCompareDigits(hostAccountNumber)
      ) {
        return false;
      }
      if (normalizeSettlementCompareText(si.hostAccountHolder) !== normalizeSettlementCompareText(hostAccountHolder)) {
        return false;
      }
    }
    const savedParticipants = sortedSettlementParticipantIds(si.selectedParticipantIds ?? []);
    const currentParticipants = sortedSettlementParticipantIds(activeSplitParticipantIds);
    if (!sameSettlementStringList(savedParticipants, currentParticipants)) return false;
    if (savedSettlementReceiptsForShare.length !== receiptItems.length) return false;
    for (const row of receiptItems) {
      const saved = savedSettlementReceiptsForShare.find((r) => r.id === row.id);
      if (!saved) return false;
      if (saved.amountWon !== row.amountWon) return false;
    }
    return true;
  }, [
    meeting?.settlementInfo,
    effectiveTotalWonParsed,
    settlementPaymentMethod,
    hostBankId,
    hostAccountNumber,
    hostAccountHolder,
    activeSplitParticipantIds,
    receiptItems,
    savedSettlementReceiptsForShare,
  ]);

  const hasUnsavedSettlementChanges =
    settlementHasUnsavedUserChanges &&
    ((canEditSettlement && !isCurrentSettlementDraftSavedForShare) ||
      (settlementParticipantMode && !isParticipantSettlementDraftSaved));

  const requestSettlementBack = useCallback(() => {
    if (!hasUnsavedSettlementChanges) {
      safeRouterBack(router);
      return;
    }
    const leaveMessage = settlementParticipantMode
      ? '임시저장하지 않으면 올린 영수증이 반영되지 않아요. 나가시겠어요?'
      : '임시저장 또는 정산 완료 처리하지 않은 변경사항은 저장되지 않아요. 나가시겠어요?';
    presentAppDialogConfirm({ title: '저장되지 않은 변경', body: leaveMessage, cancelLabel: '계속 작성', confirmLabel: '나가기', confirmVariant: 'destructive', onConfirm: () => safeRouterBack(router) });
  }, [hasUnsavedSettlementChanges, settlementParticipantMode, router]);

  useAndroidOverlayHardwareBack(requestSettlementBack);

  /** 최상단 바: `정산 방식 요약` + 한 칸 + `정산`(모임 미로드·id 불일치 시 `정산`만). */
  const settlementScreenTopBarTitle = useMemo(() => {
    const mid = meetingId.trim();
    if (!meeting?.id?.trim() || meeting.id.trim() !== mid) return '정산';
    const lead = settlementModeSummaryLine.trim();
    return lead ? `${lead} 정산` : '정산';
  }, [meetingId, meeting?.id, settlementModeSummaryLine]);

  const showSettlementTopBarShare =
    meeting?.lifecycleStatus === 'SETTLED' && canViewSettledSettlement && Platform.OS !== 'web';

  const persistSettlementDraftToServer = useCallback(async () => {
    if (!meetingId || !meeting) throw new Error('모임을 찾을 수 없어요.');
    const uid = (userId ?? '').trim();
    if (!uid) throw new Error('로그인이 필요합니다.');
    if (usesBankTransferSettlement && !profileAccounts?.items?.length) {
      throw new Error('정산 계좌를 등록하여 선택해 주세요.');
    }

    const snapshots: MeetingSettlementReceiptItem[] = [];
    const analysisReceipts: {
      receiptId: string;
      imageUrl: string;
      amountWon: number;
      analysis?: SettlementReceiptOcrAnalysis;
    }[] = [];
    for (const row of receiptItems) {
      const rawUri = row.previewUri.trim();
      if (!rawUri) continue;
      let imageUrl = rawUri;
      if (!isRemoteSettlementReceiptImageUri(imageUrl)) {
        if (Platform.OS === 'web') {
          throw new Error('웹에서는 영수증 이미지를 서버에 저장할 수 없어요.');
        }
        imageUrl = await uploadCompressedSettlementReceiptToSupabase({
          meetingId,
          uploaderUserId: uid,
          localImageUri: imageUrl,
          naturalWidth: row.naturalWidth,
        });
      }
      const uploader = (row.uploaderAppUserId ?? hostNorm).trim() || hostNorm;
      snapshots.push({ id: row.id, imageUrl, amountWon: row.amountWon, uploaderAppUserId: uploader });
      analysisReceipts.push({ receiptId: row.id, imageUrl, amountWon: row.amountWon, analysis: row.analysis });
    }

    await persistMeetingSettlementInfoPatch(meetingId, {
      draftTotalWon: effectiveTotalWonParsed ?? undefined,
      paymentMethod: settlementPaymentMethod,
      hostBankCode: usesBankTransferSettlement ? hostBankId.trim() || undefined : null,
      hostAccountNumber: usesBankTransferSettlement
        ? hostAccountNumber.replace(/\D/g, '').trim() || undefined
        : null,
      hostAccountHolder: usesBankTransferSettlement ? hostAccountHolder.trim() || undefined : null,
      hostAccountText: usesBankTransferSettlement ? composedHostAccountText.trim() || undefined : null,
      selectedParticipantIds: selectedCount > 0 ? [...selectedParticipantIds] : undefined,
      draftReceipts: snapshots,
    });
    await syncSettlementReceiptAnalysesToSupabase({
      meetingId,
      uploaderUserId: uid,
      receipts: analysisReceipts,
    });
    if (meeting.confirmedPlaceChipId?.trim()) {
      await persistMeetingLocationDataPatch(meetingId, {
        confirmedPlaceChipId: meeting.confirmedPlaceChipId.trim(),
        placeNameSnapshot: (meeting.placeName ?? meeting.location ?? '').trim() || null,
      });
    }
    settlementSaveGenerationRef.current += 1;
    lastHydratedSettlementKeyRef.current = null;
    await reload();
  }, [
    meetingId,
    meeting,
    userId,
    profileAccounts?.items?.length,
    receiptItems,
    effectiveTotalWonParsed,
    usesBankTransferSettlement,
    hostBankId,
    hostAccountNumber,
    hostAccountHolder,
    composedHostAccountText,
    selectedCount,
    selectedParticipantIds,
    settlementPaymentMethod,
    reload,
  ]);

  const persistParticipantDraftToServer = useCallback(async () => {
    const uid = userId?.trim();
    if (!meetingId || !uid) throw new Error('로그인이 필요해요.');
    const uploaderNorm = normalizeParticipantId(uid) ?? uid;
    const snapshots: MeetingSettlementReceiptItem[] = [];
    const analysisReceipts: {
      receiptId: string;
      imageUrl: string;
      amountWon: number;
      analysis?: SettlementReceiptOcrAnalysis;
    }[] = [];
    for (const row of receiptItems) {
      const rawUri = row.previewUri.trim();
      if (!rawUri) continue;
      let imageUrl = rawUri;
      if (!isRemoteSettlementReceiptImageUri(imageUrl)) {
        if (Platform.OS === 'web') {
          throw new Error('웹에서는 영수증 이미지를 서버에 저장할 수 없어요.');
        }
        imageUrl = await uploadCompressedSettlementReceiptToSupabase({
          meetingId,
          uploaderUserId: uploaderNorm,
          localImageUri: imageUrl,
          naturalWidth: row.naturalWidth,
        });
      }
      snapshots.push({
        id: row.id,
        imageUrl,
        amountWon: row.amountWon,
        uploaderAppUserId: uploaderNorm,
      });
      analysisReceipts.push({
        receiptId: row.id,
        imageUrl,
        amountWon: row.amountWon,
        analysis: row.analysis,
      });
    }
    await persistParticipantSettlementReceipts(meetingId, uploaderNorm, snapshots);
    await syncSettlementReceiptAnalysesToSupabase({
      meetingId,
      uploaderUserId: uploaderNorm,
      receipts: analysisReceipts,
    });
    settlementSaveGenerationRef.current += 1;
    lastHydratedSettlementKeyRef.current = null;
    await reload();
  }, [meetingId, userId, receiptItems, reload]);

  const onSaveDraft = useCallback(async () => {
    if (!meetingId || !meeting) return;
    setSaving(true);
    try {
      if (settlementParticipantMode) {
        await persistParticipantDraftToServer();
      } else {
        await persistSettlementDraftToServer();
      }
      setSettlementHasUnsavedUserChanges(false);
      showTransientBottomMessage('임시 저장했어요.');
    } catch (e) {
      presentAppDialogAlert({ title: '오류', body: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }, [meetingId, meeting, settlementParticipantMode, persistParticipantDraftToServer, persistSettlementDraftToServer]);

  const onSendAppPush = useCallback(async () => {
    if (!meetingId || !meeting || !userId?.trim()) return;
    if (meeting.lifecycleStatus === 'SETTLED') {
      presentAppDialogAlert({ title: '안내', body: '이미 정산 완료된 모임이에요.' });
      return;
    }
    if (selectedCount === 0) {
      presentAppDialogAlert({ title: '알림', body: '정산에 포함할 사람을 한 명 이상 선택해 주세요.' });
      return;
    }
    if (effectiveTotalWonParsed == null) {
      presentAppDialogAlert({ title: '알림', body: '총액을 숫자로 입력해 주세요.' });
      return;
    }
    const hostAccount = composedHostAccountText.trim();
    if (usesBankTransferSettlement && !getSettlementBankById(hostBankId)) {
      presentAppDialogAlert({ title: '알림', body: '입금 은행을 선택해 주세요.' });
      return;
    }
    if (usesBankTransferSettlement && !hostAccountNumber.replace(/\D/g, '').trim()) {
      presentAppDialogAlert({ title: '알림', body: '계좌번호를 입력해 주세요.' });
      return;
    }
    if (usesBankTransferSettlement && !hostAccountHolder.trim()) {
      presentAppDialogAlert({ title: '알림', body: '예금주 이름을 입력해 주세요.' });
      return;
    }
    if (usesBankTransferSettlement && !hostAccount) {
      presentAppDialogAlert({ title: '알림', body: '입금 계좌 정보를 확인해 주세요.' });
      return;
    }
    setPushing(true);
    try {
      await persistSettlementDraftToServer();
      const netSnap: Record<string, number> = {};
      if (useReceiptSplitDisplay) {
        for (const [pid, won] of receiptNetDisplayMap.entries()) {
          netSnap[pid] = won;
        }
        await persistMeetingSettlementInfoPatch(meetingId, { participantNetWonById: netSnap });
      }
      const recipients = [...selectedParticipantIds]
        .filter((id) => id !== hostNorm)
        .slice(0, MAX_SETTLEMENT_PUSH_RECIPIENTS);
      if (recipients.length === 0) {
        presentAppDialogAlert({ title: '알림', body: '앱 알림을 받을 다른 참석자가 없어요. 참석자를 초대한 뒤 다시 시도해 주세요.' });
        return;
      }
      const pushRecipients = recipients.filter((id) => !isGinitWebGuestParticipantId(id));
      if (pushRecipients.length > 0) {
        const title = '정산 안내';
        const body = `「${(meeting.title ?? '').trim() || '모임'}」인당 ${perPersonWon != null ? `${perPersonWon.toLocaleString()}원` : ''} 정산 안내가 도착했어요.`;
        const amountStr = perPersonWon != null ? String(perPersonWon) : String(effectiveTotalWonParsed);
        const data: Record<string, unknown> = {
          action: 'settlement_share',
          type: 'SETTLEMENT',
          settlement_payment_method: settlementPaymentMethod,
          meeting_id: meetingId,
          meetingId,
          amount: amountStr,
        };
        if (usesBankTransferSettlement) {
          data.host_account = maskHolderInHostAccountTextForShare(hostAccount);
        }
        const approx = await dispatchRemotePushToRecipientsWithApproxDelivered({
          toUserIds: pushRecipients,
          title,
          body,
          data,
        });
        if (approx <= 0) {
          presentAppDialogAlert({ title: '알림', body: '푸시가 전달되지 않았어요. 네트워크를 확인한 뒤 다시 시도해 주세요.' });
          return;
        }
      }
      await markMeetingLifecycleSettled(meetingId);
      setSettlementHasUnsavedUserChanges(false);
      void runMeetingsListIncrementalReconcile(queryClient, userId?.trim() ?? null);
      const fresh = await getMeetingById(meetingId);
      if (fresh) setMeeting(fresh);

      const meetingTitle = (meeting.title ?? '').trim() || '모임';
      const reviewRecipientSet = new Set<string>();
      for (const id of selectedParticipantIds) {
        const norm = normalizeParticipantId(String(id)) ?? String(id).trim();
        if (norm && !isGinitWebGuestParticipantId(norm)) reviewRecipientSet.add(norm);
      }
      if (hostNorm && !isGinitWebGuestParticipantId(hostNorm)) reviewRecipientSet.add(hostNorm);
      const reviewRecipients = [...reviewRecipientSet];
      if (reviewRecipients.length > 0) {
        const reviewTitle = '후기를 남겨 주세요';
        const reviewBody = `「${meetingTitle}」장소 후기를 남기고 결과를 확인해 보세요.`;
        const reviewData: Record<string, unknown> = {
          action: 'meeting_place_review',
          type: 'MEETING_REVIEW',
          meeting_id: meetingId,
          meetingId,
        };
        void dispatchRemotePushToRecipientsWithApproxDelivered({
          toUserIds: reviewRecipients,
          title: reviewTitle,
          body: reviewBody,
          data: reviewData,
        });
        void insertMeetingPlaceReviewNotifications({
          meetingId,
          meetingTitle,
          recipientAppUserIds: reviewRecipients,
        });
      }

      const settledMeeting = fresh ?? meeting;
      const navigateAfterSettlementComplete = () => {
        if (isMeetingPlaceReviewEligible(settledMeeting, userId)) {
          router.push(`/meeting-review/${encodeURIComponent(meetingId)}`);
        } else {
          router.back();
        }
      };
      showSettlementInterstitial(() => {
        presentAppDialogConfirm({
          title: '완료',
          body: '참석자에게 알림을 보냈고, 모임을 정산 완료로 표시했어요.',
          cancelLabel: '확인',
          confirmLabel: '확인',
          onConfirm: navigateAfterSettlementComplete,
          onCancel: navigateAfterSettlementComplete,
        });
      });
    } catch (e) {
      presentAppDialogAlert({ title: '오류', body: e instanceof Error ? e.message : String(e) });
    } finally {
      setPushing(false);
    }
  }, [
    meetingId,
    meeting,
    userId,
    selectedCount,
    selectedParticipantIds,
    effectiveTotalWonParsed,
    perPersonWon,
    hostNorm,
    hostBankId,
    hostAccountNumber,
    hostAccountHolder,
    composedHostAccountText,
    usesBankTransferSettlement,
    settlementPaymentMethod,
    persistSettlementDraftToServer,
    useReceiptSplitDisplay,
    receiptNetDisplayMap,
    router,
    queryClient,
  ]);

  const onShareSheet = useCallback(async () => {
    const settled = meeting?.lifecycleStatus === 'SETTLED';
    if (!settled && !isCurrentSettlementDraftSavedForShare) {
      presentAppDialogAlert({ title: '안내', body: '임시 저장 후 공유해주세요.' });
      return;
    }
    if (!meeting) return;
    setSharing(true);
    try {
      let receiptSummaries = settlementShareReceiptSummaries;
      const mid = meetingId.trim();
      if (mid) {
        try {
          const rows = await fetchSettlementReceiptAnalysesFromSupabase(mid);
          const maps = buildSettlementReceiptAnalysisMaps(rows);
          setSettlementReceiptAnalysesById(maps.byId);
          setSettlementReceiptAnalysesByImageUrl(maps.byUrl);
          setSettlementReceiptAnalysesByImageKey(maps.byKey);
          receiptSummaries = buildSettlementShareReceiptSummariesFromRows(receiptItems, maps, {
            hostNorm,
            meeting,
            participantProfiles,
            authDisplayName: authProfile?.displayName,
          });
        } catch {
          /* 캐시된 분석·로컬 OCR로 공유 */
        }
      }
      const msg = buildSettlementShareMessage({
        meetingTitle: meeting.title ?? '',
        scheduleLine: formatMeetingScheduleListLabel(meeting) || null,
        participantCount: selectedCount,
        settlementMethodText: settlementModeSummaryLine,
        paymentMethod: settlementPaymentMethod,
        bankName: selectedBank?.label ?? '',
        accountNumber: hostAccountNumber,
        accountHolder: hostAccountHolder,
        totalWon: effectiveTotalWonParsed,
        participantAmounts: settlementShareParticipantAmounts,
        receiptSummaries,
      });
      await shareSettlementText(msg);
    } catch {
      presentAppDialogAlert({ title: '오류', body: '공유를 완료하지 못했어요.' });
    } finally {
      setSharing(false);
    }
  }, [
    isCurrentSettlementDraftSavedForShare,
    meeting,
    meetingId,
    settlementShareReceiptSummaries,
    settlementShareParticipantAmounts,
    receiptItems,
    hostNorm,
    participantProfiles,
    authProfile?.displayName,
    selectedCount,
    settlementModeSummaryLine,
    settlementPaymentMethod,
    selectedBank?.label,
    hostAccountNumber,
    hostAccountHolder,
    effectiveTotalWonParsed,
  ]);

  const toggleParticipant = useCallback((id: string) => {
    setSettlementHasUnsavedUserChanges(true);
    setSelectedParticipantIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) return prev;
      return next;
    });
  }, []);

  const switchToSplitNTab = useCallback(() => {
    if (settlementAmountTab !== 'split_n') setSettlementHasUnsavedUserChanges(true);
    if (settlementAmountTab === 'manual' && manualSumParsed != null) {
      setTotalWonInput(formatWonInput(String(manualSumParsed)));
    }
    setSettlementAmountTab('split_n');
  }, [settlementAmountTab, manualSumParsed]);

  const switchToManualTab = useCallback(() => {
    if (settlementAmountTab !== 'manual') setSettlementHasUnsavedUserChanges(true);
    const ids = allSettlementParticipantIds.filter((id) => selectedParticipantIds.has(id));
    const nextManual: Record<string, string> = {};
    if (totalWonParsed != null && ids.length > 0) {
      distributeTotalWonEven(totalWonParsed, ids).forEach((v, k) => {
        nextManual[k] = formatWonInput(String(v));
      });
    } else {
      for (const id of ids) nextManual[id] = '';
    }
    setManualAmountsByParticipant(nextManual);
    setSettlementAmountTab('manual');
  }, [allSettlementParticipantIds, selectedParticipantIds, totalWonParsed]);

  const applyBulkManualAmount = useCallback(() => {
    const v = parseWonDigits(bulkAmountDraft);
    if (!bulkAmountDraft.trim() || v <= 0) {
      presentAppDialogAlert({ title: '알림', body: '0보다 큰 금액을 입력해 주세요.' });
      return;
    }
    const ids = allSettlementParticipantIds.filter((id) => selectedParticipantIds.has(id));
    const next: Record<string, string> = { ...manualAmountsByParticipant };
    for (const id of ids) next[id] = formatWonInput(String(v));
    setSettlementHasUnsavedUserChanges(true);
    setManualAmountsByParticipant(next);
    setBulkAmountModalOpen(false);
    setBulkAmountDraft('');
  }, [bulkAmountDraft, allSettlementParticipantIds, selectedParticipantIds, manualAmountsByParticipant]);

  const onPickSettlementAccount = useCallback(
    (id: string) => {
      if (!profileAccounts?.items.length) return;
      const acc = getUserSettlementAccountById(profileAccounts, id);
      if (!acc) return;
      setSettlementHasUnsavedUserChanges(true);
      setSelectedProfileAccountId(acc.id);
      setHostBankId(acc.bankCode);
      setHostAccountNumber(acc.accountNumber.replace(/\D/g, ''));
      setHostAccountHolder(acc.holder);
    },
    [profileAccounts],
  );

  const profileDefaultAccountId = useMemo(() => {
    if (!profileAccounts?.items.length) return null;
    return resolveEffectiveDefaultId(profileAccounts.items, profileAccounts.defaultId);
  }, [profileAccounts]);

  const mergeAccountHint = useCallback((hint: string | null | undefined) => {
    const t = typeof hint === 'string' ? hint.trim() : '';
    if (!t) return;
    const leg = parseSettlementLegacyHostAccountText(t);
    setHostBankId((prev) => (prev.trim() ? prev : leg.bankId ?? ''));
    setHostAccountNumber((prev) => (prev.trim() ? prev : leg.accountNumber || ''));
    setHostAccountHolder((prev) => (prev.trim() ? prev : leg.holder || ''));
  }, []);

  const removeReceiptItem = useCallback((id: string) => {
    setSettlementHasUnsavedUserChanges(true);
    setReceiptItems((prev) => {
      const next = prev.filter((x) => x.id !== id);
      if (next.length === 0) {
        queueMicrotask(() => setTotalWonInput(''));
      }
      return next;
    });
  }, []);

  const processReceiptAssets = useCallback(
    async (assets: ImagePickerAsset[]) => {
      const list = (assets ?? []).filter((a) => a?.uri?.trim());
      if (list.length === 0) return;

      const runId = receiptScanRunIdRef.current + 1;
      receiptScanRunIdRef.current = runId;
      receiptScanLastAutoScrollRef.current = null;
      setOcrBusy(true);
      setReceiptScanPreview({
        assets: list,
        currentIndex: 0,
        processingIndex: 0,
        stage: 'scanning',
        message: '영수증을 스캔하고 있어요.',
        recognizedText: [],
        recognizedTextByIndex: {},
        scanErrorsByIndex: {},
        additions: [],
        accountHint: null,
      });

      const additions: SettlementReceiptAddition[] = [];
      let lastAccountHint: string | null = null;
      const failMessages: string[] = [];
      try {
        for (let index = 0; index < list.length; index += 1) {
          const a = list[index]!;
          setReceiptScanPreview((prev) =>
            prev && receiptScanRunIdRef.current === runId
              ? {
                  ...prev,
                  currentIndex: index,
                  processingIndex: index === 0 ? index : null,
                  stage: 'scanning',
                  message:
                    index > 0
                      ? `${index + 1}번째 영수증으로 이동하고 있어요.`
                      : list.length > 1
                      ? `${index + 1}번째 영수증을 스캔하고 있어요.`
                      : '영수증을 스캔하고 있어요.',
                  recognizedText: [],
                  errorMessage: undefined,
                }
              : prev,
          );
          if (index > 0) {
            await waitReceiptScanSlideTransition();
            if (receiptScanRunIdRef.current !== runId) return;
            setReceiptScanPreview((prev) =>
              prev && receiptScanRunIdRef.current === runId
                ? {
                    ...prev,
                    processingIndex: index,
                    stage: 'scanning',
                    message: `${index + 1}번째 영수증을 스캔하고 있어요.`,
                  }
                : prev,
            );
          }

          const onProgress = (progress: SettlementReceiptOcrProgress) => {
            if (receiptScanRunIdRef.current !== runId) return;
            const recognizedText = compactReceiptOcrText(progress.chunks);
            setReceiptScanPreview((prev) =>
              prev
                ? {
                    ...prev,
                    message:
                      progress.phase === 'ai_analysis'
                        ? '인식한 글씨를 AI가 확인하고 있어요.'
                        : '영수증에서 글씨를 읽고 있어요.',
                    recognizedText,
                    recognizedTextByIndex: {
                      ...prev.recognizedTextByIndex,
                      [index]: recognizedText,
                    },
                  }
                : prev,
            );
          };

          const r = await runSettlementReceiptOcrFromUri(
            a.uri.trim(),
            { width: a.width, height: a.height },
            { onProgress },
          );
          if (receiptScanRunIdRef.current !== runId) return;
          if (!r.ok) {
            if (r.code === 'not_receipt') {
              setReceiptScanPreview((prev) =>
                prev && receiptScanRunIdRef.current === runId
                  ? {
                      ...prev,
                      currentIndex: index,
                      processingIndex: null,
                      stage: 'error',
                      message: '영수증 사진이 아니에요.',
                      additions: [],
                      accountHint: lastAccountHint,
                      errorMessage: r.message,
                      scanErrorsByIndex: {
                        ...prev.scanErrorsByIndex,
                        [index]: r.message,
                      },
                    }
                  : prev,
              );
              return;
            }
            failMessages.push(r.message);
            setReceiptScanPreview((prev) =>
              prev && receiptScanRunIdRef.current === runId
                ? {
                    ...prev,
                    processingIndex: null,
                    message: r.message,
                    scanErrorsByIndex: {
                      ...prev.scanErrorsByIndex,
                      [index]: r.message,
                    },
                  }
                : prev,
            );
            if (list.length > 1 && index < list.length - 1) {
              await waitReceiptScanResultPreview();
            }
            continue;
          }
          if (r.accountHint?.trim()) lastAccountHint = r.accountHint.trim();
          if (r.totalWon != null) {
            const addition: SettlementReceiptAddition = {
              assetIndex: index,
              uri: a.uri.trim(),
              amountWon: r.totalWon,
              naturalWidth: typeof a.width === 'number' && a.width > 0 ? a.width : undefined,
              analysis: r.analysis,
            };
            additions.push(addition);
            setReceiptScanPreview((prev) =>
              prev && receiptScanRunIdRef.current === runId
                ? {
                    ...prev,
                    currentIndex: index,
                    processingIndex: null,
                    message: 'AI가 영수증 내용을 확인했어요.',
                    additions: [...additions],
                    accountHint: lastAccountHint,
                  }
                : prev,
            );
            if (list.length > 1 && index < list.length - 1) {
              await waitReceiptScanResultPreview();
            }
          } else {
            const message = '결제 금액을 찾지 못했어요.';
            failMessages.push(message);
            setReceiptScanPreview((prev) =>
              prev && receiptScanRunIdRef.current === runId
                ? {
                    ...prev,
                    currentIndex: index,
                    processingIndex: null,
                    message,
                    scanErrorsByIndex: {
                      ...prev.scanErrorsByIndex,
                      [index]: message,
                    },
                  }
                : prev,
            );
            if (list.length > 1 && index < list.length - 1) {
              await waitReceiptScanResultPreview();
            }
          }
        }

        if (additions.length === 0) {
          setReceiptScanPreview((prev) =>
            prev && receiptScanRunIdRef.current === runId
              ? {
                  ...prev,
                  stage: 'error',
                  processingIndex: null,
                  message: '금액을 찾지 못했어요.',
                  additions: [],
                  accountHint: lastAccountHint,
                  errorMessage:
                    failMessages[0] ??
                    (list.length > 1
                      ? '선택한 사진에서 금액을 찾지 못했어요. 각 장이 잘 보이게 다시 선택해 주세요.'
                      : '금액·계좌를 자동으로 찾지 못했어요. 직접 입력하거나 다른 각도로 다시 촬영해 보세요.'),
                }
              : prev,
          );
          return;
        }

        setReceiptScanPreview((prev) =>
          prev && receiptScanRunIdRef.current === runId
            ? {
                ...prev,
                currentIndex: list.length > 1 ? list.length : 0,
                processingIndex: null,
                stage: 'ready',
                message: 'AI가 영수증 내용을 확인했어요.',
                additions,
                accountHint: lastAccountHint,
                errorMessage: failMessages[0],
              }
            : prev,
        );
      } catch (e) {
        setReceiptScanPreview((prev) =>
          prev && receiptScanRunIdRef.current === runId
            ? {
                ...prev,
                stage: 'error',
                processingIndex: null,
                message: '영수증 인식에 실패했어요.',
                additions,
                accountHint: lastAccountHint,
                errorMessage: e instanceof Error ? e.message : '잠시 후 다시 시도해 주세요.',
              }
            : prev,
        );
      } finally {
        if (receiptScanRunIdRef.current === runId) {
          setOcrBusy(false);
        }
      }
    },
    [],
  );

  const closeReceiptScanPreview = useCallback(() => {
    receiptScanRunIdRef.current += 1;
    receiptScanLastAutoScrollRef.current = null;
    setOcrBusy(false);
    setReceiptScanPreview(null);
  }, []);

  const applyReceiptScanPreview = useCallback(() => {
    if (!receiptScanPreview || receiptScanPreview.stage !== 'ready' || receiptScanPreview.additions.length === 0) {
      return;
    }
    mergeAccountHint(receiptScanPreview.accountHint);
    const uploader = hostNorm || normalizeParticipantId(userId?.trim() ?? '') || '';
    const rows: SettlementReceiptRow[] = receiptScanPreview.additions.map((x) => ({
      id: newSettlementReceiptId(),
      previewUri: x.uri,
      amountWon: x.amountWon,
      uploaderAppUserId: uploader || undefined,
      naturalWidth: x.naturalWidth,
      analysis: x.analysis,
    }));
    setSettlementHasUnsavedUserChanges(true);
    setReceiptItems((prev) => [...prev, ...rows]);
    setReceiptScanPreview(null);
  }, [mergeAccountHint, receiptScanPreview, hostNorm, userId]);

  const pickReceiptImageAndOcr = useCallback(
    async (source: 'camera' | 'library') => {
      if (Platform.OS === 'web') {
        presentAppDialogAlert({ title: '안내', body: '영수증 촬영 인식은 iOS·Android 앱에서만 지원해요.' });
        return;
      }
      const perm =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        presentAppDialogAlert({ title: '권한', body: source === 'camera' ? '카메라 권한이 필요해요.' : '사진 접근 권한이 필요해요.' });
        return;
      }
      const launched =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 })
          : await launchImageLibraryAsyncSafe({
              mediaTypes: ['images'],
              quality: 0.85,
              allowsMultipleSelection: true,
              selectionLimit: MAX_RECEIPT_IMAGES_PER_BATCH,
            });
      if (launched.canceled || !launched.assets?.length) return;
      await processReceiptAssets(launched.assets);
    },
    [processReceiptAssets],
  );

  const onPressReceiptOcr = useCallback(() => {
    if (Platform.OS === 'web') {
      void pickReceiptImageAndOcr('library');
      return;
    }
    presentAppDialogThreeButton({
      title: '영수증 인식',
      body: '촬영 또는 앨범에서 영수증을 선택해 주세요.',
      buttons: [
        {
          label: '촬영',
          icon: 'camera',
          variant: 'primary',
          onPress: () => void pickReceiptImageAndOcr('camera'),
        },
        {
          label: '앨범',
          icon: 'images-outline',
          variant: 'primary',
          onPress: () => void pickReceiptImageAndOcr('library'),
        },
        { label: '취소', icon: 'close', variant: 'secondary' },
      ],
    });
  }, [pickReceiptImageAndOcr]);

  const receiptScanPageWidth = Math.max(280, windowWidth - 36);
  const receiptScanPageCount = receiptScanPreview
    ? receiptScanPreview.stage === 'ready'
      ? receiptScanPreview.assets.length > 1
        ? receiptScanPreview.assets.length + 1
        : receiptScanPreview.assets.length
      : receiptScanPreview.assets.length
    : 0;
  const receiptScanTotalWon = (receiptScanPreview?.additions ?? []).reduce((sum, x) => sum + x.amountWon, 0);
  const receiptScanCurrentPage = Math.min(receiptScanPreview?.currentIndex ?? 0, Math.max(receiptScanPageCount - 1, 0));

  useEffect(() => {
    if (!receiptScanPreview || receiptScanPageCount <= 0) return;
    const last = receiptScanLastAutoScrollRef.current;
    if (last?.page === receiptScanCurrentPage && last.width === receiptScanPageWidth) return;
    receiptScanLastAutoScrollRef.current = { page: receiptScanCurrentPage, width: receiptScanPageWidth };
    const frame = requestAnimationFrame(() => {
      receiptScanPagerRef.current?.scrollTo({
        x: receiptScanCurrentPage * receiptScanPageWidth,
        animated: true,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [receiptScanCurrentPage, receiptScanPageCount, receiptScanPageWidth]);

  if (!meetingId) {
    return (
      <ScreenShell padded={false} style={styles.rootShell}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <SettlementAccountsScreenTopBar title={settlementScreenTopBarTitle} onBack={() => safeRouterBack(router)} />
          <View style={styles.center}>
            <Text style={styles.muted}>모임을 찾을 수 없어요.</Text>
          </View>
        </SafeAreaView>
      </ScreenShell>
    );
  }

  if (loading || !meeting) {
    return (
      <ScreenShell padded={false} style={styles.rootShell}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <SettlementAccountsScreenTopBar title={settlementScreenTopBarTitle} onBack={() => safeRouterBack(router)} />
          <View style={styles.center}>
            <ActivityIndicator color={GinitTheme.colors.primary} />
          </View>
        </SafeAreaView>
      </ScreenShell>
    );
  }

  if (!canEditSettlement && !canCollaborateSettlement && !canViewSettledSettlement) {
    return (
      <ScreenShell padded={false} style={styles.rootShell}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <SettlementAccountsScreenTopBar title={settlementScreenTopBarTitle} onBack={() => safeRouterBack(router)} />
          <View style={[styles.padded, { paddingTop: 12 }]}>
            <Text style={styles.body}>
              이 모임에서는 정산을 진행할 수 없어요. 참여 중인 모임이고 일정 확정·시작 후 일정 시간이 지나야 해요.
            </Text>
            <GinitPressable onPress={() => safeRouterBack(router)} style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.88 }]}>
              <Text style={styles.primaryBtnText}>돌아가기</Text>
            </GinitPressable>
          </View>
        </SafeAreaView>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell padded={false} style={styles.rootShell}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <SettlementAccountsScreenTopBar
          title={settlementScreenTopBarTitle}
          onBack={requestSettlementBack}
          onShare={showSettlementTopBarShare ? onShareSheet : undefined}
          sharing={showSettlementTopBarShare ? sharing : false}
        />
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled>
          <MeetingArrivalVerifyTopSummary
            meeting={meeting}
            hidePlaceDetails
            titleText={settlementMeetingTitleLine}
            titleStyle={styles.settlementMeetingTitle}
            onOpenPlaceUrl={(url, title) => {
              if (!meeting) return;
              const state = placeDetailPopupStateFromMeeting(meeting, url, title);
              if (state) setPlaceDetailPopup(state);
            }}
          />
          <View style={styles.settlementFormBlock}>
            {settlementReadOnly ? (
              <View style={styles.readonlyTotalBlock}>
                <Text style={styles.sectionLabelInRow}>총 금액</Text>
                <View style={styles.totalHeroInputRow}>
                  <Text style={styles.totalHeroSum} numberOfLines={1}>
                    {effectiveTotalWonParsed != null ? effectiveTotalWonParsed.toLocaleString() : '0'}
                  </Text>
                  <Text style={styles.totalHeroUnit}>원</Text>
                </View>
                <Text style={styles.totalHeroHint}>
                  {settlementModeSummaryLine} · {selectedCount.toLocaleString()}명
                </Text>
              </View>
            ) : settlementParticipantMode ? (
              <View style={styles.readonlyTotalBlock}>
                <Text style={styles.sectionLabelInRow}>함께 정산하기</Text>
                <Text style={styles.totalHeroHint}>
                  내 영수증을 올리고 임시 저장해 주세요. 정산 완료는 호스트만 진행할 수 있어요.
                </Text>
                {useReceiptSplitDisplay ? (
                  <Text style={[styles.totalHeroHint, { marginTop: 8 }]}>
                    총 영수증 {mergedDraftReceiptsForSplit.reduce((s, r) => s + r.amountWon, 0).toLocaleString()}원 ·{' '}
                    {selectedCount.toLocaleString()}명
                  </Text>
                ) : null}
              </View>
            ) : (
              <>
                <View style={styles.amountTabRow}>
                  <GinitPressable
                    onPress={switchToSplitNTab}
                    style={({ pressed }) => [
                      styles.amountTab,
                      settlementAmountTab === 'split_n' && styles.amountTabSelected,
                      pressed && { opacity: 0.86 },
                    ]}>
                    <Text
                      style={[
                        styles.amountTabLabel,
                        settlementAmountTab === 'split_n' && styles.amountTabLabelSelected,
                      ]}>
                      1/N 하기
                    </Text>
                  </GinitPressable>
                  <GinitPressable
                    onPress={switchToManualTab}
                    style={({ pressed }) => [
                      styles.amountTab,
                      settlementAmountTab === 'manual' && styles.amountTabSelected,
                      pressed && { opacity: 0.86 },
                    ]}>
                    <Text
                      style={[
                        styles.amountTabLabel,
                        settlementAmountTab === 'manual' && styles.amountTabLabelSelected,
                      ]}>
                      직접 입력
                    </Text>
                  </GinitPressable>
                </View>

                {settlementAmountTab === 'split_n' ? (
                  <View style={styles.totalHeroInputRow}>
                    <TextInput
                      value={formatWonInput(totalWonInput)}
                      onChangeText={(t) => {
                        setSettlementHasUnsavedUserChanges(true);
                        setTotalWonInput(formatWonInput(t));
                      }}
                      keyboardType="number-pad"
                      placeholder="0"
                      placeholderTextColor={GinitTheme.colors.textMuted}
                      style={styles.totalHeroInput}
                      textAlign="right"
                    />
                    <Text style={styles.totalHeroUnit}>원</Text>
                  </View>
                ) : (
                  <>
                    <View style={styles.totalHeroInputRow}>
                      <Text style={styles.totalHeroSum} numberOfLines={1}>
                        {manualSumParsed != null ? manualSumParsed.toLocaleString() : '0'}
                      </Text>
                      <Text style={styles.totalHeroUnit}>원</Text>
                    </View>
                    <Text style={styles.totalHeroHint}>아래에서 각 인원 금액을 입력하세요.</Text>
                  </>
                )}
              </>
            )}
            <View style={styles.sectionLabelRow}>
              <Text style={styles.sectionLabelInRow}>
                {settlementReadOnly ? '정산 대상' : '정산 대상 선택'} {selectedCount}
              </Text>
              {!settlementReadOnly && settlementAmountTab === 'manual' ? (
                <GinitPressable
                  onPress={() => setBulkAmountModalOpen(true)}
                  hitSlop={6}
                  style={({ pressed }) => [pressed && { opacity: 0.86 }]}>
                  <Text style={styles.bulkEditLink}>{selectedCount}명 한번에 입력</Text>
                </GinitPressable>
              ) : (
                <View style={styles.sectionLabelRowSpacer} />
              )}
            </View>

            {settlementParticipantDisplayIds.length === 0 ? (
              <Text style={styles.muted}>참석자 정보가 없습니다.</Text>
            ) : (
              settlementParticipantDisplayIds.map((pid) => {
                const createdBy = meeting.createdBy?.trim() ?? '';
                const hostPid = normalizeParticipantId(createdBy) ?? createdBy;
                const isMeetingHostRow = pid === hostPid;
                const isSelfRow = pid === hostNorm;
                const profile = participantProfiles.get(pid);
                const nick =
                  profile?.nickname?.trim() ||
                  (isMeetingHostRow ? authProfile?.displayName?.trim() ?? '' : '') ||
                  pid;
                const displayName = isSelfRow ? `${nick} (나)` : nick;
                const photoUrl = profile?.photoUrl?.trim() || (isSelfRow ? authProfile?.photoUrl?.trim() ?? '' : '');
                const avatarInitial = displayName.trim().slice(0, 1) || '친';
                const on =
                  settlementReadOnly || settlementParticipantMode ? true : selectedParticipantIds.has(pid);
                const splitWon = splitDisplayMap.get(pid);
                const receiptNet = receiptNetDisplayMap.get(pid);
                return (
                  <View key={pid} style={styles.participantAmountRow}>
                    <GinitPressable
                      onPress={
                        settlementReadOnly || settlementParticipantMode ? undefined : () => toggleParticipant(pid)
                      }
                      disabled={settlementReadOnly || settlementParticipantMode}
                      style={({ pressed }) => [styles.participantRowLeft, pressed && { opacity: 0.86 }]}>
                      <View style={[styles.participantAvatarWrap, !on && styles.participantAvatarWrapOff]}>
                        {photoUrl ? (
                          <Image source={{ uri: photoUrl }} style={styles.participantAvatarImg} contentFit="cover" />
                        ) : (
                          <View style={styles.participantAvatarFallback}>
                            <Text style={styles.participantAvatarInitial}>{avatarInitial}</Text>
                          </View>
                        )}
                        {on ? (
                          <View style={styles.participantAvatarCheckBadge}>
                            <GinitSymbolicIcon name="checkmark" size={11} color={GinitTheme.colors.bg} />
                          </View>
                        ) : null}
                      </View>
                      <View style={styles.participantNameCol}>
                        <Text style={styles.rowLabel} numberOfLines={1}>
                          {displayName}
                        </Text>
                        <Text style={styles.rowIdLabel} numberOfLines={1}>
                          {pid}
                        </Text>
                      </View>
                    </GinitPressable>
                    {useReceiptSplitDisplay ? (
                      <Text style={styles.participantWonText} numberOfLines={2}>
                        {settlementReadOnly
                          ? formatSettlementReadonlyParticipantNet(receiptNet ?? 0)
                          : formatSettlementNetWonLabel(receiptNet ?? 0)}
                      </Text>
                    ) : settlementAmountTab === 'split_n' ? (
                      <Text style={styles.participantWonText} numberOfLines={1}>
                        {splitWon != null ? `${splitWon.toLocaleString()}원` : '—'}
                      </Text>
                    ) : canEditSettlement ? (
                      <TextInput
                        value={formatWonInput(manualAmountsByParticipant[pid] ?? '')}
                        onChangeText={(t) => {
                          setSettlementHasUnsavedUserChanges(true);
                          setManualAmountsByParticipant((prev) => ({
                            ...prev,
                            [pid]: formatWonInput(t),
                          }));
                        }}
                        keyboardType="number-pad"
                        placeholder="0"
                        placeholderTextColor={GinitTheme.colors.textMuted}
                        style={styles.participantWonInput}
                        textAlign="right"
                      />
                    ) : (
                      <Text style={styles.participantWonText} numberOfLines={1}>
                        —
                      </Text>
                    )}
                  </View>
                );
              })
            )}
      {Platform.OS !== 'web' && (!settlementReadOnly || receiptItems.length > 0 || otherParticipantsReceipts.length > 0) ? (
        <>
          {!settlementReadOnly ? (
            <>
              <GinitPressable
                onPress={onPressReceiptOcr}
                disabled={ocrBusy}
                style={({ pressed }) => [styles.secondaryBtn, (pressed || ocrBusy) && { opacity: 0.86 }]}>
                <View style={styles.ocrRow}>
                  <GinitSymbolicIcon name="camera" size={20} color={GinitTheme.colors.primary} />
                  <Text style={styles.secondaryBtnText}>{ocrBusy ? '인식 중…' : '영수증 촬영·앨범에서 입력'}</Text>
                </View>
              </GinitPressable>
              <Text style={styles.ocrHint}>
                {settlementParticipantMode
                  ? '내 영수증만 올릴 수 있어요. 여러 장 선택 가능하며, 임시 저장 후 다른 참여자와 분배가 갱신됩니다.'
                  : '여러 장 선택 가능합니다. 인식된 금액은 총액에 합산되며, 아래 썸네일의 X로 삭제하면 해당 금액만큼 차감됩니다. 결과는 반드시 확인해 주세요.'}
              </Text>
            </>
          ) : null}
          {settlementParticipantMode && hostCollaborationReceiptRows.length > 0 ? (
            <>
              <Text style={[styles.sectionLabelInRow, styles.receiptSubtitle]}>호스트 영수증</Text>
              <View style={styles.receiptReadonlyList}>
                {hostCollaborationReceiptRows.map((it, index) => {
                  const savedAnalysis = lookupSettlementReceiptAnalysis(it, settlementReceiptAnalysisMaps);
                  const analysis = savedAnalysis?.analysis ?? it.analysis;
                  const storeName =
                    savedAnalysis?.storeName?.trim() || analysis?.verification.store_name?.trim() || '상호명 미인식';
                  const bizNum = savedAnalysis?.bizNum?.trim() || analysis?.verification.biz_num?.trim() || '사업자번호 미인식';
                  const visitedAt =
                    savedAnalysis?.receiptDateText?.trim() || analysis?.verification.datetime?.trim() || '방문 시점 미인식';
                  const amountWon = analysis?.billing.total_amount ?? savedAnalysis?.amountWon ?? it.amountWon;
                  const viewerIndex = receiptItems.length + index;
                  return (
                    <View key={it.id} style={styles.receiptReadonlyCard}>
                      <GinitPressable
                        onPress={() => setReceiptImageViewerIndex(viewerIndex)}
                        style={({ pressed }) => [styles.receiptReadonlyImagePressable, pressed && { opacity: 0.88 }]}
                        accessibilityRole="imagebutton"
                        accessibilityLabel="영수증 확대 보기">
                        <Image source={{ uri: it.previewUri }} style={styles.receiptReadonlyImg} contentFit="contain" />
                        <SettlementReceiptUploaderBadge
                          uploaderAppUserId={it.uploaderAppUserId}
                          hostNorm={hostNorm}
                          meeting={meeting}
                          participantProfiles={participantProfiles}
                          authDisplayName={authProfile?.displayName}
                          authPhotoUrl={authProfile?.photoUrl}
                        />
                      </GinitPressable>
                      <View style={styles.receiptReadonlyInfo}>
                        <View style={styles.receiptReadonlyTopRow}>
                          <Text style={styles.receiptReadonlyStore} numberOfLines={1}>
                            {storeName}
                          </Text>
                          <Text style={styles.receiptReadonlyAmount} numberOfLines={1}>
                            {amountWon.toLocaleString()}원
                          </Text>
                        </View>
                        <Text style={styles.receiptReadonlyMeta} numberOfLines={1}>
                          {bizNum}
                        </Text>
                        <Text style={styles.receiptReadonlyMeta} numberOfLines={1}>
                          {visitedAt}
                        </Text>
                        <Text style={styles.receiptReadonlyTags} numberOfLines={2}>
                          {summarizeReceiptAnalysisTags(analysis)}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </>
          ) : null}
          {settlementParticipantMode && otherParticipantsReceipts.length > 0 ? (
            <View style={{ marginBottom: 12 }}>
              <Text style={styles.sectionLabelInRow}>다른 참여자 영수증</Text>
              <Text style={styles.muted}>
                {otherParticipantsReceipts
                  .map((r) => `${r.amountWon.toLocaleString()}원`)
                  .join(' · ')}
              </Text>
            </View>
          ) : null}
          {receiptItems.length > 0 ? (
            <>
              {settlementReadOnly ? <Text style={[styles.sectionLabelInRow, styles.receiptSubtitle]}>영수증</Text> : null}
              {settlementReadOnly ? (
                <View style={styles.receiptReadonlyList}>
                  {receiptItems.map((it, index) => {
                    const savedAnalysis = lookupSettlementReceiptAnalysis(it, settlementReceiptAnalysisMaps);
                    const analysis = savedAnalysis?.analysis ?? it.analysis;
                    const storeName =
                      savedAnalysis?.storeName?.trim() || analysis?.verification.store_name?.trim() || '상호명 미인식';
                    const bizNum = savedAnalysis?.bizNum?.trim() || analysis?.verification.biz_num?.trim() || '사업자번호 미인식';
                    const visitedAt =
                      savedAnalysis?.receiptDateText?.trim() || analysis?.verification.datetime?.trim() || '방문 시점 미인식';
                    const amountWon = analysis?.billing.total_amount ?? savedAnalysis?.amountWon ?? it.amountWon;
                    return (
                      <View key={it.id} style={styles.receiptReadonlyCard}>
                        <GinitPressable
                          onPress={() => setReceiptImageViewerIndex(index)}
                          style={({ pressed }) => [styles.receiptReadonlyImagePressable, pressed && { opacity: 0.88 }]}
                          accessibilityRole="imagebutton"
                          accessibilityLabel="영수증 확대 보기">
                          <Image source={{ uri: it.previewUri }} style={styles.receiptReadonlyImg} contentFit="contain" />
                          <SettlementReceiptUploaderBadge
                            uploaderAppUserId={it.uploaderAppUserId}
                            hostNorm={hostNorm}
                            meeting={meeting}
                            participantProfiles={participantProfiles}
                            authDisplayName={authProfile?.displayName}
                            authPhotoUrl={authProfile?.photoUrl}
                          />
                        </GinitPressable>
                        <View style={styles.receiptReadonlyInfo}>
                          <View style={styles.receiptReadonlyTopRow}>
                            <Text style={styles.receiptReadonlyStore} numberOfLines={1}>
                              {storeName}
                            </Text>
                            <Text style={styles.receiptReadonlyAmount} numberOfLines={1}>
                              {amountWon.toLocaleString()}원
                            </Text>
                          </View>
                          <Text style={styles.receiptReadonlyMeta} numberOfLines={1}>
                            {bizNum}
                          </Text>
                          <Text style={styles.receiptReadonlyMeta} numberOfLines={1}>
                            {visitedAt}
                          </Text>
                          <Text style={styles.receiptReadonlyTags} numberOfLines={2}>
                            {summarizeReceiptAnalysisTags(analysis)}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <ScrollView
                  horizontal
                  nestedScrollEnabled
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.receiptThumbRow}>
                  {receiptItems.map((it, index) => (
                    <View key={it.id} style={styles.receiptThumbColumn}>
                      <View style={styles.receiptThumbImageShell}>
                        <GinitPressable
                          onPress={() => setReceiptImageViewerIndex(index)}
                          style={({ pressed }) => [styles.receiptThumbImagePressable, pressed && { opacity: 0.88 }]}
                          accessibilityRole="imagebutton"
                          accessibilityLabel="영수증 확대 보기">
                          <Image source={{ uri: it.previewUri }} style={styles.receiptThumbImg} contentFit="contain" />
                          <SettlementReceiptUploaderBadge
                            uploaderAppUserId={it.uploaderAppUserId}
                            hostNorm={hostNorm}
                            meeting={meeting}
                            participantProfiles={participantProfiles}
                            authDisplayName={authProfile?.displayName}
                            authPhotoUrl={authProfile?.photoUrl}
                          />
                        </GinitPressable>
                        <GinitPressable
                          onPress={() => removeReceiptItem(it.id)}
                          hitSlop={8}
                          style={styles.receiptRemoveBadge}
                          accessibilityRole="button"
                          accessibilityLabel="영수증 삭제">
                          <View style={styles.receiptRemoveCircle}>
                            <GinitSymbolicIcon name="close" size={12} color="#fff" />
                          </View>
                        </GinitPressable>
                      </View>
                      <Text style={styles.receiptThumbCaption} numberOfLines={1}>
                        {it.amountWon.toLocaleString()}원
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              )}
            </>
          ) : null}
        </>
      ) : null}

            {settlementReadOnly ? (
              <View style={styles.readonlySettlementInfoList}>
                <View style={styles.readonlySettlementInfoRow}>
                  <Text style={styles.readonlySettlementLabel}>{viewerSettlementSummary.label}</Text>
                  <Text style={styles.readonlySettlementValue}>{viewerSettlementSummary.value}</Text>
                </View>
                <View style={styles.readonlySettlementInfoRow}>
                  <Text style={styles.readonlySettlementLabel}>정산 방식</Text>
                  <Text style={styles.readonlySettlementValue}>{settlementModeSummaryLine}</Text>
                </View>
                {settlementAccountTextForReadOnly ? (
                  <View style={styles.readonlySettlementInfoRowLast}>
                    <Text style={styles.readonlySettlementLabel}>입금 계좌</Text>
                    <Text style={styles.readonlySettlementValue} numberOfLines={2}>
                      {maskedSettlementAccountTextForReadOnly}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {canEditSettlement ? (
              <>
            <View style={styles.paymentMethodBlock}>
              <Text style={styles.sectionLabelInRow}>지불 방식</Text>
              <View style={styles.paymentMethodRow}>
                <GinitPressable
                  onPress={() => {
                    if (settlementPaymentMethod !== 'cash') setSettlementHasUnsavedUserChanges(true);
                    setSettlementPaymentMethod('cash');
                  }}
                  style={({ pressed }) => [
                    styles.paymentMethodOption,
                    settlementPaymentMethod === 'cash' && styles.paymentMethodOptionSelected,
                    pressed && { opacity: 0.86 },
                  ]}>
                  <Text
                    style={[
                      styles.paymentMethodOptionText,
                      settlementPaymentMethod === 'cash' && styles.paymentMethodOptionTextSelected,
                    ]}>
                    현금
                  </Text>
                </GinitPressable>
                <GinitPressable
                  onPress={() => {
                    if (settlementPaymentMethod !== 'bank_transfer') setSettlementHasUnsavedUserChanges(true);
                    setSettlementPaymentMethod('bank_transfer');
                  }}
                  style={({ pressed }) => [
                    styles.paymentMethodOption,
                    settlementPaymentMethod === 'bank_transfer' && styles.paymentMethodOptionSelected,
                    pressed && { opacity: 0.86 },
                  ]}>
                  <Text
                    style={[
                      styles.paymentMethodOptionText,
                      settlementPaymentMethod === 'bank_transfer' && styles.paymentMethodOptionTextSelected,
                    ]}>
                    계좌이체
                  </Text>
                </GinitPressable>
              </View>
            </View>

            {usesBankTransferSettlement ? (
              profileAccounts === null ? (
                <Text style={styles.muted}>정산 계좌 불러오는 중…</Text>
              ) : profileAccounts.items.length === 0 ? (
                <View style={styles.accountEmptyBlock}>
                  <Text style={styles.accountEmptyHint}>정산 계좌를 등록하여 선택하세요.</Text>
                  <GinitPressable
                    onPress={() => router.push('/settlement/accounts')}
                    style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.86 }]}>
                    <Text style={styles.secondaryBtnText}>정산 계좌 등록·관리</Text>
                  </GinitPressable>
                </View>
              ) : (
                <>
                  <GinitPressable
                    onPress={() => {
                      setAccountPickerAnimationType('slide');
                      setAccountPickerOpen(true);
                    }}
                    style={({ pressed }) => [styles.input, styles.bankRow, pressed && { opacity: 0.86 }]}>
                    {selectedBank ? (
                      <>
                        <SettlementBankLogo
                          faviconDomain={selectedBank.faviconDomain}
                          fallbackLetter={selectedBank.label}
                          brandColor={selectedBank.brandColor}
                          size={28}
                        />
                        <View style={styles.accountPickMid}>
                          <Text style={styles.accountPickTitle} numberOfLines={1}>
                            {selectedBank.label}
                          </Text>
                          <Text style={styles.accountPickSub}>
                            {hostAccountNumber.trim()}
                            {maskedHostAccountHolder ? ` · ${maskedHostAccountHolder}` : ''}
                          </Text>
                        </View>
                        {profileDefaultAccountId && selectedProfileAccountId === profileDefaultAccountId ? (
                          <Text style={styles.defaultBadgeInline}>대표</Text>
                        ) : (
                          <View style={styles.defaultBadgeSpacer} />
                        )}
                      </>
                    ) : (
                      <Text style={styles.bankPlaceholder}>계좌를 선택하세요</Text>
                    )}
                    <GinitSymbolicIcon name="chevron-down" size={20} color={GinitTheme.colors.textMuted} />
                  </GinitPressable>
                </>
              )
            ) : null}
              </>
            ) : null}

            {(canEditSettlement || settlementParticipantMode) && !settlementReadOnly ? (
              <>
                <View style={styles.actionDivider} />
                <GinitPressable
                  onPress={onSaveDraft}
                  disabled={saving}
                  style={({ pressed }) => [styles.secondaryBtn, (pressed || saving) && { opacity: 0.86 }]}>
                  <View style={styles.actionBtnContent}>
                    <GinitSymbolicIcon name="save-outline" size={17} color={GinitTheme.colors.text} />
                    <Text style={styles.secondaryBtnText}>{saving ? '저장 중…' : '임시저장'}</Text>
                  </View>
                </GinitPressable>
              </>
            ) : null}

            {canEditSettlement ? (
              <>
                <GinitPressable
                  onPress={onSendAppPush}
                  disabled={pushing}
                  style={({ pressed }) => [styles.primaryBtn, (pressed || pushing) && { opacity: 0.88 }]}>
                  <Text style={styles.primaryBtnText}>
                    {pushing ? '전송 중…' : '앱 알림 보내기(정산 완료 처리)'}
                  </Text>
                </GinitPressable>
                <GinitPressable
                  onPress={onShareSheet}
                  disabled={sharing}
                  style={({ pressed }) => [styles.secondaryBtn, (pressed || sharing) && { opacity: 0.86 }]}>
                  <View style={styles.actionBtnContent}>
                    <GinitSymbolicIcon name="share-outline" size={17} color={GinitTheme.colors.text} />
                    <Text style={styles.secondaryBtnText}>{sharing ? '공유 중…' : '카카오톡 등으로 공유'}</Text>
                  </View>
                </GinitPressable>
              </>
            ) : null}

            {showSettlementReviewCard ? (
              <View style={styles.reviewPromptCard}>
                <Text style={styles.reviewPromptTitle}>이번 모임 장소는 어땠나요?</Text>
                <Text style={styles.reviewPromptSub}>한 줄 평가로 추억을 남겨 보세요</Text>
                <GinitPressable
                  onPress={() => router.push(`/meeting-review/${encodeURIComponent(meetingId)}`)}
                  style={({ pressed }) => [styles.primaryBtn, styles.reviewPromptBtn, pressed && { opacity: 0.88 }]}>
                  <Text style={styles.primaryBtnText}>후기 남기기</Text>
                </GinitPressable>
              </View>
            ) : null}
          </View>
        </ScrollView>
        <Modal
          visible={bulkAmountModalOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setBulkAmountModalOpen(false)}>
          <GinitPressable
            style={styles.bulkModalBackdrop}
            onPress={() => setBulkAmountModalOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="닫기">
            <GinitPressable onPress={() => {}} style={styles.bulkModalCard} accessibilityRole="none">
              <Text style={styles.bulkModalTitle}>동일 금액</Text>
              <TextInput
                value={formatWonInput(bulkAmountDraft)}
                onChangeText={(t) => setBulkAmountDraft(formatWonInput(t))}
                keyboardType="number-pad"
                placeholder="금액(원)"
                placeholderTextColor={GinitTheme.colors.textMuted}
                style={styles.input}
              />
              <View style={styles.bulkModalActions}>
                <GinitPressable
                  onPress={() => setBulkAmountModalOpen(false)}
                  style={({ pressed }) => [styles.secondaryBtn, styles.bulkModalBtn, pressed && { opacity: 0.86 }]}>
                  <Text style={styles.secondaryBtnText}>취소</Text>
                </GinitPressable>
                <GinitPressable
                  onPress={() => applyBulkManualAmount()}
                  style={({ pressed }) => [styles.primaryBtn, styles.bulkModalBtn, pressed && { opacity: 0.88 }]}>
                  <Text style={styles.primaryBtnText}>적용</Text>
                </GinitPressable>
              </View>
            </GinitPressable>
          </GinitPressable>
        </Modal>
        <Modal
          visible={receiptScanPreview != null}
          transparent
          animationType="fade"
          onRequestClose={closeReceiptScanPreview}>
          <GestureHandlerRootView style={styles.receiptScanModalRoot}>
            <View
              style={[
                styles.receiptScanModalBackdrop,
                { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 },
              ]}>
              <View style={styles.receiptScanModalCard}>
                <View style={styles.receiptScanHeader}>
                  <View style={styles.receiptScanHeaderTextCol}>
                    <Text style={styles.receiptScanTitle}>영수증 인식</Text>
                    <Text style={styles.receiptScanSubtitle}>
                      {receiptScanPageCount > 0 ? `${receiptScanCurrentPage + 1} / ${receiptScanPageCount}` : '0 / 0'}
                    </Text>
                  </View>
                  <GinitPressable
                    onPress={closeReceiptScanPreview}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="영수증 인식 닫기">
                    <GinitSymbolicIcon name="close" size={22} color={GinitTheme.colors.text} />
                  </GinitPressable>
                </View>

                {receiptScanPreview ? (
                  <ScrollView
                    ref={receiptScanPagerRef}
                    horizontal
                    pagingEnabled
                    nestedScrollEnabled
                    showsHorizontalScrollIndicator={false}
                    scrollEnabled={receiptScanPageCount > 1}
                    style={styles.receiptScanPager}
                    onMomentumScrollEnd={(event) => {
                      const nextIndex = Math.round(event.nativeEvent.contentOffset.x / receiptScanPageWidth);
                      setReceiptScanPreview((prev) =>
                        prev ? { ...prev, currentIndex: Math.max(0, Math.min(nextIndex, receiptScanPageCount - 1)) } : prev,
                      );
                    }}>
                    {receiptScanPreview.assets.map((asset, index) => {
                      const addition = findReceiptScanAdditionByAssetIndex(receiptScanPreview.additions, index);
                      const recognizedText = receiptScanPreview.recognizedTextByIndex[index] ?? [];
                      const pageError = receiptScanPreview.scanErrorsByIndex[index];
                      const isScanning =
                        receiptScanPreview.stage === 'scanning' &&
                        receiptScanPreview.processingIndex === index &&
                        !addition &&
                        !pageError;

                      return (
                        <View key={`${asset.uri}-${index}`} style={[styles.receiptScanPage, { width: receiptScanPageWidth }]}>
                          <View style={styles.receiptScanImageShell}>
                            <Image source={{ uri: asset.uri }} style={styles.receiptScanImage} contentFit="contain" />
                            <SettlementReceiptScanOverlay active={isScanning} />
                          </View>

                          <ScrollView
                            style={styles.receiptScanBodyScroll}
                            contentContainerStyle={styles.receiptScanBody}
                            showsVerticalScrollIndicator={false}>
                            {addition ? (
                              <>
                                <View style={styles.receiptScanResultCard}>
                                  <View style={styles.receiptScanResultRow}>
                                    <Text style={styles.receiptScanResultLabel}>상호명</Text>
                                    <Text style={styles.receiptScanResultValue} numberOfLines={1}>
                                      {addition.analysis?.verification.store_name?.trim() || '상호명 미인식'}
                                    </Text>
                                  </View>
                                  <View style={styles.receiptScanResultRow}>
                                    <Text style={styles.receiptScanResultLabel}>사업자번호</Text>
                                    <Text style={styles.receiptScanResultValue} numberOfLines={1}>
                                      {addition.analysis?.verification.biz_num?.trim() || '미인식'}
                                    </Text>
                                  </View>
                                  <View style={styles.receiptScanResultRow}>
                                    <Text style={styles.receiptScanResultLabel}>결제일시</Text>
                                    <Text style={styles.receiptScanResultValue} numberOfLines={1}>
                                      {addition.analysis?.verification.datetime?.trim() || '미인식'}
                                    </Text>
                                  </View>
                                  <View style={styles.receiptScanResultRow}>
                                    <Text style={styles.receiptScanResultLabel}>후기 태그</Text>
                                    <Text style={styles.receiptScanResultValue} numberOfLines={2}>
                                      {summarizeReceiptScanTags([addition])}
                                    </Text>
                                  </View>
                                  <View style={styles.receiptScanResultRowLast}>
                                    <Text style={styles.receiptScanResultLabel}>결제금액</Text>
                                    <Text style={styles.receiptScanAmountText}>{addition.amountWon.toLocaleString()}원</Text>
                                  </View>
                                </View>
                              </>
                            ) : pageError || receiptScanPreview.stage === 'error' ? (
                              <View style={styles.receiptScanErrorBox}>
                                <Text style={styles.receiptScanReadyTitle}>
                                  {pageError ? '이 사진은 적용할 수 없어요' : receiptScanPreview.message}
                                </Text>
                                <Text style={styles.receiptScanErrorText}>
                                  {pageError || receiptScanPreview.errorMessage || '사진이 선명하게 보이도록 다시 선택해 주세요.'}
                                </Text>
                              </View>
                            ) : (
                              <>
                                <View style={styles.receiptScanStatusRow}>
                                  <ActivityIndicator color={GinitTheme.colors.primary} />
                                  <Text style={styles.receiptScanStatusText}>
                                    {isScanning ? receiptScanPreview.message : '인식 순서를 기다리고 있어요.'}
                                  </Text>
                                </View>
                                <View style={styles.receiptScanTextBox}>
                                  <Text style={styles.receiptScanTextBoxTitle}>인식한 글씨</Text>
                                  {recognizedText.length > 0 ? (
                                    recognizedText.map((line, textIndex) => (
                                      <Text
                                        key={`${line}-${textIndex}`}
                                        style={styles.receiptScanRecognizedLine}
                                        numberOfLines={1}>
                                        {line}
                                      </Text>
                                    ))
                                  ) : (
                                    <Text style={styles.receiptScanEmptyText}>사진에서 글씨를 찾고 있어요.</Text>
                                  )}
                                </View>
                              </>
                            )}
                          </ScrollView>
                        </View>
                      );
                    })}
                    {receiptScanPreview.stage === 'ready' && receiptScanPreview.assets.length > 1 ? (
                      <View style={[styles.receiptScanPage, styles.receiptScanSummaryPage, { width: receiptScanPageWidth }]}>
                        <Text style={styles.receiptScanSectionLabel}>인식한 영수증 최종 확인</Text>
                        <View style={styles.receiptScanResultCard}>
                          {receiptScanPreview.additions.map((addition, index) => (
                            <View key={`${addition.uri}-${index}`} style={styles.receiptScanSummaryReceiptRow}>
                              <View style={styles.receiptScanSummaryReceiptText}>
                                <Text style={styles.receiptScanSummaryStore} numberOfLines={1}>
                                  {addition.analysis?.verification.store_name?.trim() || '상호명 미인식'}
                                </Text>
                                <Text style={styles.receiptScanSummaryMeta} numberOfLines={1}>
                                  {(addition.analysis?.verification.biz_num?.trim() || '사업자번호 미인식') +
                                    ' · ' +
                                    (addition.analysis?.verification.datetime?.trim() || '방문 시점 미인식')}
                                </Text>
                              </View>
                              <Text style={styles.receiptScanSummaryAmount}>{addition.amountWon.toLocaleString()}원</Text>
                            </View>
                          ))}
                          <View style={styles.receiptScanResultRowLast}>
                            <Text style={styles.receiptScanResultLabel}>최종 합계</Text>
                            <Text style={styles.receiptScanAmountText}>{receiptScanTotalWon.toLocaleString()}원</Text>
                          </View>
                        </View>
                        <Text style={styles.receiptScanConfirmText}>이 값으로 적용하시겠습니까?</Text>
                      </View>
                    ) : null}
                  </ScrollView>
                ) : null}

                <View style={styles.receiptScanActions}>
                  {receiptScanPreview?.stage === 'ready' ? (
                    <>
                      <GinitPressable
                        onPress={closeReceiptScanPreview}
                        style={({ pressed }) => [styles.secondaryBtn, styles.receiptScanActionButton, pressed && { opacity: 0.86 }]}>
                        <Text style={styles.secondaryBtnText}>취소</Text>
                      </GinitPressable>
                      <GinitPressable
                        onPress={applyReceiptScanPreview}
                        style={({ pressed }) => [styles.primaryBtn, styles.receiptScanActionButton, pressed && { opacity: 0.88 }]}>
                        <Text style={styles.primaryBtnText}>이 값으로 적용</Text>
                      </GinitPressable>
                    </>
                  ) : receiptScanPreview?.stage === 'error' ? (
                    <GinitPressable
                      onPress={closeReceiptScanPreview}
                      style={({ pressed }) => [styles.secondaryBtn, styles.receiptScanActionButton, pressed && { opacity: 0.86 }]}>
                      <Text style={styles.secondaryBtnText}>닫기</Text>
                    </GinitPressable>
                  ) : (
                    <GinitPressable
                      onPress={closeReceiptScanPreview}
                      style={({ pressed }) => [styles.secondaryBtn, styles.receiptScanActionButton, pressed && { opacity: 0.86 }]}>
                      <Text style={styles.secondaryBtnText}>취소</Text>
                    </GinitPressable>
                  )}
                </View>
              </View>
            </View>
          </GestureHandlerRootView>
        </Modal>
        <PlaceDetailPopup state={placeDetailPopup} onClose={() => setPlaceDetailPopup(null)} />
        <Modal
          visible={receiptImageViewerIndex !== null && receiptImageGallery.length > 0}
          transparent
          animationType="fade"
          onRequestClose={() => setReceiptImageViewerIndex(null)}>
          <GestureHandlerRootView style={meetingChatBodyStyles.viewerRoot}>
            <View style={meetingChatBodyStyles.viewerSheet} pointerEvents="box-none">
              <View style={[meetingChatBodyStyles.viewerTopRow, { paddingTop: insets.top + 8 }]}>
                <GinitPressable
                  duplicatePressGuardDisabled
                  onPress={() => setReceiptImageViewerIndex(null)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="닫기">
                  <GinitSymbolicIcon name="close" size={26} color="#fff" />
                </GinitPressable>
                <View style={meetingChatBodyStyles.viewerMetaCol} pointerEvents="none">
                  <Text style={meetingChatBodyStyles.viewerMetaName} numberOfLines={1}>
                    영수증
                  </Text>
                  <Text style={meetingChatBodyStyles.viewerMetaTime} numberOfLines={1}>
                    {receiptImageViewerSafeIndex + 1} / {receiptImageGallery.length}
                  </Text>
                </View>
                <View style={meetingChatBodyStyles.viewerActions} />
              </View>
              <View style={meetingChatBodyStyles.viewerImageWrap}>
                <MeetingChatImageViewerGallery
                  gallery={receiptImageGallery}
                  initialIndex={receiptImageViewerSafeIndex}
                  onIndexChange={(index) => setReceiptImageViewerIndex(index)}
                />
              </View>
            </View>
          </GestureHandlerRootView>
        </Modal>
        {profileAccounts != null && profileAccounts.items.length > 0 ? (
          <SettlementAccountPickerModal
            visible={accountPickerOpen}
            animationType={accountPickerAnimationType}
            onClose={() => {
              setAccountPickerAnimationType('slide');
              setAccountPickerOpen(false);
            }}
            onManageAccounts={() => {
              reopenAccountPickerOnFocusRef.current = true;
              setAccountPickerAnimationType('none');
              setAccountPickerOpen(false);
              requestAnimationFrame(() => router.push('/settlement/accounts'));
            }}
            items={profileAccounts.items}
            selectedAccountId={selectedProfileAccountId}
            defaultAccountId={profileDefaultAccountId}
            onSelectAccountId={onPickSettlementAccount}
          />
        ) : null}
      </SafeAreaView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  rootShell: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  safe: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  scroll: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  scrollContent: { paddingHorizontal: 0, paddingTop: 0, flexGrow: 1 },
  settlementFormBlock: { paddingHorizontal: 20, paddingTop: 2, gap: 10, paddingBottom: 0 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: GinitTheme.colors.bg },
  padded: { flex: 1, paddingHorizontal: 20, backgroundColor: GinitTheme.colors.bg, gap: 16 },
  settlementMeetingTitle: { fontSize: 18, lineHeight: 26, fontWeight: '700' },
  sectionLabel: { marginTop: 8, fontSize: 13, fontWeight: '700', color: GinitTheme.colors.textSub },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    gap: 8,
  },
  sectionLabelInRow: { fontSize: 13, fontWeight: '700', color: GinitTheme.colors.textSub, flexShrink: 0 },
  sectionLabelRowSpacer: { flex: 1, minWidth: 8 },
  amountTabRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GinitTheme.colors.border,
    marginTop: 4,
  },
  amountTab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  amountTabSelected: {
    borderBottomColor: GinitTheme.colors.primary,
  },
  amountTabLabel: { fontSize: 15, fontWeight: '600', color: GinitTheme.colors.textMuted },
  amountTabLabelSelected: { color: GinitTheme.colors.text, fontWeight: '700' },
  totalHeroInputRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: GinitTheme.colors.border,
    paddingBottom: 4,
  },
  totalHeroInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 32,
    fontWeight: '700',
    color: GinitTheme.colors.text,
    paddingVertical: 4,
    backgroundColor: GinitTheme.colors.bg,
  },
  totalHeroUnit: {
    marginLeft: 8,
    fontSize: 22,
    fontWeight: '700',
    color: GinitTheme.colors.text,
  },
  totalHeroSum: {
    flex: 1,
    minWidth: 0,
    fontSize: 32,
    fontWeight: '700',
    color: GinitTheme.colors.text,
    textAlign: 'right',
    paddingVertical: 4,
  },
  totalHeroHint: {
    ...GinitTheme.typography.caption,
    color: GinitTheme.colors.textMuted,
    textAlign: 'center',
    marginBottom: 4,
  },
  bulkEditLink: { fontSize: 13, fontWeight: '700', color: GinitTheme.colors.primary },
  participantAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 5,
  },
  participantRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  participantAvatarWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    position: 'relative',
  },
  participantAvatarWrapOff: { opacity: 0.45 },
  participantAvatarImg: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: GinitTheme.colors.border,
  },
  participantAvatarFallback: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GinitTheme.colors.noticeSurface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
  },
  participantAvatarInitial: { fontSize: 14, fontWeight: '700', color: GinitTheme.colors.textSub },
  participantAvatarCheckBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GinitTheme.colors.primary,
    borderWidth: 2,
    borderColor: GinitTheme.colors.bg,
  },
  participantNameCol: { flex: 1, minWidth: 0, gap: 2 },
  participantWonText: { fontSize: 15, fontWeight: '700', color: GinitTheme.colors.text, minWidth: 88, textAlign: 'right' },
  participantWonInput: {
    minWidth: 100,
    maxWidth: 140,
    borderBottomWidth: 1,
    borderBottomColor: GinitTheme.colors.border,
    paddingVertical: 6,
    paddingHorizontal: 4,
    fontSize: 15,
    fontWeight: '600',
    color: GinitTheme.colors.text,
    backgroundColor: 'transparent',
  },
  bulkModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  bulkModalCard: {
    backgroundColor: GinitTheme.colors.bg,
    borderRadius: 14,
    padding: 20,
    gap: 14,
  },
  bulkModalTitle: { fontSize: 17, fontWeight: '700', color: GinitTheme.colors.text },
  bulkModalActions: { flexDirection: 'row', gap: 10 },
  bulkModalBtn: { flex: 1 },
  receiptScanModalRoot: { flex: 1 },
  receiptScanModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.46)',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  receiptScanModalCard: {
    maxHeight: '92%',
    borderRadius: 16,
    backgroundColor: GinitTheme.colors.bg,
    overflow: 'hidden',
  },
  receiptScanHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 15,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GinitTheme.colors.border,
  },
  receiptScanHeaderTextCol: { flex: 1, minWidth: 0, gap: 2 },
  receiptScanTitle: { fontSize: 17, fontWeight: '800', color: GinitTheme.colors.text },
  receiptScanSubtitle: { fontSize: 12, fontWeight: '700', color: GinitTheme.colors.textMuted },
  receiptScanPager: { width: '100%' },
  receiptScanPage: { paddingBottom: 2 },
  receiptScanImageShell: {
    height: 290,
    marginHorizontal: 18,
    marginTop: 16,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(126, 126, 126, 0.1)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
  },
  receiptScanImage: { width: '100%', height: '100%' },
  receiptScanOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-start',
  },
  receiptScanDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.18)',
  },
  receiptScanLine: {
    position: 'absolute',
    left: 18,
    right: 18,
    top: 18,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
  },
  receiptScanLineCore: {
    height: 3,
    borderRadius: 2,
    backgroundColor: GinitTheme.colors.primary,
  },
  receiptScanBodyScroll: { maxHeight: 250 },
  receiptScanBody: { paddingHorizontal: 18, paddingTop: 14, gap: 10 },
  receiptScanStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  receiptScanStatusText: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '700', color: GinitTheme.colors.text },
  receiptScanTextBox: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GinitTheme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GinitTheme.colors.border,
    backgroundColor: GinitTheme.colors.bg,
    paddingHorizontal: 0,
    paddingVertical: 10,
    gap: 4,
  },
  receiptScanTextBoxTitle: { fontSize: 12, fontWeight: '800', color: GinitTheme.colors.textSub, marginBottom: 2 },
  receiptScanRecognizedLine: { fontSize: 12, color: GinitTheme.colors.textMuted, lineHeight: 17 },
  receiptScanEmptyText: { fontSize: 13, color: GinitTheme.colors.textMuted },
  receiptScanReadyTitle: { fontSize: 16, fontWeight: '800', color: GinitTheme.colors.text },
  receiptScanSectionLabel: { fontSize: 13, fontWeight: '800', color: GinitTheme.colors.textSub },
  receiptScanResultCard: {
    backgroundColor: GinitTheme.colors.bg,
  },
  receiptScanResultRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GinitTheme.colors.border,
  },
  receiptScanResultRowLast: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
  },
  receiptScanResultLabel: { fontSize: 13, fontWeight: '800', color: GinitTheme.colors.textSub },
  receiptScanResultValue: { flex: 1, minWidth: 0, textAlign: 'right', fontSize: 14, fontWeight: '700', color: GinitTheme.colors.text },
  receiptScanAmountText: { flex: 1, textAlign: 'right', fontSize: 18, fontWeight: '800', color: GinitTheme.colors.primary },
  receiptScanSummaryPage: { paddingHorizontal: 18, paddingTop: 16 },
  receiptScanSummaryReceiptRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GinitTheme.colors.border,
  },
  receiptScanSummaryReceiptText: { flex: 1, minWidth: 0, gap: 2 },
  receiptScanSummaryStore: { fontSize: 14, fontWeight: '800', color: GinitTheme.colors.text },
  receiptScanSummaryMeta: { fontSize: 12, color: GinitTheme.colors.textMuted },
  receiptScanSummaryAmount: { fontSize: 14, fontWeight: '800', color: GinitTheme.colors.text },
  receiptScanConfirmText: { fontSize: 14, fontWeight: '700', color: GinitTheme.colors.text, textAlign: 'center' },
  receiptScanErrorBox: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GinitTheme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GinitTheme.colors.border,
    backgroundColor: GinitTheme.colors.bg,
    paddingHorizontal: 0,
    paddingVertical: 14,
    gap: 8,
  },
  receiptScanErrorText: { fontSize: 14, lineHeight: 20, color: GinitTheme.colors.textSub },
  receiptScanActions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 18,
  },
  receiptScanActionButton: { flex: 1 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: GinitTheme.colors.text,
    backgroundColor: GinitTheme.colors.bg,
  },
  rowLabel: { fontSize: 14, fontWeight: '600', color: GinitTheme.colors.text },
  rowIdLabel: { fontSize: 11, color: GinitTheme.colors.textMuted },
  muted: { fontSize: 14, color: GinitTheme.colors.textMuted },
  body: { fontSize: 15, color: GinitTheme.colors.text, lineHeight: 22 },
  readonlyTotalBlock: { gap: 4 },
  readonlySettlementInfoList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GinitTheme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GinitTheme.colors.border,
  },
  readonlySettlementInfoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GinitTheme.colors.border,
  },
  readonlySettlementInfoRowLast: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 11,
  },
  readonlySettlementRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  readonlySettlementLabel: { fontSize: 13, fontWeight: '700', color: GinitTheme.colors.textSub },
  readonlySettlementValue: { flex: 1, textAlign: 'right', fontSize: 14, fontWeight: '700', color: GinitTheme.colors.text },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: GinitTheme.colors.border,
    marginVertical: 12,
  },
  primaryBtn: {
    backgroundColor: GinitTheme.colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondaryBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryBtnText: { color: GinitTheme.colors.text, fontSize: 15, fontWeight: '600' },
  actionDivider: { height: StyleSheet.hairlineWidth, backgroundColor: GinitTheme.colors.border },
  actionBtnContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  ocrRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ocrHint: { ...GinitTheme.typography.caption, color: GinitTheme.colors.textMuted },
  paymentMethodBlock: { gap: 8, marginTop: 4 },
  paymentMethodRow: { flexDirection: 'row', gap: 8 },
  paymentMethodOption: {
    flex: 1,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    borderRadius: 10,
    paddingVertical: 11,
    backgroundColor: GinitTheme.colors.bg,
  },
  paymentMethodOptionSelected: {
    borderColor: GinitTheme.colors.primary,
    backgroundColor: GinitTheme.colors.noticeSurface,
  },
  paymentMethodOptionText: { fontSize: 14, fontWeight: '700', color: GinitTheme.colors.textSub },
  paymentMethodOptionTextSelected: { color: GinitTheme.colors.primary },
  receiptSubtitle: { marginTop: 12 },
  receiptReadonlyList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GinitTheme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GinitTheme.colors.border,
  },
  receiptReadonlyCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GinitTheme.colors.border,
    backgroundColor: GinitTheme.colors.bg,
    paddingVertical: 10,
  },
  receiptReadonlyImagePressable: {
    width: 86,
    height: 104,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: GinitTheme.colors.border,
  },
  receiptReadonlyImg: { width: 86, height: 104 },
  receiptReadonlyInfo: { flex: 1, minWidth: 0, gap: 5, justifyContent: 'center' },
  receiptReadonlyTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  receiptReadonlyStore: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '800', color: GinitTheme.colors.text },
  receiptReadonlyAmount: { fontSize: 14, fontWeight: '800', color: GinitTheme.colors.primary },
  receiptReadonlyMeta: { fontSize: 12, color: GinitTheme.colors.textMuted },
  receiptReadonlyTags: { fontSize: 12, lineHeight: 17, fontWeight: '700', color: GinitTheme.colors.textSub },
  receiptThumbRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 4 },
  receiptThumbColumn: { width: 76, alignItems: 'center' },
  receiptThumbImageShell: {
    width: 76,
    height: 88,
    position: 'relative',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: GinitTheme.colors.border,
  },
  receiptThumbImagePressable: { width: 76, height: 88 },
  receiptThumbImg: { width: 76, height: 88 },
  receiptRemoveBadge: { position: 'absolute', top: 4, right: 4, zIndex: 2 },
  receiptRemoveCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(15,23,42,0.62)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptUploaderBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    zIndex: 2,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#fff',
    overflow: 'hidden',
    backgroundColor: GinitTheme.colors.border,
  },
  receiptUploaderBadgeImg: { width: '100%', height: '100%' },
  receiptUploaderBadgeFallback: {
    flex: 1,
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GinitTheme.colors.noticeSurface,
  },
  receiptUploaderBadgeInitial: { fontSize: 10, fontWeight: '700', color: GinitTheme.colors.textSub },
  receiptThumbCaption: {
    fontSize: 11,
    fontWeight: '600',
    color: GinitTheme.colors.textSub,
    paddingHorizontal: 4,
    paddingVertical: 4,
    textAlign: 'center',
  },
  bankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  accountPickMid: { flex: 1, minWidth: 0, gap: 2 },
  accountPickTitle: { fontSize: 15, color: GinitTheme.colors.text, fontWeight: '600' },
  accountPickSub: { fontSize: 13, color: GinitTheme.colors.textMuted },
  accountEmptyBlock: { gap: 12, paddingVertical: 4 },
  accountEmptyHint: { fontSize: 14, color: GinitTheme.colors.textMuted, lineHeight: 20 },
  defaultBadgeInline: { fontSize: 11, fontWeight: '700', color: GinitTheme.colors.primary },
  defaultBadgeSpacer: { width: 28 },
  bankPlaceholder: { flex: 1, fontSize: 15, color: GinitTheme.colors.textMuted },
  reviewPromptCard: {
    marginTop: 16,
    padding: 16,
    borderRadius: GinitTheme.radius.card,
    backgroundColor: GinitTheme.colors.noticeSurface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    gap: 8,
  },
  reviewPromptTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: GinitTheme.colors.deepPurple,
    textAlign: 'center',
  },
  reviewPromptSub: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    textAlign: 'center',
    marginBottom: 4,
  },
  reviewPromptBtn: { marginTop: 4 },
});
