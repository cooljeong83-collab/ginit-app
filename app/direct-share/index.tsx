import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';

import { consumeNativePendingShare } from '@/src/lib/direct-share-native';
import {
  setIncomingDirectSharePayload,
  setPendingDirectSharePayload,
  type DirectShareTargetType,
  type IncomingDirectSharePayload,
  type PendingDirectSharePayload,
} from '@/src/lib/direct-share-store';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';

function normalizeTargetType(v: unknown): DirectShareTargetType | null {
  const raw = typeof v === 'string' ? v.trim() : '';
  if (raw === 'meeting') return 'meeting';
  if (raw === 'dm') return 'dm';
  return null;
}

function normalizeTargetId(v: unknown): string {
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0].trim() : '';
  return typeof v === 'string' ? v.trim() : '';
}

export default function DirectShareEntryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    targetType?: string | string[];
    targetId?: string | string[];
  }>();

  const targetType = useMemo(() => normalizeTargetType(params.targetType), [params.targetType]);
  const targetId = useMemo(() => normalizeTargetId(params.targetId), [params.targetId]);

  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    ginitNotifyDbg('direct-share', 'entry_mount', {
      targetType: targetType ?? null,
      targetId: targetId ? targetId.slice(0, 16) : null,
    });

    if (Platform.OS !== 'android') {
      setPendingDirectSharePayload(null);
      router.replace('/(tabs)/chat' as never);
      return;
    }

    void (async () => {
      const native = await consumeNativePendingShare();
      const text = typeof native?.text === 'string' ? native!.text!.trim() : '';
      const imageUri = typeof native?.imageUri === 'string' ? native!.imageUri!.trim() : '';

      let incoming: IncomingDirectSharePayload | null = null;
      if (imageUri) incoming = { kind: 'image', imageUri, text: text || undefined };
      else if (text) incoming = { kind: 'text', text };
      setIncomingDirectSharePayload(incoming);

      const t = targetType;
      const id = targetId;
      if (incoming && t && id) {
        let payload: PendingDirectSharePayload | null = null;
        if (incoming.kind === 'image') {
          payload = {
            kind: 'image',
            imageUri: incoming.imageUri,
            text: incoming.text,
            targetType: t,
            targetId: id,
          };
        } else {
          payload = {
            kind: 'text',
            text: incoming.text,
            targetType: t,
            targetId: id,
          };
        }
        setPendingDirectSharePayload(payload);
        ginitNotifyDbg('direct-share', 'entry_has_target', { targetType: t, targetIdPrefix: id.slice(0, 16) });
        if (t === 'meeting') router.replace(`/meeting-chat/${encodeURIComponent(id)}` as never);
        else router.replace(`/social-chat/${encodeURIComponent(id)}` as never);
        return;
      }

      // No preselected target: user will pick a chat room in the Chat tab.
      setPendingDirectSharePayload(null);
      ginitNotifyDbg('direct-share', 'entry_no_target_go_chat', { hasIncoming: Boolean(incoming) });
      router.replace('/(tabs)/chat?directShare=1' as never);
    })();
  }, [router, targetId, targetType]);

  return (
    <View style={styles.root} accessibilityLabel="공유 처리 중">
      <ActivityIndicator />
      <Text style={styles.text}>공유 내용을 불러오는 중…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
  },
  text: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
  },
});

