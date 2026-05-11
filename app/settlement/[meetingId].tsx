import * as ImagePicker from 'expo-image-picker';
import type { ImagePickerAsset } from 'expo-image-picker';
import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { NaverPlaceWebViewModal } from '@/components/NaverPlaceWebViewModal';
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
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import { useMeetingCategories } from '@/src/context/MeetingCategoriesContext';
import { useUserSession } from '@/src/context/UserSessionContext';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import {
  buildMeetingTopNoticeTitleLeft,
  formatPublicMeetingSettlementSummary,
  getMeetingById,
  type Meeting,
  type MeetingSettlementReceiptItem,
  parsePublicMeetingDetailsConfig,
} from '@/src/lib/meetings';
import {
  markMeetingLifecycleSettled,
  persistMeetingLocationDataPatch,
  persistMeetingSettlementInfoPatch,
} from '@/src/lib/meeting-settlement-persist';
import { dispatchRemotePushToRecipientsWithApproxDelivered } from '@/src/lib/remote-push-hub';
import {
  buildSettlementShareMessage,
  maskHolderInHostAccountTextForShare,
  shareSettlementText,
} from '@/src/lib/settlement-share-channels';
import { launchImageLibraryAsyncSafe } from '@/src/lib/expo-image-picker-safe-launch';
import { isMeetingHost, isMeetingSettlementCtaEligibleForHost } from '@/src/lib/settlement-eligibility';
import { runSettlementReceiptOcrFromUri } from '@/src/lib/settlement-receipt-ocr';
import {
  isRemoteSettlementReceiptImageUri,
  uploadCompressedSettlementReceiptToSupabase,
} from '@/src/lib/settlement-receipt-storage';
import {
  composeSettlementHostAccountText,
  getSettlementBankById,
  parseSettlementLegacyHostAccountText,
} from '@/src/lib/korean-banks-settlement';
import { safeRouterBack } from '@/src/lib/router-safe';
import {
  getUserSettlementAccountById,
  loadUserSettlementAccounts,
  resolveEffectiveDefaultId,
  type UserSettlementAccountsState,
} from '@/src/lib/user-settlement-accounts';
import { getUserProfilesForIds, type UserProfile } from '@/src/lib/user-profile';

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
  naturalWidth?: number;
};

