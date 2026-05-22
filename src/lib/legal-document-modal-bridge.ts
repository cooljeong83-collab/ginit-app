import type { LegalDocumentKey } from '@/src/constants/legal-documents';

let opener: ((key: LegalDocumentKey) => void) | null = null;
let warnedMissingProvider = false;

export function registerLegalDocumentModalOpener(fn: (key: LegalDocumentKey) => void): void {
  opener = fn;
  warnedMissingProvider = false;
}

export function unregisterLegalDocumentModalOpener(): void {
  opener = null;
}

export function invokeLegalDocumentModalOpen(key: LegalDocumentKey): boolean {
  if (opener) {
    opener(key);
    return true;
  }
  if (__DEV__ && !warnedMissingProvider) {
    warnedMissingProvider = true;
    console.warn('[openLegalDocument] LegalDocumentModalProvider is not mounted.');
  }
  return false;
}
