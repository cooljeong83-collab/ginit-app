export type AppDialogButtonVariant = 'primary' | 'destructive' | 'secondary';

export type AppDialogButton = {
  label: string;
  variant?: AppDialogButtonVariant;
  onPress?: () => void;
};

export type AppDialogPayload = {
  title: string;
  body?: string;
  footnote?: string;
  /** 1~3개. 2개는 가로 배치, 3개는 세로 스택 */
  buttons: AppDialogButton[];
};
