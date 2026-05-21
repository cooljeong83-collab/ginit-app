export type AdFreeProfileFields = {
  adFreeUntil?: string | null;
};

/** RPC/캐시 `ad_free_until` · `adFreeUntil` → ISO 문자열(없으면 null) */
export function adFreeUntilToIsoString(data: Record<string, unknown>): string | null {
  const raw =
    'adFreeUntil' in data ? data.adFreeUntil : 'ad_free_until' in data ? data.ad_free_until : null;
  const d = parseAdFreeUntil(raw);
  return d ? d.toISOString() : null;
}

/** `profiles.ad_free_until` — ISO 문자열 또는 Date */
export function parseAdFreeUntil(raw: unknown): Date | null {
  if (raw == null) return null;
  if (raw instanceof Date) {
    return Number.isFinite(raw.getTime()) ? raw : null;
  }
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return null;
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? new Date(ms) : null;
  }
  return null;
}

/** `ad_free_until > now` 이면 광고 없음 */
export function isProfileAdFree(
  profile: AdFreeProfileFields | null | undefined,
  atMs: number = Date.now(),
): boolean {
  const until = parseAdFreeUntil(profile?.adFreeUntil);
  if (!until) return false;
  return until.getTime() > atMs;
}
