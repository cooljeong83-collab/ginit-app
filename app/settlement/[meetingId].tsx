import * as ImagePicker from 'expo-image-picker';
import type { ImagePickerAsset } from 'expo-image-picker';
import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { SettlementAccountPickerModal } from '@/components/settlement/SettlementAccountPickerModal';
import { SettlementAccountsScreenTopBar } from '@/components/settlement/SettlementAccountsScreenTopBar';
import { SettlementBankLogo } from '@/components/settlement/SettlementBankLogo';
import { ScreenShell } from '@/components/ui';
import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import {
  formatPublicMeetingSettlementSummary,
  getMeetingById,
  meetingPrimaryStartMs,
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
  openSettlementSmsComposer,
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

const MAX_SETTLEMENT_PUSH_RECIPIENTS = 50;
const MAX_RECEIPT_IMAGES_PER_BATCH = 12;

type SettlementReceiptRow = {
  id: string;
  previewUri: string;
  amountWon: number;
  naturalWidth?: number;
};

function newSettlementReceiptId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatSettlementScreenScheduleLine(m: Meeting): string {
  const date = m.scheduleDate?.trim() ?? '';
  const time = m.scheduleTime?.trim() ?? '';
  if (date && time) return `${date} ${time}`;
  if (date) return date;
  if (time) return time;
  const ms = meetingPrimaryStartMs(m);
  if (ms != null) {
    return new Intl.DateTimeFormat('ko-KR', {
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(ms));
  }
  return '';
}

export default function SettlementMeetingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useUserSession();
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
  const [ocrBusy, setOcrBusy] = useState(false);
  const [receiptItems, setReceiptItems] = useState<SettlementReceiptRow[]>([]);

  const [totalWonInput, setTotalWonInput] = useState('');
  const [hostBankId, setHostBankId] = useState('');
  const [hostAccountNumber, setHostAccountNumber] = useState('');
  const [hostAccountHolder, setHostAccountHolder] = useState('');
  const [selectedProfileAccountId, setSelectedProfileAccountId] = useState('');
  const [profileAccounts, setProfileAccounts] = useState<UserSettlementAccountsState | null>(null);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    if (!meetingId) return;
    const m = await getMeetingById(meetingId);
    setMeeting(m);
  }, [meetingId]);

  useFocusEffect(
    useCallback(() => {
      const uid = (userId ?? '').trim();
      if (!uid) {
        setProfileAccounts({ defaultId: null, items: [] });
        return;
      }
      let alive = true;
      loadUserSettlementAccounts(uid).then((s) => {
        if (alive) setProfileAccounts(s);
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
    setTotalWonInput(si?.draftTotalWon != null ? String(si.draftTotalWon) : '');
    const host = normalizeParticipantId(meeting.createdBy!.trim()) ?? meeting.createdBy!.trim();
    const raw = meeting.participantIds ?? [];
    const rows: string[] = [];
    const seen = new Set<string>();
    for (const x of raw) {
      const id = normalizeParticipantId(String(x)) ?? String(x).trim();
      if (!id || id === host) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push(id);
    }
    if (si?.selectedParticipantIds?.length) {
      setSelectedParticipantIds(
        new Set(si.selectedParticipantIds.map((x) => normalizeParticipantId(String(x)) ?? String(x).trim())),
      );
    } else {
      setSelectedParticipantIds(new Set(rows));
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
  }, [meeting, hostNorm]);

  useEffect(() => {
    if (receiptItems.length === 0) return;
    const sum = receiptItems.reduce((s, x) => s + x.amountWon, 0);
    setTotalWonInput(String(sum));
  }, [receiptItems]);

  useEffect(() => {
    if (!meeting?.id || !hostNorm || profileAccounts === null) return;
    const pk = `${meeting.id}:${profileAccounts.items.map((i) => i.id).join(',')}:${profileAccounts.defaultId ?? ''}`;
    if (lastAppliedProfileHostKeyRef.current === pk) return;
    lastAppliedProfileHostKeyRef.current = pk;

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

  const totalWonParsed = useMemo(() => {
    const t = totalWonInput.replace(/,/g, '').trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
  }, [totalWonInput]);

  const selectedCount = selectedParticipantIds.size;
  const perPersonWon =
    totalWonParsed != null && selectedCount > 0 ? Math.round(totalWonParsed / selectedCount) : null;

  const accessOk = useMemo(() => {
    if (!meeting || !userId?.trim()) return false;
    if (!isMeetingHost(meeting, userId)) return false;
    return isMeetingSettlementCtaEligibleForHost(meeting, userId, Date.now());
  }, [meeting, userId]);

  const settlementMeetingInfoLines = useMemo(() => {
    if (!meeting) {
      return {
        schedule: '미정',
        placePrimary: '—',
        placeSecondary: '' as string,
        settlement: formatPublicMeetingSettlementSummary('DUTCH', null),
      };
    }
    const schedule = formatSettlementScreenScheduleLine(meeting).trim() || '미정';
    const nameOrLoc = (meeting.placeName?.trim() || meeting.location?.trim() || '').trim();
    const addr = (meeting.address ?? '').trim();
    let placePrimary = nameOrLoc || addr || '—';
    let placeSecondary = '';
    if (nameOrLoc && addr && addr !== nameOrLoc) {
      placeSecondary = addr;
    }
    const cfg = parsePublicMeetingDetailsConfig(meeting.meetingConfig);
    const settlement = cfg
      ? formatPublicMeetingSettlementSummary(cfg.settlement, cfg.membershipFeeWon ?? null)
      : formatPublicMeetingSettlementSummary('DUTCH', null);
    return { schedule, placePrimary, placeSecondary, settlement };
  }, [meeting]);

  const persistSettlementDraftToServer = useCallback(async () => {
    if (!meetingId || !meeting) throw new Error('모임을 찾을 수 없어요.');
    const uid = (userId ?? '').trim();
    if (!uid) throw new Error('로그인이 필요합니다.');
    if (!profileAccounts?.items?.length) {
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
      draftTotalWon: totalWonParsed ?? undefined,
      hostBankCode: hostBankId.trim() || undefined,
      hostAccountNumber: hostAccountNumber.replace(/\D/g, '').trim() || undefined,
      hostAccountHolder: hostAccountHolder.trim() || undefined,
      hostAccountText: composedHostAccountText.trim() || undefined,
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
    totalWonParsed,
    hostBankId,
    hostAccountNumber,
    hostAccountHolder,
    composedHostAccountText,
    selectedCount,
    selectedParticipantIds,
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
      Alert.alert('알림', '앱 알림을 받을 참석자를 한 명 이상 선택해 주세요.');
      return;
    }
    if (totalWonParsed == null) {
      Alert.alert('알림', '총액을 숫자로 입력해 주세요.');
      return;
    }
    const hostAccount = composedHostAccountText.trim();
    if (!getSettlementBankById(hostBankId)) {
      Alert.alert('알림', '입금 은행을 선택해 주세요.');
      return;
    }
    if (!hostAccountNumber.replace(/\D/g, '').trim()) {
      Alert.alert('알림', '계좌번호를 입력해 주세요.');
      return;
    }
    if (!hostAccountHolder.trim()) {
      Alert.alert('알림', '예금주 이름을 입력해 주세요.');
      return;
    }
    if (!hostAccount) {
      Alert.alert('알림', '입금 계좌 정보를 확인해 주세요.');
      return;
    }
    setPushing(true);
    try {
      await persistSettlementDraftToServer();
      const recipients = [...selectedParticipantIds].slice(0, MAX_SETTLEMENT_PUSH_RECIPIENTS);
      const title = '정산 안내';
      const body = `「${(meeting.title ?? '').trim() || '모임'}」인당 ${perPersonWon != null ? `${perPersonWon.toLocaleString()}원` : ''} 정산 안내가 도착했어요.`;
      const amountStr = perPersonWon != null ? String(perPersonWon) : String(totalWonParsed);
      const data: Record<string, unknown> = {
        action: 'settlement_share',
        type: 'SETTLEMENT',
        meeting_id: meetingId,
        meetingId,
        amount: amountStr,
        host_account: maskHolderInHostAccountTextForShare(hostAccount),
      };
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
    totalWonParsed,
    perPersonWon,
    hostBankId,
    hostAccountNumber,
    hostAccountHolder,
    composedHostAccountText,
    persistSettlementDraftToServer,
    router,
  ]);

  const sharePayload = useCallback(() => {
    if (!meeting) return;
    return buildSettlementShareMessage({
      meetingTitle: meeting.title ?? '',
      meetingId: meeting.id,
      perPersonWon,
      totalWon: totalWonParsed,
      hostAccountText: composedHostAccountText,
    });
  }, [meeting, perPersonWon, totalWonParsed, composedHostAccountText]);

  const onShareSheet = useCallback(async () => {
    const msg = sharePayload();
    if (!msg) return;
    try {
      await shareSettlementText(msg);
    } catch {
      Alert.alert('오류', '공유를 완료하지 못했어요.');
    }
  }, [sharePayload]);

  const onSms = useCallback(async () => {
    if (Platform.OS === 'web') {
      await onShareSheet();
      return;
    }
    const msg = sharePayload();
    if (!msg) return;
    try {
      await openSettlementSmsComposer(msg);
    } catch {
      Alert.alert('오류', '문자 앱을 열지 못했어요.');
    }
  }, [sharePayload, onShareSheet]);

  const toggleParticipant = useCallback((id: string) => {
    setSelectedParticipantIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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
          <SettlementAccountsScreenTopBar title="정산" onBack={() => safeRouterBack(router)} />
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
          <SettlementAccountsScreenTopBar title="정산" onBack={() => safeRouterBack(router)} />
          <View style={styles.center}>
            <ActivityIndicator color={GinitTheme.colors.primary} />
          </View>
        </SafeAreaView>
      </ScreenShell>
    );
  }

  if (!accessOk) {
    return (
      <ScreenShell padded={false} style={styles.rootShell}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <SettlementAccountsScreenTopBar title="정산" onBack={() => safeRouterBack(router)} />
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
        <SettlementAccountsScreenTopBar title="정산" onBack={() => safeRouterBack(router)} />
        <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{(meeting.title ?? '').trim() || '모임'}</Text>
      <Text style={styles.hint}>참석자 명단은 변경되지 않습니다. 정산에 포함할 사람만 선택하세요.</Text>

      <View style={styles.meetingInfoBox}>
        <View style={styles.meetingInfoRow}>
          <Text style={styles.meetingInfoLabel}>일시</Text>
          <Text style={styles.meetingInfoValue} numberOfLines={3}>
            {settlementMeetingInfoLines.schedule}
          </Text>
        </View>
        <View style={styles.meetingInfoSep} />
        <View style={styles.meetingInfoRow}>
          <Text style={styles.meetingInfoLabel}>장소</Text>
          <View style={styles.meetingInfoValueCol}>
            <Text style={styles.meetingInfoValue} numberOfLines={3}>
              {settlementMeetingInfoLines.placePrimary}
            </Text>
            {settlementMeetingInfoLines.placeSecondary ? (
              <Text style={styles.meetingInfoValueMuted} numberOfLines={2}>
                {settlementMeetingInfoLines.placeSecondary}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.meetingInfoSep} />
        <View style={styles.meetingInfoRow}>
          <Text style={styles.meetingInfoLabel}>정산 방식</Text>
          <Text style={styles.meetingInfoValue} numberOfLines={2}>
            {settlementMeetingInfoLines.settlement}
          </Text>
        </View>
      </View>

      <Text style={styles.sectionLabel}>총액(원)</Text>
      <TextInput
        value={totalWonInput}
        onChangeText={setTotalWonInput}
        keyboardType="number-pad"
        placeholder="예: 120000"
        style={styles.input}
        placeholderTextColor={GinitTheme.colors.textMuted}
      />

      {profileAccounts === null ? (
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
          <View style={styles.sectionLabelRow}>
            <Text style={styles.sectionLabelInRow}>정산 계좌</Text>
            <GinitPressable
              onPress={() => router.push('/settlement/accounts')}
              style={({ pressed }) => [styles.manageLink, pressed && { opacity: 0.86 }]}>
              <Text style={styles.manageLinkText}>계좌 관리</Text>
            </GinitPressable>
          </View>
          <GinitPressable
            onPress={() => setAccountPickerOpen(true)}
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
      )}

      {perPersonWon != null ? (
        <Text style={styles.perPerson}>인당 약 {perPersonWon.toLocaleString()}원 ({selectedCount}명 기준)</Text>
      ) : null}

      <Text style={styles.sectionLabel}>참석자</Text>
      {participantRows.length === 0 ? (
        <Text style={styles.muted}>초대된 참석자가 없습니다.</Text>
      ) : (
        participantRows.map((pid) => {
          const on = selectedParticipantIds.has(pid);
          return (
            <GinitPressable
              key={pid}
              onPress={() => toggleParticipant(pid)}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}>
              <GinitSymbolicIcon name={on ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={GinitTheme.colors.primary} />
              <Text style={styles.rowLabel} numberOfLines={1}>
                {pid}
              </Text>
            </GinitPressable>
          );
        })
      )}

      <View style={styles.divider} />

      {Platform.OS !== 'web' ? (
        <>
          <Text style={styles.sectionLabel}>영수증 OCR</Text>
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
          {receiptItems.length > 0 ? (
            <ScrollView
              horizontal
              nestedScrollEnabled
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.receiptThumbRow}>
              {receiptItems.map((it) => (
                <View key={it.id} style={styles.receiptThumbColumn}>
                  <View style={styles.receiptThumbImageShell}>
                    <Image source={{ uri: it.previewUri }} style={styles.receiptThumbImg} contentFit="cover" />
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
          ) : null}
        </>
      ) : null}

      <GinitPressable
        onPress={onSaveDraft}
        disabled={saving}
        style={({ pressed }) => [styles.secondaryBtn, (pressed || saving) && { opacity: 0.86 }]}>
        <Text style={styles.secondaryBtnText}>{saving ? '저장 중…' : '임시 저장'}</Text>
      </GinitPressable>

      <GinitPressable
        onPress={onSendAppPush}
        disabled={pushing}
        style={({ pressed }) => [styles.primaryBtn, (pressed || pushing) && { opacity: 0.88 }]}>
        <Text style={styles.primaryBtnText}>{pushing ? '전송 중…' : '앱 알림 보내기(정산 완료 처리)'}</Text>
      </GinitPressable>

      <GinitPressable onPress={onShareSheet} style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.86 }]}>
        <Text style={styles.secondaryBtnText}>카카오톡 등으로 공유</Text>
      </GinitPressable>

      {Platform.OS !== 'web' ? (
        <GinitPressable onPress={onSms} style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.86 }]}>
          <Text style={styles.secondaryBtnText}>문자 보내기</Text>
        </GinitPressable>
      ) : null}
        </ScrollView>
        {profileAccounts != null && profileAccounts.items.length > 0 ? (
          <SettlementAccountPickerModal
            visible={accountPickerOpen}
            onClose={() => setAccountPickerOpen(false)}
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
  scrollContent: { paddingHorizontal: 20, paddingTop: 12, gap: 10 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: GinitTheme.colors.bg },
  padded: { flex: 1, paddingHorizontal: 20, backgroundColor: GinitTheme.colors.bg, gap: 16 },
  title: { ...GinitTheme.typography.h2, color: GinitTheme.colors.text },
  hint: { ...GinitTheme.typography.caption, color: GinitTheme.colors.textMuted },
  meetingInfoBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    borderRadius: 10,
    backgroundColor: GinitTheme.colors.bg,
    overflow: 'hidden',
  },
  meetingInfoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  meetingInfoLabel: {
    width: 72,
    fontSize: 13,
    fontWeight: '700',
    color: GinitTheme.colors.textSub,
    paddingTop: 1,
  },
  meetingInfoValue: { flex: 1, fontSize: 13, color: GinitTheme.colors.text, lineHeight: 18 },
  meetingInfoValueCol: { flex: 1, gap: 4 },
  meetingInfoValueMuted: { fontSize: 12, color: GinitTheme.colors.textMuted, lineHeight: 16 },
  meetingInfoSep: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 12,
    marginRight: 12,
    backgroundColor: GinitTheme.colors.border,
  },
  sectionLabel: { marginTop: 8, fontSize: 13, fontWeight: '700', color: GinitTheme.colors.textSub },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    gap: 8,
  },
  sectionLabelInRow: { fontSize: 13, fontWeight: '700', color: GinitTheme.colors.textSub, flexShrink: 0 },
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
  perPerson: { fontSize: 14, fontWeight: '600', color: GinitTheme.colors.primary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  rowLabel: { flex: 1, fontSize: 14, color: GinitTheme.colors.text },
  muted: { fontSize: 14, color: GinitTheme.colors.textMuted },
  body: { fontSize: 15, color: GinitTheme.colors.text, lineHeight: 22 },
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
  ocrRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ocrHint: { ...GinitTheme.typography.caption, color: GinitTheme.colors.textMuted },
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
  manageLink: { paddingVertical: 4 },
  manageLinkText: { fontSize: 13, fontWeight: '700', color: GinitTheme.colors.textSub },
  bankPlaceholder: { flex: 1, fontSize: 15, color: GinitTheme.colors.textMuted },
});
