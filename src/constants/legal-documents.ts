/** 서비스 이용약관·개인정보 처리방침 공개 웹 문서 URL */
export const GINIT_TERMS_OF_SERVICE_URL = 'https://cooljeong83-collab.github.io/terms.html';
export const GINIT_PRIVACY_POLICY_URL = 'https://cooljeong83-collab.github.io/privacy.html';

export type LegalDocumentKey = 'tos' | 'privacy';

export const LEGAL_DOCUMENT_URLS: Record<LegalDocumentKey, string> = {
  tos: GINIT_TERMS_OF_SERVICE_URL,
  privacy: GINIT_PRIVACY_POLICY_URL,
};

export const LEGAL_DOCUMENT_TITLES: Record<LegalDocumentKey, string> = {
  tos: '서비스 이용약관',
  privacy: '개인정보 처리방침',
};
