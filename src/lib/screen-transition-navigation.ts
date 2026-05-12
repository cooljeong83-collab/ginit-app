import { useMemo } from 'react';
import { useRouter, type Href, type Router } from 'expo-router';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';

import { useScreenTransition, type ScreenTransitionRunOptions } from '@/src/context/ScreenTransitionContext';
import { useUserSession } from '@/src/context/UserSessionContext';
import { getMeetingById } from '@/src/lib/meetings';
import { meetingDetailQueryKey } from '@/src/hooks/use-meeting-detail-query';
import { ensureSocialChatRoomDoc, parsePeerFromSocialRoomId } from '@/src/lib/social-chat-rooms';
import { getUserProfile } from '@/src/lib/user-profile';

type TransitionNavMethod = 'push' | 'replace';
type TransitionHref = Href | string;

type TransitionContext = {
  queryClient: QueryClient;
  userId?: string | null;
};

type TransitionPreloader = (href: TransitionHref, ctx: TransitionContext) => Promise<void>;

const PRELOAD_TIMEOUT_MS = 4200;

function hrefPathname(href: TransitionHref): string {
  if (typeof href === 'string') return href.split('?')[0] ?? href;
  const obj = href as { pathname?: unknown };
  return typeof obj.pathname === 'string' ? obj.pathname : '';
}

function pathSegments(pathname: string): string[] {
  return pathname
    .split('/')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => decodeURIComponent(x));
}

function withTimeout(promise: Promise<void>, timeoutMs = PRELOAD_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    promise
      .catch(() => {
        /* 전환 자체는 막지 않습니다. */
      })
      .finally(() => {
        clearTimeout(timer);
        resolve();
      });
  });
}

async function preloadMeetingDetail(meetingId: string, queryClient: QueryClient): Promise<void> {
  const id = meetingId.trim();
  if (!id) return;
  await queryClient.ensureQueryData({
    queryKey: meetingDetailQueryKey(id),
    queryFn: () => getMeetingById(id),
    staleTime: 5 * 60 * 1000,
  });
}

async function preloadSocialChat(roomId: string, ctx: TransitionContext): Promise<void> {
  const rid = roomId.trim();
  if (!rid) return;
  const uid = ctx.userId?.trim() ?? '';
  const peerId = uid ? (parsePeerFromSocialRoomId(rid, uid) ?? '') : '';
  if (uid && peerId) {
    await ensureSocialChatRoomDoc(rid, uid, peerId).catch(() => {});
  }
}

const routePreloaders: TransitionPreloader[] = [
  async (href, ctx) => {
    const [first, second, third] = pathSegments(hrefPathname(href));
    if (first === 'meeting' && second && !third) {
      await preloadMeetingDetail(second, ctx.queryClient);
    }
  },
  async (href, ctx) => {
    const [first, second, third] = pathSegments(hrefPathname(href));
    if (first === 'meeting-chat' && second && !third) {
      // 채팅은 WatermelonDB local-first 렌더가 우선이므로 이동 전 Firestore prefetch로 전역 스플래시를 잡아두지 않습니다.
      void preloadMeetingDetail(second, ctx.queryClient).catch(() => {});
    }
  },
  async (href, ctx) => {
    const [first, second, third] = pathSegments(hrefPathname(href));
    if (first === 'social-chat' && second && !third) {
      await preloadSocialChat(second, ctx);
    }
  },
  async (href) => {
    const [first, second, third] = pathSegments(hrefPathname(href));
    if (first === 'profile' && second === 'user' && third) {
      await getUserProfile(third).catch(() => {});
    }
  },
];

async function preloadTransitionTarget(href: TransitionHref, ctx: TransitionContext): Promise<void> {
  const target = hrefPathname(href);
  if (!target) return;
  await Promise.all(routePreloaders.map((preload) => withTimeout(preload(href, ctx))));
}

function transitionLabelForHref(href: TransitionHref): string {
  const [first] = pathSegments(hrefPathname(href));
  if (first === 'meeting-chat' || first === 'social-chat') return '채팅방을 불러오는 중…';
  if (first === 'meeting') return '모임을 불러오는 중…';
  return '화면을 불러오는 중…';
}

function isLocalFirstChatHref(href: TransitionHref): boolean {
  const [first, second, third] = pathSegments(hrefPathname(href));
  return (first === 'meeting-chat' || first === 'social-chat') && Boolean(second) && !third;
}

function warmUpLocalFirstChatHref(href: TransitionHref, ctx: TransitionContext): void {
  const [first, second] = pathSegments(hrefPathname(href));
  if (!second) return;
  if (first === 'meeting-chat') {
    void preloadMeetingDetail(second, ctx.queryClient).catch(() => {});
    return;
  }
  if (first === 'social-chat') {
    void preloadSocialChat(second, ctx).catch(() => {});
  }
}

export async function navigateWithTransition(
  router: Router,
  method: TransitionNavMethod,
  href: TransitionHref,
  ctx: TransitionContext,
  runWithTransition: <T>(task: () => Promise<T> | T, opts?: ScreenTransitionRunOptions) => Promise<T>,
): Promise<void> {
  if (isLocalFirstChatHref(href)) {
    warmUpLocalFirstChatHref(href, ctx);
    if (method === 'replace') router.replace(href as Href);
    else router.push(href as Href);
    return;
  }

  await runWithTransition(
    async () => {
      await preloadTransitionTarget(href, ctx);
      if (method === 'replace') router.replace(href as Href);
      else router.push(href as Href);
    },
    { label: transitionLabelForHref(href) },
  );
}

export function useTransitionRouter(): Router {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userId } = useUserSession();
  const { runWithTransition } = useScreenTransition();

  return useMemo(() => {
    const transitionContext: TransitionContext = { queryClient, userId };
    return {
      ...router,
      push: (href: Href) => {
        void navigateWithTransition(router, 'push', href, transitionContext, runWithTransition);
      },
      replace: (href: Href) => {
        void navigateWithTransition(router, 'replace', href, transitionContext, runWithTransition);
      },
    } as Router;
  }, [queryClient, router, runWithTransition, userId]);
}