function newSettlementReceiptId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
  const [receiptItems, setReceiptItems] = useState<SettlementReceiptRow[]>([]);
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
  const [naverPlaceWebModal, setNaverPlaceWebModal] = useState<{ url: string; title: string } | null>(null);
  const [settlementAmountTab, setSettlementAmountTab] = useState<SettlementAmountTab>('split_n');
  const [settlementPaymentMethod, setSettlementPaymentMethod] = useState<SettlementPaymentMethod>('bank_transfer');
  const [manualAmountsByParticipant, setManualAmountsByParticipant] = useState<Record<string, string>>({});
  const [bulkAmountModalOpen, setBulkAmountModalOpen] = useState(false);
  const [bulkAmountDraft, setBulkAmountDraft] = useState('');
  const reopenAccountPickerOnFocusRef = useRef(false);

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

  const hostNorm = useMemo(() => {
    const u = (userId ?? '').trim();
    return u ? normalizeParticipantId(u) ?? u : '';
  }, [userId]);

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
      setReceiptItems(
        drRows
          .map((r) => ({
            id: typeof r.id === 'string' && r.id.trim() ? r.id.trim() : newSettlementReceiptId(),
            previewUri: (r.imageUrl ?? '').trim(),
            amountWon: typeof r.amountWon === 'number' && Number.isFinite(r.amountWon) ? Math.trunc(r.amountWon) : 0,
          }))
          .filter((row) => row.previewUri.length > 0),
      );
    } else {
      setReceiptItems([]);
    }
  }, [meeting, hostNorm, allSettlementParticipantIds]);

  useEffect(() => {
    if (receiptItems.length === 0) return;
    if (settlementAmountTab === 'manual') return;
    const sum = receiptItems.reduce((s, x) => s + x.amountWon, 0);
    setTotalWonInput(formatWonInput(String(sum)));
  }, [receiptItems, settlementAmountTab]);

  const receiptImageGallery = useMemo<ImageViewerGalleryItem[]>(
    () =>
      receiptItems
        .map((it) => ({ id: it.id, imageUrl: it.previewUri.trim() }))
        .filter((it) => it.imageUrl.length > 0),
    [receiptItems],
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

  const settlementReadOnly = !canEditSettlement && canViewSettledSettlement;
  const settlementParticipantDisplayIds = settlementReadOnly ? activeSplitParticipantIds : allSettlementParticipantIds;
  const settlementAccountTextForReadOnly = useMemo(() => {
    const saved = meeting?.settlementInfo?.hostAccountText?.trim() ?? '';
    return saved || composedHostAccountText.trim();
  }, [meeting?.settlementInfo?.hostAccountText, composedHostAccountText]);

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

  /** 최상단 바: `정산 방식 요약` + 한 칸 + `정산`(모임 미로드·id 불일치 시 `정산`만). */
  const settlementScreenTopBarTitle = useMemo(() => {
    const mid = meetingId.trim();
    if (!meeting?.id?.trim() || meeting.id.trim() !== mid) return '정산';
    const lead = settlementModeSummaryLine.trim();
    return lead ? `${lead} 정산` : '정산';
  }, [meetingId, meeting?.id, settlementModeSummaryLine]);

  const persistSettlementDraftToServer = useCallback(async () => {
    if (!meetingId || !meeting) throw new Error('모임을 찾을 수 없어요.');
    const uid = (userId ?? '').trim();
    if (!uid) throw new Error('로그인이 필요합니다.');
    if (usesBankTransferSettlement && !profileAccounts?.items?.length) {
      throw new Error('정산 계좌를 등록하여 선택해 주세요.');
    }

    const snapshots: MeetingSettlementReceiptItem[] = [];
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
      snapshots.push({ id: row.id, imageUrl, amountWon: row.amountWon });
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

  const onSaveDraft = useCallback(async () => {
    if (!meetingId || !meeting) return;
    setSaving(true);
    try {
      await persistSettlementDraftToServer();
      Alert.alert('저장됨', '임시 저장했어요.');
    } catch (e) {
      Alert.alert('오류', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [meetingId, meeting, persistSettlementDraftToServer]);

  const onSendAppPush = useCallback(async () => {
    if (!meetingId || !meeting || !userId?.trim()) return;
    if (meeting.lifecycleStatus === 'SETTLED') {
      Alert.alert('안내', '이미 정산 완료된 모임이에요.');
      return;
    }
    if (selectedCount === 0) {
      Alert.alert('알림', '정산에 포함할 사람을 한 명 이상 선택해 주세요.');
      return;
    }
    if (effectiveTotalWonParsed == null) {
      Alert.alert('알림', '총액을 숫자로 입력해 주세요.');
      return;
    }
    const hostAccount = composedHostAccountText.trim();
    if (usesBankTransferSettlement && !getSettlementBankById(hostBankId)) {
      Alert.alert('알림', '입금 은행을 선택해 주세요.');
      return;
    }
    if (usesBankTransferSettlement && !hostAccountNumber.replace(/\D/g, '').trim()) {
      Alert.alert('알림', '계좌번호를 입력해 주세요.');
      return;
    }
    if (usesBankTransferSettlement && !hostAccountHolder.trim()) {
      Alert.alert('알림', '예금주 이름을 입력해 주세요.');
      return;
    }
    if (usesBankTransferSettlement && !hostAccount) {
      Alert.alert('알림', '입금 계좌 정보를 확인해 주세요.');
      return;
    }
    setPushing(true);
    try {
      await persistSettlementDraftToServer();
      const recipients = [...selectedParticipantIds]
        .filter((id) => id !== hostNorm)
        .slice(0, MAX_SETTLEMENT_PUSH_RECIPIENTS);
      if (recipients.length === 0) {
        Alert.alert('알림', '앱 알림을 받을 다른 참석자가 없어요. 참석자를 초대한 뒤 다시 시도해 주세요.');
        return;
      }
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
        toUserIds: recipients,
        title,
        body,
        data,
      });
      if (approx <= 0) {
        Alert.alert('알림', '푸시가 전달되지 않았어요. 네트워크를 확인한 뒤 다시 시도해 주세요.');
        return;
      }
      await markMeetingLifecycleSettled(meetingId);
      DeviceEventEmitter.emit('ginit_home_meetings_refetch');
      const fresh = await getMeetingById(meetingId);
      if (fresh) setMeeting(fresh);
      Alert.alert('완료', '참석자에게 알림을 보냈고, 모임을 정산 완료로 표시했어요.', [
        { text: '확인', onPress: () => router.back() },
      ]);
    } catch (e) {
      Alert.alert('오류', e instanceof Error ? e.message : String(e));
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
    router,
  ]);

  const sharePayload = useCallback(() => {
    if (!meeting) return;
    return buildSettlementShareMessage({
      meetingTitle: meeting.title ?? '',
      participantCount: selectedCount,
      settlementMethodText: settlementModeSummaryLine,
      paymentMethod: settlementPaymentMethod,
      bankName: selectedBank?.label ?? '',
      accountNumber: hostAccountNumber,
      accountHolder: hostAccountHolder,
      perPersonWon,
      totalWon: effectiveTotalWonParsed,
    });
  }, [
    meeting,
    selectedCount,
    settlementModeSummaryLine,
    settlementPaymentMethod,
    selectedBank?.label,
    hostAccountNumber,
    hostAccountHolder,
    perPersonWon,
    effectiveTotalWonParsed,
  ]);

  const onShareSheet = useCallback(async () => {
    if (!isCurrentSettlementDraftSavedForShare) {
      Alert.alert('안내', '임시 저장 후 공유해주세요.');
      return;
    }
    const msg = sharePayload();
    if (!msg) return;
    setSharing(true);
    try {
      await shareSettlementText(msg);
    } catch {
      Alert.alert('오류', '공유를 완료하지 못했어요.');
    } finally {
      setSharing(false);
    }
  }, [isCurrentSettlementDraftSavedForShare, sharePayload]);

  const toggleParticipant = useCallback((id: string) => {
    setSelectedParticipantIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) return prev;
      return next;
    });
  }, []);

  const switchToSplitNTab = useCallback(() => {
    if (settlementAmountTab === 'manual' && manualSumParsed != null) {
      setTotalWonInput(formatWonInput(String(manualSumParsed)));
    }
    setSettlementAmountTab('split_n');
  }, [settlementAmountTab, manualSumParsed]);

  const switchToManualTab = useCallback(() => {
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
      Alert.alert('알림', '0보다 큰 금액을 입력해 주세요.');
      return;
    }
    const ids = allSettlementParticipantIds.filter((id) => selectedParticipantIds.has(id));
    const next: Record<string, string> = { ...manualAmountsByParticipant };
    for (const id of ids) next[id] = formatWonInput(String(v));
    setManualAmountsByParticipant(next);
    setBulkAmountModalOpen(false);
    setBulkAmountDraft('');
  }, [bulkAmountDraft, allSettlementParticipantIds, selectedParticipantIds, manualAmountsByParticipant]);

  const onPickSettlementAccount = useCallback(
    (id: string) => {
      if (!profileAccounts?.items.length) return;
      const acc = getUserSettlementAccountById(profileAccounts, id);
      if (!acc) return;
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

      setOcrBusy(true);
      const additions: { uri: string; amountWon: number; naturalWidth?: number }[] = [];
      let lastAccountHint: string | null = null;
      try {
        for (const a of list) {
          const r = await runSettlementReceiptOcrFromUri(a.uri.trim(), { width: a.width, height: a.height });
          if (!r.ok) {
            if (list.length === 1) {
              Alert.alert('영수증 인식', r.message);
            }
            continue;
          }
          if (r.accountHint?.trim()) lastAccountHint = r.accountHint.trim();
          if (r.totalWon != null) {
            additions.push({
              uri: a.uri.trim(),
              amountWon: r.totalWon,
              naturalWidth: typeof a.width === 'number' && a.width > 0 ? a.width : undefined,
            });
          }
        }

        if (additions.length === 0) {
          Alert.alert(
            '영수증 인식',
            list.length > 1
              ? '선택한 사진에서 금액을 찾지 못했어요. 각 장이 잘 보이게 다시 선택해 주세요.'
              : '금액·계좌를 자동으로 찾지 못했어요. 직접 입력하거나 다른 각도로 다시 촬영해 보세요.',
          );
          return;
        }

        const sum = additions.reduce((s, x) => s + x.amountWon, 0);
        const lines = additions.map((x, i) => `영수증 ${i + 1}: ${x.amountWon.toLocaleString()}원`);
        lines.push(`인식 합계: ${sum.toLocaleString()}원`);
        if (lastAccountHint) lines.push(`계좌 힌트: ${lastAccountHint}`);

        Alert.alert('영수증 인식', `${lines.join('\n')}\n\n목록에 추가하고 총액에 합산할까요?`, [
          { text: '취소', style: 'cancel' },
          {
            text: '추가',
            onPress: () => {
              mergeAccountHint(lastAccountHint);
              const rows: SettlementReceiptRow[] = additions.map((x) => ({
                id: newSettlementReceiptId(),
                previewUri: x.uri,
                amountWon: x.amountWon,
                naturalWidth: x.naturalWidth,
              }));
              setReceiptItems((prev) => [...prev, ...rows]);
            },
          },
        ]);
      } finally {
        setOcrBusy(false);
      }
    },
    [mergeAccountHint],
  );

  const pickReceiptImageAndOcr = useCallback(
    async (source: 'camera' | 'library') => {
      if (Platform.OS === 'web') {
        Alert.alert('안내', '영수증 촬영 인식은 iOS·Android 앱에서만 지원해요.');
        return;
      }
      const perm =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('권한', source === 'camera' ? '카메라 권한이 필요해요.' : '사진 접근 권한이 필요해요.');
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
    Alert.alert('영수증 인식', '촬영 또는 앨범에서 영수증을 선택해 주세요.', [
      { text: '취소', style: 'cancel' },
      { text: '촬영', onPress: () => void pickReceiptImageAndOcr('camera') },
      { text: '앨범', onPress: () => void pickReceiptImageAndOcr('library') },
    ]);
  }, [pickReceiptImageAndOcr]);

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

  if (!canEditSettlement && !canViewSettledSettlement) {
    return (
      <ScreenShell padded={false} style={styles.rootShell}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <SettlementAccountsScreenTopBar title={settlementScreenTopBarTitle} onBack={() => safeRouterBack(router)} />
          <View style={[styles.padded, { paddingTop: 12 }]}>
            <Text style={styles.body}>이 모임에서는 정산을 진행할 수 없어요.(호스트만, 일정 확정 후 일정 시간이 지난 뒤 가능)</Text>
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
        <SettlementAccountsScreenTopBar title={settlementScreenTopBarTitle} onBack={() => safeRouterBack(router)} />
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
            onOpenPlaceUrl={(url, title) => setNaverPlaceWebModal({ url, title })}
          />
          <View style={styles.settlementFormBlock}>
            {settlementReadOnly ? (
              <View style={styles.readonlySettlementCard}>
                <View style={styles.readonlySettlementRow}>
                  <Text style={styles.readonlySettlementLabel}>총 금액</Text>
                  <Text style={styles.readonlySettlementValue}>
                    {effectiveTotalWonParsed != null ? `${effectiveTotalWonParsed.toLocaleString()}원` : '—'}
                  </Text>
                </View>
                <View style={styles.readonlySettlementRow}>
                  <Text style={styles.readonlySettlementLabel}>정산 방식</Text>
                  <Text style={styles.readonlySettlementValue}>{settlementModeSummaryLine}</Text>
                </View>
                <View style={styles.readonlySettlementRow}>
                  <Text style={styles.readonlySettlementLabel}>참여 인원</Text>
                  <Text style={styles.readonlySettlementValue}>{selectedCount.toLocaleString()}명</Text>
                </View>
                <View style={styles.readonlySettlementRow}>
                  <Text style={styles.readonlySettlementLabel}>내가 지불할 금액</Text>
                  <Text style={styles.readonlySettlementValue}>
                    {perPersonWon != null ? `${perPersonWon.toLocaleString()}원` : '—'}
                  </Text>
                </View>
                {settlementAccountTextForReadOnly ? (
                  <View style={styles.readonlySettlementRow}>
                    <Text style={styles.readonlySettlementLabel}>입금 계좌</Text>
                    <Text style={styles.readonlySettlementValue} numberOfLines={2}>
                      {settlementAccountTextForReadOnly}
                    </Text>
                  </View>
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
                  onChangeText={(t) => setTotalWonInput(formatWonInput(t))}
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
                const isHostRow = pid === hostPid;
                const profile = participantProfiles.get(pid);
                const nick =
                  profile?.nickname?.trim() ||
                  (isHostRow ? authProfile?.displayName?.trim() ?? '' : '') ||
                  pid;
                const displayName = isHostRow ? `${nick} (나)` : nick;
                const photoUrl = profile?.photoUrl?.trim() || (isHostRow ? authProfile?.photoUrl?.trim() ?? '' : '');
                const avatarInitial = displayName.trim().slice(0, 1) || '친';
                const on = settlementReadOnly ? true : selectedParticipantIds.has(pid);
                const splitWon = splitDisplayMap.get(pid);
                return (
                  <View key={pid} style={styles.participantAmountRow}>
                    <GinitPressable
                      onPress={settlementReadOnly ? undefined : () => toggleParticipant(pid)}
                      disabled={settlementReadOnly}
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
                    {settlementAmountTab === 'split_n' ? (
                      <Text style={styles.participantWonText} numberOfLines={1}>
                        {splitWon != null ? `${splitWon.toLocaleString()}원` : '—'}
                      </Text>
                    ) : (
                      <TextInput
                        value={formatWonInput(manualAmountsByParticipant[pid] ?? '')}
                        onChangeText={(t) =>
                          setManualAmountsByParticipant((prev) => ({
                            ...prev,
                            [pid]: formatWonInput(t),
                          }))
                        }
                        keyboardType="number-pad"
                        placeholder="0"
                        placeholderTextColor={GinitTheme.colors.textMuted}
                        style={styles.participantWonInput}
                        textAlign="right"
                      />
                    )}
                  </View>
                );
              })
            )}
      {Platform.OS !== 'web' && (!settlementReadOnly || receiptItems.length > 0) ? (
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
                여러 장 선택 가능합니다. 인식된 금액은 총액에 합산되며, 아래 썸네일의 X로 삭제하면 해당 금액만큼 차감됩니다. 결과는 반드시 확인해 주세요.
              </Text>
            </>
          ) : null}
          {receiptItems.length > 0 ? (
            <>
              {settlementReadOnly ? <Text style={[styles.sectionLabelInRow, styles.receiptSubtitle]}>영수증</Text> : null}
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
                        <Image source={{ uri: it.previewUri }} style={styles.receiptThumbImg} contentFit="cover" />
                      </GinitPressable>
                      {!settlementReadOnly ? (
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
                      ) : null}
                    </View>
                    <Text style={styles.receiptThumbCaption} numberOfLines={1}>
                      {it.amountWon.toLocaleString()}원
                    </Text>
                  </View>
                ))}
              </ScrollView>
            </>
          ) : null}
        </>
      ) : null}

            {!settlementReadOnly ? (
              <>
            <View style={styles.paymentMethodBlock}>
              <Text style={styles.sectionLabelInRow}>지불 방식</Text>
              <View style={styles.paymentMethodRow}>
                <GinitPressable
                  onPress={() => setSettlementPaymentMethod('cash')}
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
                  onPress={() => setSettlementPaymentMethod('bank_transfer')}
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
                            {hostAccountHolder.trim() ? ` · ${hostAccountHolder.trim()}` : ''}
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

      <GinitPressable
        onPress={onSendAppPush}
        disabled={pushing}
        style={({ pressed }) => [styles.primaryBtn, (pressed || pushing) && { opacity: 0.88 }]}>
        <Text style={styles.primaryBtnText}>{pushing ? '전송 중…' : '앱 알림 보내기(정산 완료 처리)'}</Text>
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
        <NaverPlaceWebViewModal
          visible={naverPlaceWebModal != null}
          url={naverPlaceWebModal?.url}
          pageTitle={naverPlaceWebModal?.title ?? '상세 정보'}
          onClose={() => setNaverPlaceWebModal(null)}
        />
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
  readonlySettlementCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    borderRadius: 12,
    backgroundColor: GinitTheme.colors.noticeSurface,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
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
});
