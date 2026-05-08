import { supabase } from '@/src/lib/supabase';

export type ChatLinkPreviewPayload = {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
};

/** Edge `unfurl-link-for-chat` — 실패 시 null */
export async function fetchChatLinkPreviewForSend(url: string): Promise<ChatLinkPreviewPayload | null> {
  const u = String(url ?? '').trim();
  if (!u) return null;
  try {
    const { data, error } = await supabase.functions.invoke('unfurl-link-for-chat', {
      body: { url: u },
    });
    if (error) return null;
    if (!data || typeof data !== 'object') return null;
    const d = data as Record<string, unknown>;
    if (d.ok !== true) return null;
    const outUrl = typeof d.url === 'string' ? d.url.trim() : '';
    if (!outUrl) return null;
    return {
      url: outUrl,
      title: typeof d.title === 'string' ? d.title : null,
      description: typeof d.description === 'string' ? d.description : null,
      imageUrl: typeof d.imageUrl === 'string' ? d.imageUrl : null,
      siteName: typeof d.siteName === 'string' ? d.siteName : null,
    };
  } catch {
    return null;
  }
}
