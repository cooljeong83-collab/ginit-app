import { Alert, Linking } from 'react-native';

export type ChatTextSegment =
  | { kind: 'text'; value: string }
  | { kind: 'link'; value: string; href: string };

const URL_IN_TEXT_RE = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;

function stripTrailingUrlPunct(s: string): string {
  return s.replace(/[)\].,;:!?]+$/g, '');
}

/** 텍스트에 포함된 첫 http(s) 링크(정규화된 href). 미리보기·전송 시 사용. */
export function extractFirstHttpUrlFromChatText(text: string): string | null {
  for (const seg of splitChatTextIntoLinkSegments(String(text ?? ''))) {
    if (seg.kind === 'link') return seg.href;
  }
  return null;
}

/**
 * 채팅 본문에서 http(s)·www… 주소 구간을 분리합니다. 닫는 괄호·구두점은 링크에서 제외합니다.
 */
export function splitChatTextIntoLinkSegments(input: string): ChatTextSegment[] {
  const text = String(input ?? '');
  if (!text) return [{ kind: 'text', value: '' }];

  const matches = [...text.matchAll(URL_IN_TEXT_RE)];
  if (matches.length === 0) return [{ kind: 'text', value: text }];

  const out: ChatTextSegment[] = [];
  let last = 0;
  for (const m of matches) {
    const start = m.index ?? 0;
    const raw = m[0] ?? '';
    if (start > last) {
      out.push({ kind: 'text', value: text.slice(last, start) });
    }
    const display = stripTrailingUrlPunct(raw);
    const hrefCandidate = /^www\./i.test(display) ? `https://${display}` : display;
    if (!display) {
      out.push({ kind: 'text', value: raw });
      last = start + raw.length;
      continue;
    }
    try {
      const u = new URL(hrefCandidate);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        out.push({ kind: 'link', value: display, href: u.toString() });
      } else {
        out.push({ kind: 'text', value: raw });
      }
    } catch {
      out.push({ kind: 'text', value: raw });
    }
    last = start + raw.length;
  }
  if (last < text.length) {
    out.push({ kind: 'text', value: text.slice(last) });
  }
  return out;
}

/** 카카오톡처럼 시스템 기본 브라우저(또는 해당 스킴 핸들러)로 엽니다. */
export async function openChatLinkInBrowser(url: string): Promise<void> {
  const href = String(url ?? '').trim();
  if (!href) return;
  try {
    const ok = await Linking.canOpenURL(href);
    if (!ok) {
      Alert.alert('링크', '이 주소를 열 수 없어요.');
      return;
    }
    await Linking.openURL(href);
  } catch {
    Alert.alert('링크', '브라우저로 열지 못했어요.');
  }
}
