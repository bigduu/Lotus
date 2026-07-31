export type PermissionScope = "once" | "session" | "workspace" | "global" | string;

export const PERMISSION_DECISION_IDS = [
  "allow_once",
  "allow_session",
  "allow_workspace",
  "allow_global",
  "deny_once",
  "deny_session",
] as const;

export type PermissionDecisionId = (typeof PERMISSION_DECISION_IDS)[number];

export interface PermissionDecision {
  id: string;
  label?: string;
  scope?: PermissionScope;
  matcher?: string;
  requiresConfirmation?: boolean;
}

export interface PermissionRequestContract {
  requestId?: string;
  sessionId?: string;
  workspacePath?: string;
  childSessionId?: string;
  tool?: string;
  action?: string;
  resource?: string;
  risk?: string;
  permissionType?: string;
  bypassRequested?: boolean;
  autoApproveRequested?: boolean;
  reasonCode?: string;
  explanation?: string;
  requestedMode?: string;
  effectiveMode?: string;
  matchedRule?: {
    id?: string;
    name?: string;
    source?: string;
    effect?: string;
    scope?: string;
  };
  policyRevision?: string | number;
  allowedDecisions: PermissionDecision[];
  suggestedMatchers: Array<{ id: string; kind: string; value: string }>;
  suggestedScope?: PermissionScope;
}

export interface PermissionDecisionSubmission {
  request_id: string;
  decision: PermissionDecisionId;
  matcher_id?: string;
  expected_policy_revision?: number;
  confirm_global?: true;
}

export interface PermissionDecisionSubmissionOptions {
  matcherId?: string;
  confirmGlobal?: boolean;
}

const PERMISSION_DECISION_ID_SET = new Set<string>(PERMISSION_DECISION_IDS);
const MATCHER_DECISIONS = new Set<PermissionDecisionId>([
  "allow_session",
  "allow_workspace",
  "allow_global",
  "deny_session",
]);

export const isPermissionDecisionId = (value: string): value is PermissionDecisionId =>
  PERMISSION_DECISION_ID_SET.has(value);

export const preferredPermissionMatcherId = (
  request: PermissionRequestContract,
): string | undefined =>
  request.suggestedMatchers.find(
    (matcher) => matcher.id === "exact_resource" || matcher.kind === "exact_resource",
  )?.id ?? request.suggestedMatchers[0]?.id;

const numericPolicyRevision = (value: string | number | undefined): number | undefined => {
  const revision = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0
    ? revision
    : undefined;
};

export const buildPermissionDecisionSubmission = (
  request: PermissionRequestContract,
  decision: string,
  options: PermissionDecisionSubmissionOptions = {},
): PermissionDecisionSubmission => {
  if (
    !request.requestId ||
    !isPermissionDecisionId(decision) ||
    !request.allowedDecisions.some((item) => item.id === decision)
  ) {
    throw new Error("Decision is not authorized by Bamboo");
  }

  const durable = decision === "allow_workspace" || decision === "allow_global";
  const matcherId = options.matcherId ?? preferredPermissionMatcherId(request);
  if (MATCHER_DECISIONS.has(decision)) {
    if (!matcherId) {
      throw new Error("A Bamboo matcher is required for scoped permission");
    }
    if (!request.suggestedMatchers.some((matcher) => matcher.id === matcherId)) {
      throw new Error("Matcher is not authorized by Bamboo");
    }
  }

  const policyRevision = numericPolicyRevision(request.policyRevision);
  if (durable && policyRevision == null) {
    throw new Error("A Bamboo policy revision is required for remembered permission");
  }
  if (decision === "allow_workspace" && !request.workspacePath?.trim()) {
    throw new Error("A stable workspace identity is required for workspace permission");
  }
  if (decision === "allow_global" && options.confirmGlobal !== true) {
    throw new Error("Global permission requires explicit confirmation");
  }

  return {
    request_id: request.requestId,
    decision,
    ...(MATCHER_DECISIONS.has(decision) ? { matcher_id: matcherId } : {}),
    ...(durable ? { expected_policy_revision: policyRevision } : {}),
    ...(decision === "allow_global" ? { confirm_global: true as const } : {}),
  };
};

