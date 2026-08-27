import type {
  WorkflowFailure,
  WorkflowPlan,
  WorkflowRunEvent,
  WorkflowRunSnapshot,
  WorkflowRunStatus,
  WorkflowStepSnapshot,
  WorkflowStepStatus,
} from "./domain";

export interface ProjectedWorkflowStep extends Omit<WorkflowStepSnapshot, "attempts"> {
  /** Events intentionally omit attempt counts; the next snapshot restores this value. */
  attempts: number | null;
}

export interface ProjectedWorkflowRun extends Omit<WorkflowRunSnapshot, "steps"> {
  steps: Record<string, ProjectedWorkflowStep>;
}

export type WorkflowRunSequenceIssue =
  | {
      type: "gap";
      expected_sequence: number;
      received_sequence: number;
    }
  | { type: "conflicting_duplicate"; sequence: number }
  | { type: "foreign_run"; sequence: number }
  | { type: "regressive_transition"; sequence: number };

export interface WorkflowRunReconstructionResult {
  run: ProjectedWorkflowRun;
  issue: WorkflowRunSequenceIssue | null;
  applied: number;
}

export const isWorkflowRunTerminal = (status: WorkflowRunStatus): boolean =>
  status === "succeeded" || status === "failed" || status === "cancelled";

const clonePlan = (plan: WorkflowPlan): WorkflowPlan => {
  switch (plan.type) {
    case "step":
      return { ...plan };
    case "sequence":
    case "parallel":
      return { ...plan, nodes: plan.nodes.map(clonePlan) };
    case "map":
      return { ...plan, body: clonePlan(plan.body) };
    case "retry":
      return { ...plan, node: clonePlan(plan.node) };
  }
};

const cloneFailure = (failure: WorkflowFailure | undefined): WorkflowFailure | undefined =>
  failure ? { ...failure } : undefined;

const projectSnapshot = (snapshot: WorkflowRunSnapshot): ProjectedWorkflowRun => ({
  ...snapshot,
  planned_steps: Object.fromEntries(
    Object.entries(snapshot.planned_steps).map(([id, step]) => [id, { ...step }]),
  ),
  plan: clonePlan(snapshot.plan),
  steps: Object.fromEntries(
    Object.entries(snapshot.steps).map(([id, step]) => [
      id,
      { ...step, failure: cloneFailure(step.failure) },
    ]),
  ),
  budget: { ...snapshot.budget },
  usage: { ...snapshot.usage },
  failure: cloneFailure(snapshot.failure),
  suspension: snapshot.suspension ? { ...snapshot.suspension } : undefined,
});

const targetRunStatus = (event: WorkflowRunEvent): WorkflowRunStatus | null => {
  switch (event.type) {
    case "run_queued":
      return "queued";
    case "run_started":
      return "running";
    case "run_suspended":
      return "suspended";
    case "run_succeeded":
      return "succeeded";
    case "run_failed":
      return "failed";
    case "run_cancelled":
      return "cancelled";
    default:
      return null;
  }
};

const targetStepStatus = (event: WorkflowRunEvent): WorkflowStepStatus | null => {
  switch (event.type) {
    case "step_queued":
      return "queued";
    case "step_started":
      return "running";
    case "step_suspended":
      return "suspended";
    case "step_completed":
      return "succeeded";
    case "step_failed":
      return "failed";
    case "step_cancelled":
      return "cancelled";
    case "step_skipped":
      return "skipped";
    default:
      return null;
  }
};

const canTransitionRun = (from: WorkflowRunStatus, to: WorkflowRunStatus): boolean => {
  if (from === to) return true;
  if (isWorkflowRunTerminal(from)) return false;
  if (from === "queued") return to !== "queued";
  if (from === "running") return to !== "queued";
  // A suspended run may continue after its backend-owned approval/recovery
  // lifecycle. Lotus still exposes no resume control of its own.
  return from === "suspended" && to !== "queued";
};

