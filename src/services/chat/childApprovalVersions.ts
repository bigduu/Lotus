import type { SubagentApprovalSnapshot } from "./AgentService";

const versionsByRequestId = new Map<string, number>();

export const childApprovalVersionKey = (
  parentSessionId: string,
  childSessionId: string,
  childAttempt: number | undefined,
  requestId: string,
): string => `${parentSessionId}:${childSessionId}:${childAttempt ?? 0}:${requestId}`;

/** Drops duplicate/out-of-order approval lifecycle frames within this client process. */
export const acceptChildApprovalVersion = (key: string, version?: number): boolean => {
  if (version === undefined) return true;
  const current = versionsByRequestId.get(key);
  if (current !== undefined && version <= current) return false;
  versionsByRequestId.set(key, version);
  return true;
};

/** Reset the dedupe baseline to the authoritative unresolved snapshot. */
export const replaceChildApprovalVersions = (approvals: SubagentApprovalSnapshot[]): void => {
  versionsByRequestId.clear();
  for (const approval of approvals) {
    versionsByRequestId.set(
      childApprovalVersionKey(
        approval.parent_session_id,
        approval.child_session_id,
        approval.child_attempt,
        approval.request_id,
      ),
      approval.version,
    );
  }
};
