import { extractFirstHttpUrlFromChatText } from '@/src/lib/chat-text-linkify';
import { fetchChatLinkPreviewForSend } from '@/src/lib/chat-link-preview-client';
import { stripUndefinedDeep } from '@/src/lib/firestore-utils';

const PREVIEW_FETCH_MS = 4000;

/** Firestore `linkPreview` 필드용. 타임아웃·실패 시 undefined. */
export async function buildLinkPreviewForChatText(text: string): Promise<Record<string, unknown> | undefined> {
  const first = extractFirstHttpUrlFromChatText(text);
  if (!first) return undefined;

  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), PREVIEW_FETCH_MS));
  const preview = await Promise.race([fetchChatLinkPreviewForSend(first), timeout]);
  if (!preview) return undefined;

  return stripUndefinedDeep({
    url: preview.url,
    title: preview.title ?? undefined,
    description: preview.description ?? undefined,
    imageUrl: preview.imageUrl ?? undefined,
    siteName: preview.siteName ?? undefined,
  }) as Record<string, unknown>;
}
