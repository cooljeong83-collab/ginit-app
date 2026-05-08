/**
 * 채팅 링크 미리보기용 OG/Twitter 메타 추출.
 * POST JSON: { "url": "https://..." }
 * 응답: { "ok": true, "url", "title", "description", "imageUrl", "siteName" } | { "ok": false, "reason" }
 *
 * SSRF 완화: http(s)만, 사설/루프백 호스트명·IPv4 대역 차단.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_HTML_BYTES = 600_000;
const FETCH_MS = 9_000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

function isBlockedIpv4(a: number, b: number, c: number, d: number): boolean {
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isUrlSafeForFetch(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (host === '[::1]' || host === '::1') return false;

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const p = v4.slice(1, 5).map((x) => Number(x));
    if (p.some((n) => n > 255)) return false;
    if (isBlockedIpv4(p[0]!, p[1]!, p[2]!, p[3]!)) return false;
    return true;
  }
  if (host.includes(':')) return false;
  return true;
}

function resolveUrl(base: string, candidate: string | null): string | null {
  if (!candidate?.trim()) return null;
  let c = candidate.trim();
  if (c.startsWith('//')) c = `https:${c}`;
  try {
    const u = new URL(c, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function pickMeta(html: string, name: 'og:title' | 'og:description' | 'og:image' | 'og:site_name'): string | null {
  const prop = name;
  const patterns = [
    // 속성 순서/공백/추가 속성에 더 관대하게(네이버/국내 사이트 대응)
    new RegExp(`<meta[^>]+property=["']?${prop}["']?[^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']?${prop}["']?`, 'i'),
    // content가 따옴표 없이 나오는 케이스(드물지만 존재)
    new RegExp(`<meta[^>]+property=["']?${prop}["']?[^>]+content=([^\\s>]+)`, 'i'),
    new RegExp(`<meta[^>]+content=([^\\s>]+)[^>]+property=["']?${prop}["']?`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]?.trim()) return decodeBasicEntities(m[1].trim().replace(/^['"]|['"]$/g, ''));
  }
  return null;
}

function pickTwitterImage(html: string): string | null {
  const patterns = [
    /<meta\s+name=["']twitter:image["']\s+content=["']([^"']*)["']/i,
    /<meta\s+content=["']([^"']*)["']\s+name=["']twitter:image["']/i,
    /<meta\s+name=["']twitter:image:src["']\s+content=["']([^"']*)["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]?.trim()) return decodeBasicEntities(m[1].trim());
  }
  return null;
}

function pickTitleTag(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]{1,500})<\/title>/i);
  if (m?.[1]?.trim()) return decodeBasicEntities(m[1].trim().replace(/\s+/g, ' '));
  return null;
}

type OkBody = {
  ok: true;
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ ok: false, reason: 'method' }, 405);

  let body: { url?: string };
  try {
    body = (await req.json()) as { url?: string };
  } catch {
    return jsonResponse({ ok: false, reason: 'json' }, 400);
  }

  const raw = typeof body.url === 'string' ? body.url.trim() : '';
  if (!raw) return jsonResponse({ ok: false, reason: 'url' }, 400);

  let pageUrl: URL;
  try {
    const href = /^www\./i.test(raw) ? `https://${raw}` : raw;
    pageUrl = new URL(href);
  } catch {
    return jsonResponse({ ok: false, reason: 'parse' }, 400);
  }

  if (!isUrlSafeForFetch(pageUrl)) {
    return jsonResponse({ ok: false, reason: 'blocked_host' }, 400);
  }

  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort(), FETCH_MS);
  let finalUrl = pageUrl.toString();
  let html = '';
  try {
    const res = await fetch(pageUrl.toString(), {
      signal: ac.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GinitChatPreview/1.0)',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      },
    });
    finalUrl = res.url || pageUrl.toString();
    const buf = await res.arrayBuffer();
    const slice = buf.byteLength > MAX_HTML_BYTES ? buf.slice(0, MAX_HTML_BYTES) : buf;
    html = new TextDecoder('utf-8', { fatal: false }).decode(slice);
  } catch (e) {
    clearTimeout(tid);
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ ok: false, reason: 'fetch', detail: msg.slice(0, 200) }, 502);
  } finally {
    clearTimeout(tid);
  }

  const title = pickMeta(html, 'og:title') ?? pickTitleTag(html);
  const description = pickMeta(html, 'og:description');
  const siteName = pickMeta(html, 'og:site_name');
  const imgRaw = pickMeta(html, 'og:image') ?? pickTwitterImage(html);
  const imageUrl = resolveUrl(finalUrl, imgRaw);

  const out: OkBody = {
    ok: true,
    url: finalUrl.split('#')[0] ?? finalUrl,
    title: title?.slice(0, 300) ?? null,
    description: description?.slice(0, 500) ?? null,
    imageUrl,
    siteName: siteName?.slice(0, 120) ?? null,
  };

  return jsonResponse(out);
});
