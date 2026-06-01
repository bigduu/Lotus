import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";

import type {
  AgentEvent,
  RunningSessionsResponse,
  SessionSummary,
} from "@services/chat/AgentService";
import { createChatSlice, type ChatSlice } from "../slices/chatSessionSlice";

// Hoisted mock for `listSessions` and `getRunningSessions` so the slice's
// singleton AgentClient picks up the stubs.
const { mockListSessions, mockGetRunningSessions } = vi.hoisted(() => ({
  mockListSessions: vi.fn<() => Promise<{ sessions: SessionSummary[] }>>(),
  mockGetRunningSessions: vi.fn<() => Promise<RunningSessionsResponse>>(),
}));

vi.mock("@services/chat/AgentService", () => ({
  AgentClient: {
    getInstance: vi.fn(() => ({
      deleteSession: vi.fn(),
      listSessions: mockListSessions,
      createSession: vi.fn(),
      patchSession: vi.fn(async () => undefined),
      getHistory: vi.fn(async () => ({
        session_id: "s",
        compression_events: [],
        messages: [],
      })),
      deleteSessionMessage: vi.fn(),
      getRunningSessions: mockGetRunningSessions,
    })),
  },
}));

const createSummary = (overrides: Partial<SessionSummary> & { id: string }): SessionSummary => ({
  id: overrides.id,
  kind: overrides.kind ?? "root",
  title: overrides.title ?? "Remote Title",
  title_version: overrides.title_version ?? 0,
  pinned: overrides.pinned ?? false,
  parent_session_id: null,
  root_session_id: overrides.root_session_id ?? overrides.id,
  spawn_depth: 0,
  model: overrides.model ?? "gpt-test",
  model_ref: overrides.model_ref ?? null,
  reasoning_effort: overrides.reasoning_effort ?? null,
  created_by_schedule_id: null,
  created_at: overrides.created_at ?? "2026-01-01T00:00:00.000Z",
  updated_at: overrides.updated_at ?? "2026-01-15T12:00:00.000Z",
  last_activity_at: overrides.last_activity_at ?? "2026-01-15T12:00:00.000Z",
  message_count: overrides.message_count ?? 0,
  has_attachments: false,
  is_running: overrides.is_running ?? false,
});

const createTestStore = (): StoreApi<ChatSlice> => {
  const sliceCreator = createChatSlice as unknown as (
    set: StoreApi<ChatSlice>["setState"],
    get: StoreApi<ChatSlice>["getState"],
    api: StoreApi<ChatSlice>,
  ) => ChatSlice;
  const store = createStore<ChatSlice>()((set, get, api) => sliceCreator(set, get, api));
  // loadChats touches `executionBySession`; seed empty so the reconcile loop
  // has a stable starting point.
  store.setState((state) => ({ ...state, executionBySession: {} }) as ChatSlice);
  return store;
};

// =============================================================================
// F6: Boot `loadChats` must NOT clobber replay metadata with stale baseline.
//
// `listSessions` returns a baseline summary at `title_version=2`.
// `getRunningSessions` returns a replay event with `title_version=5`.
// The final store MUST have `title_version=5` — the replay metadata survives
// the trailing `set({ chats })`.
// =============================================================================

