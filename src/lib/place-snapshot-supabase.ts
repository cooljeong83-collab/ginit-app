import { supabase } from '@/src/lib/supabase';

export async function upsertPlaceSnapshotOnServer(input: {
  placeKey: string;
  placeName: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  category?: string | null;
  naverPlaceLink?: string | null;
  preferredPhotoMediaUrl?: string | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const pk = input.placeKey.trim();
  const name = input.placeName.trim();
  if (!pk || !name) return { ok: false, message: 'placeKey 또는 장소명이 비어 있습니다.' };

  const { error } = await supabase.rpc('upsert_place_snapshot', {
    p_place_key: pk,
    p_place_name: name,
    p_address: input.address ?? null,
    p_latitude: input.latitude ?? null,
    p_longitude: input.longitude ?? null,
    p_category: input.category ?? null,
    p_naver_place_link: input.naverPlaceLink ?? null,
    p_preferred_photo_media_url: input.preferredPhotoMediaUrl ?? null,
  });

  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
