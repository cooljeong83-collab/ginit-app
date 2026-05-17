import type { MeetingChatLinkPreview } from '@/src/lib/meeting-chat';

/** DB/Edge/레거시 필드명을 `MeetingChatLinkPreview`로 통일 */
export function normalizeMeetingChatLinkPreview(raw: unknown): MeetingChatLinkPreview | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const url = pickString(o.url);
  if (!url) return null;
  const imageUrl = normalizeLinkPreviewImageUrl(
    pickString(o.imageUrl) ?? pickString(o.image) ?? pickString(o.thumbnail) ?? pickString(o.thumbnailUrl),
  );
  return {
    url,
    title: pickString(o.title),
    description: pickString(o.description),
    imageUrl,
    siteName: pickString(o.siteName) ?? pickString(o.site_name),
  };
}

export function normalizeLinkPreviewImageUrl(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (s.startsWith('//')) return `https:${s}`;
  if (/^https?:\/\//i.test(s)) return s;
  return null;
}

function pickString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}
