/**
 * 사용자 정산 계좌 목록 — `profiles.metadata` 단일 키로 저장.
 * 탈퇴 시 `withdraw_anonymize_profile`가 metadata를 `{}`로 초기화하면 함께 삭제됩니다.
 */
import { getSettlementBankById } from '@/src/lib/korean-banks-settlement';
import { getUserProfile, updateUserProfile } from '@/src/lib/user-profile';

/** `upsert_profile_payload` metadata_patch 병합 시 키 단위로 교체됨 */
export const PROFILE_META_GINIT_SETTLEMENT_ACCOUNTS_V1 = 'ginit_settlement_accounts_v1' as const;

export type UserSettlementAccountItem = {
  id: string;
  bankCode: string;
  accountNumber: string;
  holder: string;
};

export type UserSettlementAccountsState = {
  defaultId: string | null;
  items: UserSettlementAccountItem[];
};

const MAX_SETTLEMENT_ACCOUNTS = 20;

function newAccountId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function normalizeDigits(s: string): string {
  return s.replace(/\D/g, '');
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

/** 표시용 — 끝 4자리만 노출 */
export function maskSettlementAccountDigits(digits: string): string {
  const d = normalizeDigits(digits);
  if (d.length <= 4) return d || '—';
  return `···${d.slice(-4)}`;
}

export function parseUserSettlementAccountsFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): UserSettlementAccountsState {
  if (!metadata || typeof metadata !== 'object') return { defaultId: null, items: [] };
  const raw = metadata[PROFILE_META_GINIT_SETTLEMENT_ACCOUNTS_V1];
  if (!isPlainObject(raw)) return { defaultId: null, items: [] };

  const defRaw = raw.defaultId ?? raw.default_id;
  const defaultId = typeof defRaw === 'string' && defRaw.trim() ? defRaw.trim() : null;

  const itemsRaw = raw.items;
  const items: UserSettlementAccountItem[] = [];
  if (Array.isArray(itemsRaw)) {
    for (const row of itemsRaw) {
      if (!isPlainObject(row)) continue;
      const id = typeof row.id === 'string' ? row.id.trim() : '';
      const bankCode = typeof row.bankCode === 'string' ? row.bankCode.trim() : '';
      const numRaw = row.accountNumber ?? row.account_number;
      const holderRaw = row.holder ?? row.account_holder;
      const accountNumber = typeof numRaw === 'string' ? normalizeDigits(numRaw) : '';
      const holder = typeof holderRaw === 'string' ? holderRaw.trim() : '';
      if (!id || !bankCode || !accountNumber || !holder) continue;
      if (!getSettlementBankById(bankCode)) continue;
      items.push({ id, bankCode, accountNumber, holder });
    }
  }

  return normalizeSettlementAccountsState({ defaultId, items });
}

export function normalizeSettlementAccountsState(state: UserSettlementAccountsState): UserSettlementAccountsState {
  const items = state.items.slice(0, MAX_SETTLEMENT_ACCOUNTS);
  let defaultId = state.defaultId?.trim() || null;
  if (items.length === 0) return { defaultId: null, items: [] };
  if (items.length === 1) return { defaultId: items[0]!.id, items };
  if (!defaultId || !items.some((x) => x.id === defaultId)) {
    defaultId = items[0]!.id;
  }
  return { defaultId, items };
}

/** 여러 개일 때 대표 id — 유효하지 않으면 첫 항목 */
export function resolveEffectiveDefaultId(
  items: UserSettlementAccountItem[],
  defaultId: string | null,
): string | null {
  if (items.length === 0) return null;
  if (items.length === 1) return items[0]!.id;
  const d = defaultId?.trim() ?? '';
  if (d && items.some((x) => x.id === d)) return d;
  return items[0]!.id;
}

export function getUserSettlementAccountById(
  state: UserSettlementAccountsState,
  id: string,
): UserSettlementAccountItem | null {
  const k = id.trim();
  if (!k) return null;
  return state.items.find((x) => x.id === k) ?? null;
}

export async function loadUserSettlementAccounts(appUserId: string): Promise<UserSettlementAccountsState> {
  const id = appUserId.trim();
  if (!id) return { defaultId: null, items: [] };
  const p = await getUserProfile(id);
  return parseUserSettlementAccountsFromMetadata(p?.metadata ?? null);
}

async function persistSettlementAccountsState(
  appUserId: string,
  next: UserSettlementAccountsState,
): Promise<void> {
  const id = appUserId.trim();
  if (!id) throw new Error('사용자 ID가 없습니다.');
  const normalized = normalizeSettlementAccountsState(next);
  const payload: UserSettlementAccountsState = {
    defaultId: normalized.defaultId,
    items: normalized.items.map((x) => ({
      id: x.id,
      bankCode: x.bankCode.trim(),
      accountNumber: normalizeDigits(x.accountNumber),
      holder: x.holder.trim(),
    })),
  };
  await updateUserProfile(id, {
    metadata: {
      [PROFILE_META_GINIT_SETTLEMENT_ACCOUNTS_V1]: {
        defaultId: payload.defaultId,
        items: payload.items.map((x) => ({
          id: x.id,
          bankCode: x.bankCode,
          accountNumber: x.accountNumber,
          holder: x.holder,
        })),
      },
    },
  });
}

export async function saveUserSettlementAccount(
  appUserId: string,
  input: { id?: string | null; bankCode: string; accountNumber: string; holder: string },
): Promise<void> {
  const bankCode = input.bankCode.trim();
  const accountNumber = normalizeDigits(input.accountNumber);
  const holder = input.holder.trim();
  if (!getSettlementBankById(bankCode)) throw new Error('은행을 선택해 주세요.');
  if (!accountNumber) throw new Error('계좌번호를 입력해 주세요.');
  if (!holder) throw new Error('예금주 이름을 입력해 주세요.');

  const prev = await loadUserSettlementAccounts(appUserId);
  const editId = typeof input.id === 'string' ? input.id.trim() : '';
  let items: UserSettlementAccountItem[];

  if (editId && prev.items.some((x) => x.id === editId)) {
    items = prev.items.map((x) =>
      x.id === editId ? { ...x, bankCode, accountNumber, holder } : x,
    );
  } else {
    if (prev.items.length >= MAX_SETTLEMENT_ACCOUNTS) {
      throw new Error(`정산 계좌는 최대 ${MAX_SETTLEMENT_ACCOUNTS}개까지 등록할 수 있어요.`);
    }
    items = [...prev.items, { id: newAccountId(), bankCode, accountNumber, holder }];
  }

  await persistSettlementAccountsState(appUserId, { defaultId: prev.defaultId, items });
}

export async function deleteUserSettlementAccount(appUserId: string, accountId: string): Promise<void> {
  const rid = accountId.trim();
  if (!rid) return;
  const prev = await loadUserSettlementAccounts(appUserId);
  const items = prev.items.filter((x) => x.id !== rid);
  let defaultId = prev.defaultId;
  if (defaultId === rid) defaultId = null;
  await persistSettlementAccountsState(appUserId, normalizeSettlementAccountsState({ defaultId, items }));
}

export async function setDefaultUserSettlementAccount(appUserId: string, accountId: string): Promise<void> {
  const id = accountId.trim();
  if (!id) throw new Error('계좌를 선택해 주세요.');
  const prev = await loadUserSettlementAccounts(appUserId);
  if (!prev.items.some((x) => x.id === id)) throw new Error('등록된 계좌를 찾을 수 없어요.');
  await persistSettlementAccountsState(appUserId, { ...prev, defaultId: id });
}
