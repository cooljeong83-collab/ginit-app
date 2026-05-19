import type { AppDialogButton } from '@/components/dialog/app-dialog-types';
import { showAppDialog } from '@/components/dialog/app-dialog-api';

export function presentAppDialogButtons(opts: {
  title: string;
  body?: string;
  footnote?: string;
  buttons: AppDialogButton[];
}): void {
  const buttons = opts.buttons.filter((b) => b.label.trim());
  if (buttons.length === 0) return;
  showAppDialog({
    title: opts.title,
    body: opts.body,
    footnote: opts.footnote,
    buttons: buttons.slice(0, 3),
  });
}

export function presentAppDialogAlert(opts: {
  title: string;
  body?: string;
  footnote?: string;
  primaryLabel?: string;
  onPrimary?: () => void;
}): void {
  presentAppDialogButtons({
    title: opts.title,
    body: opts.body,
    footnote: opts.footnote,
    buttons: [
      {
        label: opts.primaryLabel ?? '확인',
        variant: 'primary',
        onPress: opts.onPrimary,
      },
    ],
  });
}

export function presentAppDialogConfirm(opts: {
  title: string;
  body?: string;
  footnote?: string;
  cancelLabel?: string;
  confirmLabel: string;
  confirmVariant?: 'primary' | 'destructive';
  onConfirm: () => void;
  onCancel?: () => void;
}): void {
  presentAppDialogButtons({
    title: opts.title,
    body: opts.body,
    footnote: opts.footnote,
    buttons: [
      {
        label: opts.cancelLabel ?? '취소',
        variant: 'secondary',
        onPress: opts.onCancel,
      },
      {
        label: opts.confirmLabel,
        variant: opts.confirmVariant ?? 'primary',
        onPress: opts.onConfirm,
      },
    ],
  });
}

/** Alert 3버튼 (취소·중간·확인 등) — 위에서부터 순서대로 스택 */
export function presentAppDialogThreeButton(opts: {
  title: string;
  body?: string;
  footnote?: string;
  buttons: [AppDialogButton, AppDialogButton, AppDialogButton];
}): void {
  presentAppDialogButtons(opts);
}
