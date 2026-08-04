import type { SessionPermissionMode } from "@shared/permissions/sessionPermissionMode";

type PendingPermissionModeMutation = {
  revision: number;
  optimisticValue: SessionPermissionMode;
  lastConfirmedValue: SessionPermissionMode;
  confirmedAtRevision: number | null;
};

const pendingBySession = new Map<string, PendingPermissionModeMutation>();
let nextRevision = 0;

export const beginPermissionModeMutation = (
  sessionId: string,
  optimisticValue: SessionPermissionMode,
  lastConfirmedValue: SessionPermissionMode,
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

/**
 * Atomically start a UI mutation unless this exact session already has one in
 * flight. Component-local loading state is reset by navigation, so it cannot
 * provide this cross-navigation exclusion by itself.
 */
export const tryBeginPermissionModeMutation = (
  sessionId: string,
  optimisticValue: SessionPermissionMode,
  lastConfirmedValue: SessionPermissionMode,
): number | null => {
  if (pendingBySession.get(sessionId)?.confirmedAtRevision === null) {
    return null;
  }
  return beginPermissionModeMutation(sessionId, optimisticValue, lastConfirmedValue);
};

export const beginPermissionModeSummaryRequest = (): number => ++nextRevision;

export const reconcilePermissionModeSummary = (
  sessionId: string,
  serverValue: SessionPermissionMode,
  summaryRequestRevision: number = beginPermissionModeSummaryRequest(),
): SessionPermissionMode => {
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

export const confirmPermissionModeMutation = (
  sessionId: string,
  revision: number,
  confirmedValue?: SessionPermissionMode,
): boolean => {
  const pending = pendingBySession.get(sessionId);
  if (!pending || pending.revision !== revision) return false;
  if (confirmedValue !== undefined) {
    // A typed PATCH returns the authoritative summary. Keep even stale list
    // responses fenced to that returned value, not merely to what we asked
    // the server to persist.
    pending.optimisticValue = confirmedValue;
    pending.lastConfirmedValue = confirmedValue;
  }
  pending.confirmedAtRevision = ++nextRevision;
  return true;
};

export const failPermissionModeMutation = (
  sessionId: string,
  revision: number,
): SessionPermissionMode | null => {
  const pending = pendingBySession.get(sessionId);
  if (!pending || pending.revision !== revision) return null;
  pendingBySession.delete(sessionId);
  return pending.lastConfirmedValue;
};

/** Start an optimistic PATCH while retaining the last backend-confirmed value. */
export const beginBypassPermissionMutation = (
  sessionId: string,
  optimisticValue: boolean,
  lastConfirmedValue: boolean,
): number => {
  return beginPermissionModeMutation(
    sessionId,
    optimisticValue ? "bypass" : "default",
    lastConfirmedValue ? "bypass" : "default",
  );
};

/** Capture ordering when a session-summary request starts, before its await. */
export const beginBypassPermissionSummaryRequest = beginPermissionModeSummaryRequest;

/** Server summaries are authoritative except during the matching in-flight PATCH. */
export const reconcileBypassPermissionSummary = (
  sessionId: string,
  serverValue: boolean,
  summaryRequestRevision: number = beginBypassPermissionSummaryRequest(),
): boolean => {
  return (
    reconcilePermissionModeSummary(
      sessionId,
      serverValue ? "bypass" : "default",
      summaryRequestRevision,
    ) !== "default"
  );
};

export const confirmBypassPermissionMutation = confirmPermissionModeMutation;

export const failBypassPermissionMutation = (
  sessionId: string,
  revision: number,
): boolean | null => {
  const value = failPermissionModeMutation(sessionId, revision);
  return value === null ? null : value !== "default";
};

export const isPermissionModeMutationPending = (sessionId: string): boolean =>
  pendingBySession.get(sessionId)?.confirmedAtRevision === null;

export const isBypassPermissionMutationPending = isPermissionModeMutationPending;

/** @internal Test isolation only. */
export const resetBypassPermissionMutations = (): void => {
  pendingBySession.clear();
  nextRevision = 0;
};
