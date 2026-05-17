import { supabase } from '@/src/lib/supabase';

export type ProfileFeedInterestRegions = {
  region_norms: string[];
  active_region_norm: string | null;
};

function parseStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    const s = typeof x === 'string' ? x.trim() : String(x ?? '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function parsePayload(data: unknown): ProfileFeedInterestRegions {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { region_norms: [], active_region_norm: null };
  }
  const o = data as Record<string, unknown>;
  const activeRaw = o.active_region_norm;
  const active =
    typeof activeRaw === 'string' && activeRaw.trim() ? activeRaw.trim() : null;
  return {
    region_norms: parseStringArray(o.region_norms),
    active_region_norm: active,
  };
}

export async function fetchProfileFeedInterestRegions(
  appUserId: string,
): Promise<{ ok: true; data: ProfileFeedInterestRegions } | { ok: false }> {
  const id = appUserId.trim();
  if (!id) return { ok: true, data: { region_norms: [], active_region_norm: null } };
  const { data, error } = await supabase.rpc('get_profile_feed_interest_regions', {
    p_app_user_id: id,
  });
  if (error) {
    if (__DEV__) {
      console.warn('[feed-interest-regions] get', error.message?.trim() || error);
    }
    return { ok: false };
  }
  return { ok: true, data: parsePayload(data) };
}

export async function replaceProfileFeedInterestRegions(
  appUserId: string,
  regionNorms: string[],
  activeRegionNorm: string | null,
): Promise<{ ok: boolean; message?: string }> {
  const id = appUserId.trim();
  if (!id) return { ok: false, message: 'app_user_id required' };
  const { error } = await supabase.rpc('replace_profile_feed_interest_regions', {
    p_app_user_id: id,
    p_region_norms: regionNorms,
    p_active_region_norm: activeRegionNorm,
  });
  if (error) {
    const message = error.message?.trim() || 'replace_profile_feed_interest_regions failed';
    if (__DEV__) console.warn('[feed-interest-regions] replace', message);
    return { ok: false, message };
  }
  return { ok: true };
}
