import {
  NegotiatedWorkflowCatalogAdapter,
  type WorkflowCatalogAdapter,
  type WorkflowCatalogLoadOptions,
} from "./catalogAdapters";
import type { WorkflowCatalogView } from "./domain";

export type WorkflowCatalogEventType =
  | "workflow_changed"
  | "workflow_invalid"
  | "workflow_recovered";

export interface WorkflowCatalogInvalidation {
  type: WorkflowCatalogEventType;
  workflowId: string;
  revision: number;
  scope?: string;
}

export interface WorkflowCatalogQueryOptions extends WorkflowCatalogLoadOptions {
  forceRefresh?: boolean;
}

export type WorkflowCatalogInvalidationListener = (event?: WorkflowCatalogInvalidation) => void;

export interface WorkflowCatalogQuerySource {
  load(options?: WorkflowCatalogQueryOptions): Promise<WorkflowCatalogView>;
  invalidate(event?: WorkflowCatalogInvalidation): boolean;
  subscribe(listener: WorkflowCatalogInvalidationListener): () => void;
}

interface CacheEntry {
  cachedAt: number;
  value: WorkflowCatalogView;
}

const cacheKeyForSession = (sessionId?: string | null): string => {
  const normalized = sessionId?.trim();
  return normalized ? `session:${normalized}` : "global";
};

const aborted = (): DOMException => new DOMException("The operation was aborted", "AbortError");

const waitForCaller = <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(aborted());

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(aborted());
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
};

/**
 * Small server-state query/cache for the metadata-only Workflow catalog.
 *
 * The 30-second TTL is a resilience fallback. Durable account-feed lifecycle
 * events invalidate this cache immediately and notify mounted consumers. UI
 * search/filter state intentionally stays outside this class.
 */
export class WorkflowCatalogQuery implements WorkflowCatalogQuerySource {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<WorkflowCatalogView>>();
  private readonly listeners = new Set<WorkflowCatalogInvalidationListener>();
  private generation = 0;

  constructor(
    private readonly adapter: WorkflowCatalogAdapter = new NegotiatedWorkflowCatalogAdapter(),
    private readonly cacheTtlMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  load(options: WorkflowCatalogQueryOptions = {}): Promise<WorkflowCatalogView> {
    const key = cacheKeyForSession(options.sessionId);
    const cached = this.cache.get(key);
    const now = this.now();
    if (!options.forceRefresh && cached && now - cached.cachedAt < this.cacheTtlMs) {
      return waitForCaller(Promise.resolve(cached.value), options.signal);
    }

    const pending = this.inFlight.get(key);
    if (pending) return waitForCaller(pending, options.signal);

    const requestGeneration = this.generation;
    const request = this.adapter.load({ sessionId: options.sessionId }).then((value) => {
      if (requestGeneration === this.generation) {
        this.cache.set(key, { value, cachedAt: this.now() });
      }
      return value;
    });
    this.inFlight.set(key, request);
    const clearInFlight = () => {
      if (this.inFlight.get(key) === request) this.inFlight.delete(key);
    };
    void request.then(clearInFlight, clearInFlight);
    return waitForCaller(request, options.signal);
  }

  invalidate(event?: WorkflowCatalogInvalidation): boolean {
    // Account-feed sequence ordering is authoritative within a transport
    // epoch. Workflow revisions may restart from a lower value after a backend
    // restart, while cache invalidation itself is idempotent and safe to repeat.
    this.generation += 1;
    this.cache.clear();
    this.inFlight.clear();
    for (const listener of this.listeners) listener(event);
    return true;
  }

  subscribe(listener: WorkflowCatalogInvalidationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const workflowCatalogQuery = new WorkflowCatalogQuery();
