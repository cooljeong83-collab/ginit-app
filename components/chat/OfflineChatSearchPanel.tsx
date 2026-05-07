import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { HighlightedText } from '@/components/ui/HighlightedText';
import type { OfflineChatRoomKey } from '@/src/lib/offline-chat/offline-chat-types';
import { listRecentSearches, recordRecentSearch } from '@/src/lib/offline-chat/recent-searches';
import { searchAllRoomsLocal, searchInRoomLocal, type OfflineChatSearchRow } from '@/src/lib/offline-chat/offline-chat-search';

type Props = {
  mode: 'room' | 'global';
  roomKey?: OfflineChatRoomKey;
  placeholder?: string;
  onPick: (row: OfflineChatSearchRow) => void;
  /** 외부(헤더) 검색어를 그대로 사용하고, 패널 내부 입력창을 숨깁니다 */
  externalQuery?: string;
  hideSearchBar?: boolean;
  /**
   * 엔터 등으로 확정된 검색어. 이 값이 바뀔 때만 로컬 DB를 조회합니다.
   * `hideSearchBar`일 때는 부모에서 반드시 넘겨 주세요(빈 문자열 포함).
   */
  submittedQuery?: string;
};

/**
 * 로컬 DB 기반 방/전체 검색 패널.
 * - Firestore read 0
 * - 입력과 동시 자동 검색 없음: `submittedQuery`(또는 내부 입력의 submit) 시에만 목록 갱신
 */
export function OfflineChatSearchPanel({
  mode,
  roomKey,
  placeholder = '검색어 입력',
  onPick,
  externalQuery,
  hideSearchBar = false,
  submittedQuery: submittedQueryProp,
}: Props) {
  const [query, setQuery] = useState('');
  const effectiveQuery = externalQuery != null ? String(externalQuery) : query;
  const [internalSubmitted, setInternalSubmitted] = useState('');
  const submittedQuery =
    submittedQueryProp !== undefined ? String(submittedQueryProp ?? '') : internalSubmitted;

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<OfflineChatSearchRow[]>([]);
  const [recent, setRecent] = useState<Array<{ query: string; lastUsedAtMs: number }>>([]);

  const scopeArgs = useMemo(() => {
    if (mode === 'global') return { scope: 'global' as const, roomId: null };
    return { scope: 'room' as const, roomId: roomKey?.roomId ?? null };
  }, [mode, roomKey?.roomId]);

  useEffect(() => {
    void listRecentSearches({ ...scopeArgs, limit: 12 }).then(setRecent);
  }, [scopeArgs]);

  useEffect(() => {
    const q = submittedQuery.trim();
    let cancelled = false;
    void (async () => {
      if (!q) {
        setRows([]);
        return;
      }
      setLoading(true);
      try {
        const out =
          mode === 'global'
            ? await searchAllRoomsLocal({ query: q, limit: 80 })
            : roomKey
              ? await searchInRoomLocal({ key: roomKey, query: q, limit: 60 })
              : [];
        if (!cancelled) setRows(out);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [submittedQuery, mode, roomKey]);

  const highlightQuery = submittedQuery.trim();

  const onSubmit = async () => {
    const q = effectiveQuery.trim();
    if (!q) return;
    if (submittedQueryProp === undefined) {
      setInternalSubmitted(q);
    }
    await recordRecentSearch({ scope: scopeArgs.scope, roomId: scopeArgs.roomId, query: q });
    setRecent(await listRecentSearches({ ...scopeArgs, limit: 12 }));
  };

  const renderFtsSnippet = (snippet: string) => {
    const s = String(snippet ?? '');
    if (!s) return null;
    const out: Array<{ t: string; hit: boolean }> = [];
    let i = 0;
    while (i < s.length) {
      const a = s.indexOf('[[', i);
      if (a < 0) {
        out.push({ t: s.slice(i), hit: false });
        break;
      }
      if (a > i) out.push({ t: s.slice(i, a), hit: false });
      const b = s.indexOf(']]', a + 2);
      if (b < 0) {
        out.push({ t: s.slice(a), hit: false });
        break;
      }
      out.push({ t: s.slice(a + 2, b), hit: true });
      i = b + 2;
    }
    return (
      <Text style={sStyle.body} numberOfLines={2}>
        {out.map((p, idx) =>
          p.hit ? (
            <Text key={idx} style={{ color: '#4527A0', fontWeight: '800' }}>
              {p.t}
            </Text>
          ) : (
            <Text key={idx}>{p.t}</Text>
          ),
        )}
      </Text>
    );
  };

  return (
    <View style={sStyle.wrap}>
      {!hideSearchBar ? (
        <View style={sStyle.searchRow}>
          <TextInput
            value={effectiveQuery}
            onChangeText={setQuery}
            placeholder={placeholder}
            placeholderTextColor="#94a3b8"
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            onSubmitEditing={() => void onSubmit()}
            style={sStyle.input}
          />
          {loading ? <ActivityIndicator /> : null}
        </View>
      ) : null}

      {recent.length && !effectiveQuery.trim() && !hideSearchBar ? (
        <View style={sStyle.recentBlock}>
          <Text style={sStyle.recentTitle}>최근 검색</Text>
          <View style={sStyle.recentChips}>
            {recent.map((r) => (
              <Pressable
                key={r.query}
                onPress={() => {
                  setQuery(r.query);
                  setInternalSubmitted(r.query);
                }}
                style={({ pressed }) => [sStyle.chip, pressed && sStyle.chipPressed]}
                accessibilityRole="button"
                accessibilityLabel={`최근 검색어 ${r.query}`}>
                <Text style={sStyle.chipText} numberOfLines={1}>
                  {r.query}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View style={sStyle.results}>
        {rows.map((r) => (
          <Pressable
            key={`${r.roomType}:${r.roomId}:${r.messageId}`}
            onPress={() => onPick(r)}
            style={({ pressed }) => [sStyle.row, pressed && sStyle.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel="검색 결과">
            <Text style={sStyle.meta} numberOfLines={1}>
              {r.senderName ?? '회원'} · {new Date(r.createdAtMs || 0).toLocaleString('ko-KR')}
            </Text>
            {r.snippet?.trim() ? (
              renderFtsSnippet(r.snippet)
            ) : (
              <HighlightedText style={sStyle.body} text={r.text ?? ''} query={highlightQuery} />
            )}
          </Pressable>
        ))}
        {!loading && highlightQuery && rows.length === 0 ? <Text style={sStyle.empty}>결과가 없어요.</Text> : null}
      </View>
    </View>
  );
}

const sStyle = StyleSheet.create({
  wrap: { padding: 12, gap: 10 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.08)',
  },
  input: { flex: 1, minWidth: 0, fontSize: 16, color: '#0f172a', paddingVertical: 10 },
  recentBlock: { gap: 8 },
  recentTitle: { fontSize: 13, fontWeight: '800', color: '#475569' },
  recentChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.10)',
    maxWidth: 240,
  },
  chipPressed: { opacity: 0.86 },
  chipText: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  results: { gap: 0 },
  row: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(15, 23, 42, 0.06)' },
  rowPressed: { backgroundColor: 'rgba(15, 23, 42, 0.04)' },
  meta: { fontSize: 12, fontWeight: '700', color: '#94a3b8', marginBottom: 4 },
  body: { fontSize: 14, fontWeight: '700', color: '#0f172a', lineHeight: 20 },
  empty: { textAlign: 'center', marginTop: 30, fontSize: 14, fontWeight: '700', color: '#94a3b8' },
});
