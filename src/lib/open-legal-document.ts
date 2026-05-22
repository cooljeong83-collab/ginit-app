import { Linking, Platform } from 'react-native';

import { LEGAL_DOCUMENT_URLS, type LegalDocumentKey } from '@/src/constants/legal-documents';
import { invokeLegalDocumentModalOpen } from '@/src/lib/legal-document-modal-bridge';

/** 서비스 이용약관·개인정보 처리방침을 인앱 모달(WebView) 또는 웹 탭으로 연다. */
export async function openLegalDocument(key: LegalDocumentKey): Promise<void> {
  if (Platform.OS === 'web') {
    await Linking.openURL(LEGAL_DOCUMENT_URLS[key]);
    return;
  }
  invokeLegalDocumentModalOpen(key);
}
