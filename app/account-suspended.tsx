import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GinitButton } from '@/components/ginit';
import { GinitTheme } from '@/constants/ginit-theme';
import {
  ACCOUNT_SUSPENDED_DEFAULT_MESSAGE,
  messageForAccountGateReason,
} from '@/src/features/account-suspension/account-suspended-messages';
import { useTransitionRouter } from '@/src/lib/screen-transition-navigation';

function paramToString(v: string | string[] | undefined): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v[0]) return v[0];
  return '';
}

export default function AccountSuspendedScreen() {
  const router = useTransitionRouter();
  const params = useLocalSearchParams<{ reason?: string; message?: string; appUserId?: string }>();
  const reason = paramToString(params.reason);
  const messageParam = paramToString(params.message);
  const appUserId = paramToString(params.appUserId);
  const body =
    messageParam.trim() ||
    messageForAccountGateReason(reason || 'suspended', null) ||
    ACCOUNT_SUSPENDED_DEFAULT_MESSAGE;
  const title =
    reason === 'withdrawn' ? '탈퇴한 계정입니다' : '이용이 중지된 계정입니다';

  const onOpenInquiry = () => {
    router.push({
      pathname: '/support/inquiry',
      params: {
        fromAccountGate: '1',
        reason: reason || 'suspended',
        message: body,
        appUserId,
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.inner}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        <Text style={styles.hint}>로그인 및 앱 이용이 제한됩니다.</Text>
        <GinitButton
          title="1:1 문의하기"
          variant="primary"
          onPress={onOpenInquiry}
          style={styles.inquiryBtn}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: GinitTheme.colors.primary,
    textAlign: 'center',
  },
  body: {
    marginTop: 20,
    fontSize: 16,
    lineHeight: 24,
    color: '#0f172a',
    textAlign: 'center',
  },
  hint: {
    marginTop: 24,
    fontSize: 14,
    color: GinitTheme.colors.textMuted,
    textAlign: 'center',
  },
  inquiryBtn: {
    marginTop: 28,
    alignSelf: 'stretch',
  },
});