describe("loadChats boot replay preserves metadata through trailing set", () => {
  let store: StoreApi<ChatSlice>;

  beforeEach(() => {
    store = createTestStore();
    mockListSessions.mockReset();
    mockGetRunningSessions.mockReset();
  });

  it("prefers higher-version replay title over stale baseline", async () => {
    mockListSessions.mockResolvedValueOnce({
      sessions: [
        createSummary({
          id: "s1",
          title: "Old Baseline",
          title_version: 2,
          is_running: true,
          updated_at: "2026-01-15T12:00:00.000Z",
        }),
      ],
    });

    const replayEvent: AgentEvent = {
      type: "session_title_updated",
      session_id: "s1",
      title: "New From Replay",
      title_version: 5,
      source: "auto",
      updated_at: "2026-01-15T13:00:00.000Z",
    };

    mockGetRunningSessions.mockResolvedValueOnce({
      sessions: [
        {
          session_id: "s1",
          run_id: "r1",
          started_at: "2026-01-15T12:00:00.000Z",
          round_count: 1,
          last_tool_name: null,
          last_tool_phase: null,
          last_event_at: null,
          last_critical_events: [replayEvent],
          running_child_session_ids: [],
        },
      ],
    });

    await store.getState().loadChats();

    const chat = store.getState().chats.find((c) => c.id === "s1");
    expect(chat?.title).toBe("New From Replay");
    expect(chat?.titleVersion).toBe(5);
  });

  it("keeps baseline when replay has a lower title_version", async () => {
    mockListSessions.mockResolvedValueOnce({
      sessions: [
        createSummary({
          id: "s1",
          title: "Fresh Baseline",
          title_version: 5,
          is_running: true,
          updated_at: "2026-01-15T12:00:00.000Z",
        }),
      ],
    });

    const staleReplayEvent: AgentEvent = {
      type: "session_title_updated",
      session_id: "s1",
      title: "Stale Replay",
      title_version: 2,
      source: "auto",
      updated_at: "2026-01-15T11:00:00.000Z",
    };

    mockGetRunningSessions.mockResolvedValueOnce({
      sessions: [
        {
          session_id: "s1",
          run_id: "r1",
          started_at: "2026-01-15T12:00:00.000Z",
          round_count: 1,
          last_tool_name: null,
          last_tool_phase: null,
          last_event_at: null,
          last_critical_events: [staleReplayEvent],
          running_child_session_ids: [],
        },
      ],
    });

    await store.getState().loadChats();

    const chat = store.getState().chats.find((c) => c.id === "s1");
    expect(chat?.title).toBe("Fresh Baseline");
    expect(chat?.titleVersion).toBe(5);
  });

  it("applies pinned replay with newer updated_at", async () => {
    mockListSessions.mockResolvedValueOnce({
      sessions: [
        createSummary({
          id: "s1",
          title: "Session",
          title_version: 0,
          pinned: false,
          is_running: true,
          updated_at: "2026-01-15T12:00:00.000Z",
        }),
      ],
    });

    const pinnedReplayEvent: AgentEvent = {
      type: "session_pinned_updated",
      session_id: "s1",
      pinned: true,
      updated_at: "2026-01-15T13:00:00.000Z",
    };

    mockGetRunningSessions.mockResolvedValueOnce({
      sessions: [
        {
          session_id: "s1",
          run_id: "r1",
          started_at: "2026-01-15T12:00:00.000Z",
          round_count: 1,
          last_tool_name: null,
          last_tool_phase: null,
          last_event_at: null,
          last_critical_events: [pinnedReplayEvent],
          running_child_session_ids: [],
        },
      ],
    });

    await store.getState().loadChats();

    const chat = store.getState().chats.find((c) => c.id === "s1");
    expect(chat?.pinned).toBe(true);
  });

  it("ignores stale pinned replay with older updated_at", async () => {
    mockListSessions.mockResolvedValueOnce({
      sessions: [
        createSummary({
          id: "s1",
          title: "Session",
          title_version: 0,
          pinned: true,
          is_running: true,
          updated_at: "2026-01-15T13:00:00.000Z",
        }),
      ],
    });

    const stalePinnedReplayEvent: AgentEvent = {
      type: "session_pinned_updated",
      session_id: "s1",
      pinned: false,
      updated_at: "2026-01-15T12:00:00.000Z",
    };

    mockGetRunningSessions.mockResolvedValueOnce({
      sessions: [
        {
          session_id: "s1",
          run_id: "r1",
          started_at: "2026-01-15T12:00:00.000Z",
          round_count: 1,
          last_tool_name: null,
          last_tool_phase: null,
          last_event_at: null,
          last_critical_events: [stalePinnedReplayEvent],
          running_child_session_ids: [],
        },
      ],
    });

    await store.getState().loadChats();

    const chat = store.getState().chats.find((c) => c.id === "s1");
    expect(chat?.pinned).toBe(true);
  });
});
