export type DirectShareTargetType = 'meeting' | 'dm';

export type IncomingDirectSharePayload =
  | {
      kind: 'text';
      text: string;
    }
  | {
      kind: 'image';
      /** Android content:// or file:// uri */
      imageUri: string;
      /** optional caption or extra text */
      text?: string;
    };

export type PendingDirectSharePayload =
  | {
      kind: 'text';
      text: string;
      targetType: DirectShareTargetType;
      targetId: string;
    }
  | {
      kind: 'image';
      /** Android content:// or file:// uri */
      imageUri: string;
      /** optional caption or extra text */
      text?: string;
      targetType: DirectShareTargetType;
      targetId: string;
    };

let pending: PendingDirectSharePayload | null = null;
let incoming: IncomingDirectSharePayload | null = null;

export function setPendingDirectSharePayload(payload: PendingDirectSharePayload | null): void {
  pending = payload;
}

export function setIncomingDirectSharePayload(payload: IncomingDirectSharePayload | null): void {
  incoming = payload;
}

export function peekPendingDirectSharePayload(): PendingDirectSharePayload | null {
  return pending;
}

export function peekIncomingDirectSharePayload(): IncomingDirectSharePayload | null {
  return incoming;
}

export function consumePendingDirectSharePayload(): PendingDirectSharePayload | null {
  const cur = pending;
  pending = null;
  return cur;
}

export function consumeIncomingDirectSharePayload(): IncomingDirectSharePayload | null {
  const cur = incoming;
  incoming = null;
  return cur;
}

