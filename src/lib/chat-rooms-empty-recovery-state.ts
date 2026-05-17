const attemptedEmptyRecoveryUserIds = new Set<string>();

export function hasAttemptedChatRoomsEmptyRecovery(userId: string): boolean {
  return attemptedEmptyRecoveryUserIds.has(userId.trim());
}

export function markChatRoomsEmptyRecoveryAttempted(userId: string): void {
  const id = userId.trim();
  if (id) attemptedEmptyRecoveryUserIds.add(id);
}

export function resetChatRoomsEmptyRecoveryState(): void {
  attemptedEmptyRecoveryUserIds.clear();
}
