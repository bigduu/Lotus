type PendingBypassMutation = {
  revision: number;
  optimisticValue: boolean;
  lastConfirmedValue: boolean;
  confirmedAtRevision: number | null;
};

const pendingBySession = new Map<string, PendingBypassMutation>();
let nextRevision = 0;

/** Start an optimistic PATCH while retaining the last backend-confirmed value. */
export const beginBypassPermissionMutation = (
  sessionId: string,
  optimisticValue: boolean,
  lastConfirmedValue: boolean,
): number => {
  const revision = ++nextRevision;
  pendingBySession.set(sessionId, {
    revision,
    optimisticValue,
    lastConfirmedValue,
    confirmedAtRevision: null,
  });
  return revision;
};

/** Capture ordering when a session-summary request starts, before its await. */
export const beginBypassPermissionSummaryRequest = (): number => ++nextRevision;

/** Server summaries are authoritative except during the matching in-flight PATCH. */
export const reconcileBypassPermissionSummary = (
  sessionId: string,
  serverValue: boolean,
  summaryRequestRevision: number = beginBypassPermissionSummaryRequest(),
): boolean => {
  const pending = pendingBySession.get(sessionId);
  if (!pending) return serverValue;
  if (
    pending.confirmedAtRevision !== null &&
    summaryRequestRevision > pending.confirmedAtRevision
  ) {
    pendingBySession.delete(sessionId);
    return serverValue;
  }
  pending.lastConfirmedValue = serverValue;
  return pending.optimisticValue;
};

export const confirmBypassPermissionMutation = (sessionId: string, revision: number): boolean => {
  const pending = pendingBySession.get(sessionId);
  if (!pending || pending.revision !== revision) return false;
  // Keep a short-lived fence so a summary request that started before this
  // PATCH completed cannot arrive late and overwrite the confirmed value.
  // The first summary request started after this point clears the fence and
  // restores normal server-authoritative reconciliation.
  pending.confirmedAtRevision = ++nextRevision;
  return true;
};

export const failBypassPermissionMutation = (
  sessionId: string,
  revision: number,
): boolean | null => {
  const pending = pendingBySession.get(sessionId);
  if (!pending || pending.revision !== revision) return null;
  pendingBySession.delete(sessionId);
  return pending.lastConfirmedValue;
};

export const isBypassPermissionMutationPending = (sessionId: string): boolean =>
  pendingBySession.get(sessionId)?.confirmedAtRevision === null;

/** @internal Test isolation only. */
export const resetBypassPermissionMutations = (): void => {
  pendingBySession.clear();
  nextRevision = 0;
};