/** Known decisions that this Lotus build can safely submit on the typed endpoint. */
export const supportedPermissionDecisionIds = (
  request: PermissionRequestContract | null,
): string[] => {
  if (!request?.requestId) return [];
  return request.allowedDecisions.map((decision) => decision.id).filter(isPermissionDecisionId);
};

const record = (value: unknown): Record<string, unknown> | null =>
  value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (...values: unknown[]): string | undefined =>
  values.find((value): value is string => typeof value === "string" && value.trim().length > 0);

const normalizeDecision = (value: unknown): PermissionDecision | null => {
  if (typeof value === "string" && value.trim()) return { id: value };
  const item = record(value);
  if (!item) return null;
  const id = text(item.id, item.action, item.decision, item.value);
  if (!id) return null;
  return {
    id,
    label: text(item.label, item.display_name),
    scope: text(item.scope),
    matcher: text(item.matcher, item.pattern),
    requiresConfirmation:
      typeof item.requires_confirmation === "boolean"
        ? item.requires_confirmation
        : typeof item.confirm === "boolean"
          ? item.confirm
          : undefined,
  };
};

/**
 * Compatibility boundary for Bamboo #601. It accepts the canonical nested
 * request and transitional top-level/alias fields, while preserving unknown
 * decision ids instead of teaching Lotus new policy semantics.
 */
export const normalizePermissionRequest = (value: unknown): PermissionRequestContract | null => {
  const outer = record(value);
  if (!outer) return null;
  const source = record(outer.permission_request) ?? record(outer.request) ?? outer;
  const hasTypedSignal =
    Array.isArray(source.allowed_decisions) ||
    source.reason_code != null ||
    source.effective_mode != null ||
    outer.permission_request != null;
  if (!hasTypedSignal) return null;

  const matched = record(source.matched_rule);
  const decisions = Array.isArray(source.allowed_decisions)
    ? source.allowed_decisions
        .map(normalizeDecision)
        .filter((item): item is PermissionDecision => !!item)
    : [];

  return {
    requestId: text(source.request_id, outer.request_id),
    sessionId: text(source.session_id, outer.session_id),
    workspacePath: text(source.workspace_path),
    childSessionId: text(source.child_session_id, outer.child_session_id),
    tool: text(source.tool_name, source.tool, outer.tool_name),
    action: text(source.operation_summary, source.action, source.summary),
    permissionType: text(source.permission_type),
    resource: text(source.resource),
    risk: text(source.risk, source.risk_level),
    reasonCode: text(source.reason_code),
    explanation: text(source.explanation, source.reason, outer.reason),
    requestedMode: text(source.requested_mode, source.requested_permission_mode),
    effectiveMode: text(source.effective_mode, source.effective_permission_mode),
    bypassRequested:
      typeof source.bypass_requested === "boolean" ? source.bypass_requested : undefined,
    autoApproveRequested:
      typeof source.auto_approve_requested === "boolean"
        ? source.auto_approve_requested
        : undefined,
    matchedRule: matched
      ? {
          id: text(matched.id),
          name: text(matched.name, matched.matcher),
          source: text(matched.source),
          effect: text(matched.effect),
          scope: text(matched.scope),
        }
      : undefined,
    policyRevision:
      typeof source.policy_revision === "string" || typeof source.policy_revision === "number"
        ? source.policy_revision
        : undefined,
    allowedDecisions: decisions,
    suggestedMatchers: Array.isArray(source.suggested_matchers)
      ? source.suggested_matchers.flatMap((candidate) => {
          const matcher = record(candidate);
          const kind = text(matcher?.kind);
          const value = text(matcher?.value);
          const id = text(matcher?.id);
          return id && kind && value ? [{ id, kind, value }] : [];
        })
      : [],
    suggestedScope: text(source.suggested_scope),
  };
};
