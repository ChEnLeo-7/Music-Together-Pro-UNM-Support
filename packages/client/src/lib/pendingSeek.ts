export function displayTimeForSnapshot(confirmedTime: number, pendingTarget: number | null): number {
  return pendingTarget ?? confirmedTime
}

export function canConfirmPendingSeek(
  eventRevision: number | undefined,
  pendingRevision: number | null,
): boolean {
  return eventRevision !== undefined && eventRevision === pendingRevision
}
