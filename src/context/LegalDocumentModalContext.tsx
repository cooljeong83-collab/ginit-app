import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { LegalDocumentModal } from '@/components/legal/LegalDocumentModal';
import type { LegalDocumentKey } from '@/src/constants/legal-documents';
import {
  registerLegalDocumentModalOpener,
  unregisterLegalDocumentModalOpener,
} from '@/src/lib/legal-document-modal-bridge';

type LegalDocumentModalContextValue = {
  openLegalDocument: (key: LegalDocumentKey) => void;
  closeLegalDocument: () => void;
};

const LegalDocumentModalContext = createContext<LegalDocumentModalContextValue | null>(null);

export function LegalDocumentModalProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [doc, setDoc] = useState<LegalDocumentKey | null>(null);

  const openLegalDocument = useCallback((key: LegalDocumentKey) => {
    setDoc(key);
    setVisible(true);
  }, []);

  const closeLegalDocument = useCallback(() => {
    setVisible(false);
    setDoc(null);
  }, []);

  useEffect(() => {
    registerLegalDocumentModalOpener(openLegalDocument);
    return () => unregisterLegalDocumentModalOpener();
  }, [openLegalDocument]);

  const value = useMemo(
    () => ({ openLegalDocument, closeLegalDocument }),
    [openLegalDocument, closeLegalDocument],
  );

  return (
    <LegalDocumentModalContext.Provider value={value}>
      {children}
      <LegalDocumentModal visible={visible} doc={doc} onClose={closeLegalDocument} />
    </LegalDocumentModalContext.Provider>
  );
}

export function useLegalDocumentModal(): LegalDocumentModalContextValue {
  const ctx = useContext(LegalDocumentModalContext);
  if (!ctx) {
    throw new Error('useLegalDocumentModal must be used within LegalDocumentModalProvider');
  }
  return ctx;
}
