/**
 * Supabase Storage 공개 객체 URL → `render/image` 썸네일(디코딩·전송량 감소).
 * 그 외 URL은 그대로 둡니다.
 */
export function withSupabaseStorageListThumbnail(
  url: string | null | undefined,
  width = 320,
): string | null {
  const raw = typeof url === 'string' ? url.trim() : '';
  if (!raw) return null;
  const marker = '/storage/v1/object/public/';
  const i = raw.indexOf(marker);
  if (i === -1) return raw;
  const origin = raw.slice(0, i);
  const rest = raw.slice(i + marker.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return raw;
  const bucket = rest.slice(0, slash);
  const objectPath = rest.slice(slash + 1);
  if (!bucket || !objectPath) return raw;
  const w = Math.max(64, Math.min(800, Math.trunc(width)));
  const encPath = objectPath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `${origin}/storage/v1/render/image/public/${encodeURIComponent(bucket)}/${encPath}?width=${w}&height=${w}&resize=cover`;
}

export function isHttpRemoteImageUrl(raw: string | null | undefined): raw is string {
  const t = raw?.trim();
  if (!t) return false;
  try {
    const u = new URL(t);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** http(s) 원본 → Supabase Storage는 `render/image` 썸네일, 그 외 URL은 그대로 */
export function resolveHttpImageDisplayUri(
  url: string | null | undefined,
  width = 320,
): string | null {
  if (!isHttpRemoteImageUrl(url)) return null;
  const trimmed = url.trim();
  return withSupabaseStorageListThumbnail(trimmed, width) ?? trimmed;
}
