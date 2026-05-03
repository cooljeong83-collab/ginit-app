import type { LatLng } from '@/src/lib/geo-distance';

export type OpenMeteoCurrent = {
  temperatureC: number;
  wmoCode: number;
};

/**
 * Open-Meteo current — 키 없음. 실패 시 null.
 */
export async function fetchOpenMeteoCurrent(
  coords: LatLng,
  timeoutMs = 5000,
): Promise<OpenMeteoCurrent | null> {
  const { latitude, longitude } = coords;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(String(latitude))}&longitude=${encodeURIComponent(String(longitude))}&current=temperature_2m,weather_code&timezone=Asia%2FSeoul`;

  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ac.signal });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        current?: { temperature_2m?: number; weather_code?: number };
      };
      const code = data?.current?.weather_code;
      const temp = data?.current?.temperature_2m;
      if (code == null || Number.isNaN(Number(code))) return null;
      if (typeof temp !== 'number' || !Number.isFinite(temp)) return null;
      return { temperatureC: temp, wmoCode: Number(code) };
    } finally {
      clearTimeout(t);
    }
  } catch {
    return null;
  }
}
