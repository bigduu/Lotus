import { useCallback, useSyncExternalStore } from "react";

type TrackerListener = () => void;

const pendingSubmissions = new Map<string, number>();
const listeners = new Set<TrackerListener>();
let nextSubmissionRevision = 0;

const notifyListeners = () => {
  listeners.forEach((listener) => listener());
};

export const tryBeginTypedWorkflowSubmission = (sessionId: string): number | null => {
  if (!sessionId || pendingSubmissions.has(sessionId)) return null;

  nextSubmissionRevision += 1;
  pendingSubmissions.set(sessionId, nextSubmissionRevision);
  notifyListeners();
  return nextSubmissionRevision;
};

export const finishTypedWorkflowSubmission = (sessionId: string, revision: number): boolean => {
  if (pendingSubmissions.get(sessionId) !== revision) return false;

  pendingSubmissions.delete(sessionId);
  notifyListeners();
  return true;
};

export const isTypedWorkflowSubmissionPending = (sessionId: string | null): boolean =>
  Boolean(sessionId && pendingSubmissions.has(sessionId));

export const subscribeToTypedWorkflowSubmissions = (listener: TrackerListener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useTypedWorkflowSubmissionPending = (sessionId: string | null): boolean => {
  const getSnapshot = useCallback(() => isTypedWorkflowSubmissionPending(sessionId), [sessionId]);
  return useSyncExternalStore(subscribeToTypedWorkflowSubmissions, getSnapshot, () => false);
};

export const resetTypedWorkflowSubmissionTrackerForTests = (): void => {
  pendingSubmissions.clear();
  nextSubmissionRevision = 0;
  notifyListeners();
};
