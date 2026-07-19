import type {
  WorkflowPhaseView,
  WorkflowRunEvent,
  WorkflowRunView,
  WorkflowStepView,
} from "./domain";

const sortSteps = (steps: WorkflowStepView[]): WorkflowStepView[] =>
  [...steps].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));

const sortPhases = (phases: WorkflowPhaseView[]): WorkflowPhaseView[] =>
  [...phases]
    .map((phase) => ({ ...phase, steps: sortSteps(phase.steps) }))
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));

const cloneSnapshot = (snapshot: WorkflowRunView): WorkflowRunView => ({
  ...snapshot,
  workflow: {
    ...snapshot.workflow,
    arguments: { ...snapshot.workflow.arguments },
  },
  phases: sortPhases(
    snapshot.phases.map((phase) => ({
      ...phase,
      steps: phase.steps.map((step) => ({ ...step })),
    })),
  ),
});

const upsertPhase = (
  phases: WorkflowPhaseView[],
  nextPhase: Omit<WorkflowPhaseView, "steps"> & { steps?: WorkflowStepView[] },
): WorkflowPhaseView[] => {
  const existing = phases.find((phase) => phase.id === nextPhase.id);
  const replacement: WorkflowPhaseView = {
    ...existing,
    ...nextPhase,
    steps: sortSteps((nextPhase.steps ?? existing?.steps ?? []).map((step) => ({ ...step }))),
  };
  return sortPhases([...phases.filter((phase) => phase.id !== nextPhase.id), replacement]);
};

const upsertStep = (
  phases: WorkflowPhaseView[],
  phaseId: string,
  nextStep: WorkflowStepView,
): WorkflowPhaseView[] =>
  sortPhases(
    phases.map((phase) =>
      phase.id === phaseId
        ? {
            ...phase,
            steps: sortSteps([
              ...phase.steps.filter((step) => step.id !== nextStep.id),
              { ...nextStep },
            ]),
          }
        : phase,
    ),
  );

/**
 * Rebuilds a run from a durable snapshot plus its event tail.
 *
 * Events at or before the snapshot sequence are stale, duplicate event IDs are
 * ignored, and delivery order is normalized by the monotonic sequence before
 * applying changes. The input objects are never mutated.
 */
export const reconstructWorkflowRun = (
  snapshot: WorkflowRunView,
  events: readonly WorkflowRunEvent[],
): WorkflowRunView => {
  const seenEventIds = new Set<string>();
  const sortedEvents = events
    .filter((event) => event.runId === snapshot.runId && event.sequence > snapshot.lastSequence)
    .sort(
      (left, right) => left.sequence - right.sequence || left.eventId.localeCompare(right.eventId),
    );
  const orderedEvents: WorkflowRunEvent[] = [];
  let expectedSequence = snapshot.lastSequence + 1;
  for (const event of sortedEvents) {
    if (seenEventIds.has(event.eventId)) continue;
    seenEventIds.add(event.eventId);
    if (event.sequence < expectedSequence) continue;
    // Preserve the durable cursor until a later delivery fills the sequence gap.
    if (event.sequence > expectedSequence) break;
    orderedEvents.push(event);
    expectedSequence += 1;
  }

  return orderedEvents.reduce<WorkflowRunView>((run, event) => {
    const next = { ...run, lastSequence: event.sequence };
    switch (event.type) {
      case "run_status":
        return {
          ...next,
          status: event.status,
          completedAt: event.completedAt ?? next.completedAt,
          error: event.error ?? next.error,
        };
      case "phase_upsert":
        return { ...next, phases: upsertPhase(next.phases, event.phase) };
      case "step_upsert":
        return { ...next, phases: upsertStep(next.phases, event.phaseId, event.step) };
    }
  }, cloneSnapshot(snapshot));
};
