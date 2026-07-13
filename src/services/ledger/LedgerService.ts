/**
 * Ledger Service
 *
 * Personal-assistant "ledger": prospective-memory records (todos, events,
 * reminders, habits) with due/remind times, statuses, and an agenda view.
 * Backed by the authenticated /api/v1/ledger/* routes on the bamboo backend.
 */
import { agentApiClient } from "../api/client";

// ── Types (snake_case, mirroring the Rust serde shapes) ─────────────────────

export type RecordKind = "todo" | "event" | "reminder" | "habit" | (string & {});

export type RecordStatus = "open" | "in_progress" | "blocked" | "done" | "cancelled" | "expired";

export type RecordPriority = "low" | "medium" | "high" | "critical";

export type RecordScope = "global" | "project";

export interface LedgerRecordTime {
  due_at?: string;
  starts_at?: string;
  ends_at?: string;
  remind_at?: string[];
  recurrence?: unknown;
  timezone?: string;
}

export interface LedgerRecordRelations {
  parent_id?: string;
  depends_on?: string[];
  related?: string[];
}

export interface LedgerRecordSource {
  session_id?: string;
  created_by?: "user" | "agent" | "extractor" | "system";
  excerpt?: string;
}

export interface LedgerRecordTransition {
  from_status: RecordStatus;
  to_status: RecordStatus;
  reason?: string;
  changed_at: string;
}

export interface LedgerRecord {
  id: string;
  kind: RecordKind;
  title: string;
  status: RecordStatus;
  priority: RecordPriority;
  scope: RecordScope;
  project_key?: string;
  time?: LedgerRecordTime;
  relations?: LedgerRecordRelations;
  source?: LedgerRecordSource;
  tags?: string[];
  schedule_ids?: string[];
  transitions?: LedgerRecordTransition[];
  created_at: string;
  updated_at: string;
}

export interface AgendaItem {
  id: string;
  scope: RecordScope;
  project_key?: string;
  kind: RecordKind;
  title: string;
  status: RecordStatus;
  priority: RecordPriority;
  anchor_at?: string;
  due_at?: string;
}

export interface AgendaSnapshot {
  generated_at: string;
  overdue: AgendaItem[];
  today: AgendaItem[];
  upcoming: AgendaItem[];
  undated: AgendaItem[];
}

export interface GetAgendaParams {
  projectKey?: string;
  /** Default 7, clamped by the backend to 1..=31. */
  horizonDays?: number;
}

export interface ListRecordsParams {
  scope?: RecordScope;
  projectKey?: string;
  /** Joined into a comma-separated `status=` query token list. */
  status?: RecordStatus[];
  /** Joined into a comma-separated `kind=` query token list. */
  kind?: RecordKind[];
  /** Terminal = done/cancelled/expired. Backend default is false. */
  includeTerminal?: boolean;
  parentId?: string;
  /** Backend default 20, max 50. */
  limit?: number;
}

export interface ListRecordsResponse {
  records: LedgerRecord[];
  returned: number;
  matched: number;
}

/** Upsert body: no id = create (title required); with id = partial update. */
export interface UpsertRecordRequest {
  id?: string;
  title?: string;
  kind?: RecordKind;
  priority?: RecordPriority;
  scope?: RecordScope;
  project_key?: string;
  body?: string;
  /** RFC3339 or `YYYY-MM-DD`. */
  due_at?: string;
  starts_at?: string;
  ends_at?: string;
  remind_at?: string[];
  tags?: string[];
  parent_id?: string;
}

export interface UpsertRecordResponse {
  result: "create" | "update";
  record: LedgerRecord;
  body: string;
}

export interface PatchRecordRequest {
  title?: string;
  kind?: RecordKind;
  priority?: RecordPriority;
  body?: string;
  due_at?: string;
  starts_at?: string;
  ends_at?: string;
  remind_at?: string[];
  tags?: string[];
  parent_id?: string;
  /** Status changes go through the transition path (history recorded). */
  status?: RecordStatus;
  /** Optional transition reason (e.g. cancellation reason). */
  reason?: string;
}

export interface PatchRecordResponse {
  record: LedgerRecord;
  body: string;
}

/** DELETE is a cancel transition; records are never hard-deleted. */
export interface DeleteRecordResponse {
  success: boolean;
  record: LedgerRecord;
}

// ── Client ───────────────────────────────────────────────────────────────────

function projectKeyQuery(projectKey?: string): string {
  return projectKey ? `?project_key=${encodeURIComponent(projectKey)}` : "";
}

export class LedgerClient {
  private static instance: LedgerClient | null = null;

  static getInstance(): LedgerClient {
    if (!LedgerClient.instance) {
      LedgerClient.instance = new LedgerClient();
    }
    return LedgerClient.instance;
  }

  async getAgenda(params: GetAgendaParams = {}): Promise<AgendaSnapshot> {
    const query = new URLSearchParams();
    if (params.projectKey) {
      query.set("project_key", params.projectKey);
    }
    if (params.horizonDays != null) {
      query.set("horizon_days", String(params.horizonDays));
    }
    const qs = query.toString();
    return agentApiClient.get<AgendaSnapshot>(`ledger/agenda${qs ? `?${qs}` : ""}`);
  }

  async listRecords(params: ListRecordsParams = {}): Promise<ListRecordsResponse> {
    const query = new URLSearchParams();
    if (params.scope) {
      query.set("scope", params.scope);
    }
    if (params.projectKey) {
      query.set("project_key", params.projectKey);
    }
    if (params.status && params.status.length > 0) {
      query.set("status", params.status.join(","));
    }
    if (params.kind && params.kind.length > 0) {
      query.set("kind", params.kind.join(","));
    }
    if (params.includeTerminal != null) {
      query.set("include_terminal", String(params.includeTerminal));
    }
    if (params.parentId) {
      query.set("parent_id", params.parentId);
    }
    if (params.limit != null) {
      query.set("limit", String(params.limit));
    }
    const qs = query.toString();
    return agentApiClient.get<ListRecordsResponse>(`ledger/records${qs ? `?${qs}` : ""}`);
  }

  async upsertRecord(req: UpsertRecordRequest): Promise<UpsertRecordResponse> {
    return agentApiClient.post<UpsertRecordResponse>("ledger/records", req);
  }

  async patchRecord(
    recordId: string,
    req: PatchRecordRequest,
    projectKey?: string,
  ): Promise<PatchRecordResponse> {
    const encoded = encodeURIComponent(recordId);
    return agentApiClient.patch<PatchRecordResponse>(
      `ledger/records/${encoded}${projectKeyQuery(projectKey)}`,
      req,
    );
  }

  async deleteRecord(recordId: string, projectKey?: string): Promise<DeleteRecordResponse> {
    const encoded = encodeURIComponent(recordId);
    return agentApiClient.delete<DeleteRecordResponse>(
      `ledger/records/${encoded}${projectKeyQuery(projectKey)}`,
    );
  }
}
