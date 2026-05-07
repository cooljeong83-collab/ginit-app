export type ChatSearchSession = {
  query: string;
  /** newest-first message id list */
  matchIds: string[];
  /** index into matchIds (0..len-1), -1 means none selected yet */
  cursorIndex: number;
  /** scan cursor for newest-first message arrays */
  scanCursor: number;
};

export function createChatSearchSession(query: string): ChatSearchSession {
  return {
    query: String(query ?? '').trim(),
    matchIds: [],
    cursorIndex: -1,
    scanCursor: 0,
  };
}

export function resetChatSearchSession(prev: ChatSearchSession, query: string): ChatSearchSession {
  const q = String(query ?? '').trim();
  if (prev.query === q) return prev;
  return createChatSearchSession(q);
}

export type StepNextArgs<T> = {
  session: ChatSearchSession;
  /** returns current newest-first messages */
  getMessagesNewestFirst: () => T[];
  /** extracts stable id */
  getId: (m: T) => string;
  /** checks if message matches */
  isMatch: (m: T, queryLower: string) => boolean;
  /** fetch older page (adds to messages) */
  fetchNextPage?: () => Promise<void>;
  hasNextPage?: boolean;
  /** limits per step */
  maxAdditionalPages?: number;
  maxMessagesScanned?: number;
};

type StepResult = { session: ChatSearchSession; foundId: string | null; exhausted: boolean };

async function tick(): Promise<void> {
  await new Promise<void>((r) => setTimeout(() => r(), 0));
}

export async function stepNextChatMatch<T>({
  session,
  getMessagesNewestFirst,
  getId,
  isMatch,
  fetchNextPage,
  hasNextPage,
  maxAdditionalPages = 3,
  maxMessagesScanned = 800,
}: StepNextArgs<T>): Promise<StepResult> {
  const q = session.query.trim().toLowerCase();
  if (!q) return { session, foundId: null, exhausted: true };

  let next = { ...session };
  let pagesLoaded = 0;
  let scanned = 0;

  for (;;) {
    const list = getMessagesNewestFirst();
    for (let i = Math.max(0, next.scanCursor); i < list.length; i++) {
      scanned++;
      if (scanned > maxMessagesScanned) {
        return { session: next, foundId: null, exhausted: false };
      }
      const m = list[i]!;
      if (!isMatch(m, q)) continue;
      const id = String(getId(m) ?? '').trim();
      if (!id) continue;
      if (!next.matchIds.includes(id)) {
        next.matchIds = [...next.matchIds, id];
      }
      next.cursorIndex = next.matchIds.indexOf(id);
      next.scanCursor = i + 1;
      return { session: next, foundId: id, exhausted: false };
    }

    next.scanCursor = list.length;
    const canLoadMore = Boolean(fetchNextPage && hasNextPage);
    if (!canLoadMore) return { session: next, foundId: null, exhausted: true };
    if (pagesLoaded >= maxAdditionalPages) return { session: next, foundId: null, exhausted: false };

    pagesLoaded++;
    await fetchNextPage!();
    // let react-query/state settle
    await tick();
  }
}

export function stepPrevChatMatch(session: ChatSearchSession): { session: ChatSearchSession; foundId: string | null } {
  if (session.matchIds.length === 0) return { session, foundId: null };
  if (session.cursorIndex <= 0) {
    return { session: { ...session, cursorIndex: 0 }, foundId: session.matchIds[0] ?? null };
  }
  const ix = Math.max(0, session.cursorIndex - 1);
  const id = session.matchIds[ix] ?? null;
  return { session: { ...session, cursorIndex: ix }, foundId: id };
}

