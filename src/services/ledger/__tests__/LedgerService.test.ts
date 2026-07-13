import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LedgerClient } from "../LedgerService";
import { mockFetchError, mockFetchResponse } from "@test/helpers";

function lastRequestUrl(fetchMock: ReturnType<typeof vi.fn>): URL {
  const [rawUrl] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return new URL(String(rawUrl), "http://localhost");
}

describe("LedgerClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("gets the agenda snapshot with query params", async () => {
    fetchMock.mockResolvedValue(
      mockFetchResponse({
        generated_at: "2026-07-13T08:00:00Z",
        overdue: [],
        today: [],
        upcoming: [],
        undated: [],
      }),
    );

    const client = LedgerClient.getInstance();
    const snapshot = await client.getAgenda({ projectKey: "proj-1", horizonDays: 14 });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/ledger/agenda"),
      expect.objectContaining({ method: "GET" }),
    );
    const url = lastRequestUrl(fetchMock);
    expect(url.searchParams.get("project_key")).toBe("proj-1");
    expect(url.searchParams.get("horizon_days")).toBe("14");
    expect(snapshot.generated_at).toBe("2026-07-13T08:00:00Z");
  });

  it("omits the query string when no agenda params are given", async () => {
    fetchMock.mockResolvedValue(
      mockFetchResponse({
        generated_at: "2026-07-13T08:00:00Z",
        overdue: [],
        today: [],
        upcoming: [],
        undated: [],
      }),
    );

    const client = LedgerClient.getInstance();
    await client.getAgenda();

    const url = lastRequestUrl(fetchMock);
    expect(url.pathname.endsWith("/ledger/agenda")).toBe(true);
    expect(url.search).toBe("");
  });

  it("lists records with comma-joined status/kind tokens and filters", async () => {
    fetchMock.mockResolvedValue(mockFetchResponse({ records: [], returned: 0, matched: 0 }));

    const client = LedgerClient.getInstance();
    await client.listRecords({
      status: ["open", "blocked"],
      kind: ["todo", "reminder"],
      includeTerminal: true,
      limit: 50,
      scope: "project",
      projectKey: "proj-1",
      parentId: "parent-1",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/ledger/records"),
      expect.objectContaining({ method: "GET" }),
    );
    const url = lastRequestUrl(fetchMock);
    expect(url.searchParams.get("status")).toBe("open,blocked");
    expect(url.searchParams.get("kind")).toBe("todo,reminder");
    expect(url.searchParams.get("include_terminal")).toBe("true");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("scope")).toBe("project");
    expect(url.searchParams.get("project_key")).toBe("proj-1");
    expect(url.searchParams.get("parent_id")).toBe("parent-1");
  });

  it("creates a record via POST upsert", async () => {
    fetchMock.mockResolvedValue(
      mockFetchResponse({
        result: "create",
        record: { id: "rec-1", title: "Buy milk" },
        body: "created",
      }),
    );

    const client = LedgerClient.getInstance();
    const response = await client.upsertRecord({
      kind: "todo",
      title: "Buy milk",
      due_at: "2026-07-14",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/ledger/records"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ kind: "todo", title: "Buy milk", due_at: "2026-07-14" }),
      }),
    );
    expect(response.result).toBe("create");
  });

  it("patches a record status with an encoded id and project key", async () => {
    fetchMock.mockResolvedValue(
      mockFetchResponse({ record: { id: "rec/1", status: "done" }, body: "done" }),
    );

    const client = LedgerClient.getInstance();
    await client.patchRecord("rec/1", { status: "done", reason: "finished" }, "proj one");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/ledger/records/rec%2F1"),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "done", reason: "finished" }),
      }),
    );
    const url = lastRequestUrl(fetchMock);
    expect(url.searchParams.get("project_key")).toBe("proj one");
  });

  it("cancels a record via DELETE", async () => {
    fetchMock.mockResolvedValue(
      mockFetchResponse({ success: true, record: { id: "rec-1", status: "cancelled" } }),
    );

    const client = LedgerClient.getInstance();
    const response = await client.deleteRecord("rec-1");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/ledger/records/rec-1"),
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(response.success).toBe(true);
  });

  it("throws an ApiError when the backend rejects a request", async () => {
    fetchMock.mockResolvedValue(mockFetchError("record not found", 404));

    const client = LedgerClient.getInstance();

    await expect(client.patchRecord("missing", { status: "done" })).rejects.toThrow(
      "record not found",
    );
  });
});
