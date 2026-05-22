import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { PlaceDetailPopup } from '@/components/places/PlaceDetailPopup';
import type { PlaceDetailPopupState } from '@/src/lib/places/place-detail-popup-state';

type PlaceDetailPopupContextValue = {
  open: (state: PlaceDetailPopupState) => void;
  close: () => void;
};

const PlaceDetailPopupContext = createContext<PlaceDetailPopupContextValue | null>(null);

/** 장소 상세 WebView — 루트 1개만 마운트(중첩 Modal·제안 모달 안에서도 표시) */
export function PlaceDetailPopupProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlaceDetailPopupState | null>(null);

  const close = useCallback(() => {
    setState(null);
  }, []);

  const open = useCallback((next: PlaceDetailPopupState) => {
    setState(next);
  }, []);

  const value = useMemo(() => ({ open, close }), [close, open]);

  return (
    <PlaceDetailPopupContext.Provider value={value}>
      {children}
      <PlaceDetailPopup state={state} onClose={close} />
    </PlaceDetailPopupContext.Provider>
  );
}

export function usePlaceDetailPopup(): PlaceDetailPopupContextValue {
  const ctx = useContext(PlaceDetailPopupContext);
  if (!ctx) {
    throw new Error('usePlaceDetailPopup must be used within PlaceDetailPopupProvider');
  }
  return ctx;
}