const canTransitionStep = (
  from: WorkflowStepStatus | undefined,
  to: WorkflowStepStatus,
): boolean => {
  if (from === undefined || from === to) return true;
  if (from === "succeeded" || from === "cancelled" || from === "skipped") return false;
  // Failed -> queued/running is the backend's real retry path.
  if (from === "failed") return to === "queued" || to === "running" || to === "cancelled";
  if (from === "running") return to !== "queued";
  if (from === "suspended") return to !== "queued";
  return from === "queued";
};

const eventFingerprint = (event: WorkflowRunEvent): string => {
  const failure =
    event.type === "step_failed" || event.type === "run_failed"
      ? [event.failure.code, event.failure.message, event.failure.retryable]
      : null;
  return JSON.stringify([
    event.run_id,
    event.sequence,
    event.at,
    event.step_id ?? null,
    event.type,
    event.type === "phase" ? event.name : null,
    failure,
  ]);
};

const applyEvent = (run: ProjectedWorkflowRun, event: WorkflowRunEvent): boolean => {
  const runStatus = targetRunStatus(event);
  if (runStatus) {
    if (!canTransitionRun(run.status, runStatus)) return false;
    run.status = runStatus;
    if (event.type === "run_failed") run.failure = { ...event.failure };
  }

  const stepStatus = targetStepStatus(event);
  if (stepStatus) {
    if (isWorkflowRunTerminal(run.status)) return false;
    const stepId = event.step_id;
    if (stepId === undefined) return false;
    const current = run.steps[stepId];
    if (!canTransitionStep(current?.status, stepStatus)) return false;
    const failure = event.type === "step_failed" ? { ...event.failure } : undefined;
    run.steps[stepId] = {
      id: stepId,
      status: stepStatus,
      attempts: current?.attempts ?? null,
      ...(failure ? { failure } : {}),
    };
  }

  run.last_sequence = event.sequence;
  run.updated_at = event.at;
  return true;
};

/**
 * Validates and projects a durable event tail over an immutable snapshot.
 *
 * `(run_id, sequence)` is the only event identity. Stale events are ignored,
 * identical sequence duplicates are collapsed, conflicting duplicates and
 * regressions stop replay, and a gap never advances the cursor. Callers must
 * discard a problematic tail and refetch an authoritative snapshot.
 */
export const reconstructWorkflowRun = (
  snapshot: WorkflowRunSnapshot,
  events: readonly WorkflowRunEvent[],
): WorkflowRunReconstructionResult => {
  const run = projectSnapshot(snapshot);
  const relevant = events
    .filter((event) => event.sequence > snapshot.last_sequence)
    .sort((left, right) => left.sequence - right.sequence);

  let expectedSequence = snapshot.last_sequence + 1;
  let applied = 0;
  for (let index = 0; index < relevant.length; ) {
    const event = relevant[index];
    const sameSequence: WorkflowRunEvent[] = [];
    while (index < relevant.length && relevant[index].sequence === event.sequence) {
      sameSequence.push(relevant[index]);
      index += 1;
    }

    if (sameSequence.some((candidate) => candidate.run_id !== snapshot.run_id)) {
      return { run, applied, issue: { type: "foreign_run", sequence: event.sequence } };
    }
    const fingerprints = new Set(sameSequence.map(eventFingerprint));
    if (fingerprints.size > 1) {
      return {
        run,
        applied,
        issue: { type: "conflicting_duplicate", sequence: event.sequence },
      };
    }
    if (event.sequence > expectedSequence) {
      return {
        run,
        applied,
        issue: {
          type: "gap",
          expected_sequence: expectedSequence,
          received_sequence: event.sequence,
        },
      };
    }
    if (event.sequence < expectedSequence) continue;
    if (!applyEvent(run, event)) {
      return {
        run,
        applied,
        issue: { type: "regressive_transition", sequence: event.sequence },
      };
    }
    expectedSequence += 1;
    applied += 1;
  }

  return { run, applied, issue: null };
};
