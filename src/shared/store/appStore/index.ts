import { create } from "zustand";
import { devtools, subscribeWithSelector } from "zustand/middleware";
import { ChatSlice, createChatSlice } from "./slices/chatSessionSlice";
import { ModelSlice, createModelSlice } from "./slices/modelSlice";
import { PromptSlice, createPromptSlice } from "./slices/promptSlice";
import { SessionSlice, createSessionSlice } from "./slices/appSettingsSlice";
import { SkillSlice, createSkillSlice } from "./slices/skillSlice";
import { TokenBudgetSlice, createTokenBudgetSlice } from "./slices/tokenBudgetSlice";
import { TaskListSlice, createTaskListSlice } from "./slices/todoListSlice";
import { InputStateSlice, createInputStateSlice } from "./slices/inputStateSlice";
import { ExecutionStateSlice, createExecutionStateSlice } from "./slices/executionStateSlice";
import { AgentClient } from "@services/chat/AgentService";
import { startAccountFeed } from "@services/chat/accountFeed";
import { serviceFactory } from "@services/common/ServiceFactory";
import { readStoredProxyAuth } from "@shared/utils/proxyAuth";
import { useBambooConfigStore } from "@shared/store/bambooConfigStore";
import { useProviderStore } from "./slices/providerSlice";
import type { ChatItem, Message } from "@shared/types/chat";

const DEFAULT_PROXY_AUTH_MODE = "auto";
const REQUIRED_PROXY_AUTH_MODE = "required";
const AGENT_HEALTH_CHECK_INTERVAL_MS = 10000;
const SESSION_INDEX_SYNC_INTERVAL_MS = 15000;

type AgentAvailabilitySlice = {
  agentAvailability: boolean | null;
  setAgentAvailability: (available: boolean | null) => void;
  checkAgentAvailability: () => Promise<boolean>;
  startAgentHealthCheck: () => void;
};

type SessionIndexSyncSlice = {
  refreshSessionsIndex: () => Promise<void>;
  startSessionsIndexSync: () => void;
};

const agentClient = AgentClient.getInstance();
let agentHealthCheckTimer: ReturnType<typeof setInterval> | null = null;
let agentHealthCheckInFlight: Promise<boolean> | null = null;
let sessionsIndexSyncTimer: ReturnType<typeof setInterval> | null = null;
let sessionsIndexRefreshInFlight: Promise<void> | null = null;
const chatLookupCache = new WeakMap<ReadonlyArray<ChatItem>, Map<string, ChatItem>>();

export type AppState = ChatSlice &
  ModelSlice &
  PromptSlice &
  SessionSlice &
  SkillSlice &
  TokenBudgetSlice &
  TaskListSlice &
  InputStateSlice &
  ExecutionStateSlice &
  AgentAvailabilitySlice &
  SessionIndexSyncSlice;

export const useAppStore = create<AppState>()(
  devtools(
    subscribeWithSelector((set, get, api) => ({
      ...createChatSlice(set, get, api),
      ...createModelSlice(set, get, api),
      ...createPromptSlice(set, get, api),
      ...createSessionSlice(set, get, api),
      ...createSkillSlice(set, get, api),
      ...createTokenBudgetSlice(set, get, api),
      ...createTaskListSlice(set, get, api),
      ...createInputStateSlice(set, get, api),
      ...createExecutionStateSlice(set, get, api),
      agentAvailability: null,
      setAgentAvailability: (available) => {
        set({ agentAvailability: available });
      },
      checkAgentAvailability: async () => {
        if (agentHealthCheckInFlight) {
          return agentHealthCheckInFlight;
        }

        agentHealthCheckInFlight = (async () => {
          const available = await agentClient.healthCheck();

          if (get().agentAvailability !== available) {
            set({ agentAvailability: available });
          }

          return available;
        })();

        try {
          return await agentHealthCheckInFlight;
        } finally {
          agentHealthCheckInFlight = null;
        }
      },
      startAgentHealthCheck: () => {
        if (agentHealthCheckTimer) {
          return;
        }

        void get().checkAgentAvailability();

        agentHealthCheckTimer = setInterval(() => {
          void get().checkAgentAvailability();
        }, AGENT_HEALTH_CHECK_INTERVAL_MS);
      },

      refreshSessionsIndex: async () => {
        if (sessionsIndexRefreshInFlight) {
          return sessionsIndexRefreshInFlight;
        }

        sessionsIndexRefreshInFlight = (async () => {
          try {
            await get().refreshChats();
          } catch (e) {
            // Best-effort: backend may be down during startup/restart.
            console.warn("[AppStore] refreshChats failed:", e);
          }
        })();

        try {
          return await sessionsIndexRefreshInFlight;
        } finally {
          sessionsIndexRefreshInFlight = null;
        }
      },

      startSessionsIndexSync: () => {
        if (sessionsIndexSyncTimer) {
          return;
        }

        void get().refreshSessionsIndex();

        sessionsIndexSyncTimer = setInterval(() => {
          void get().refreshSessionsIndex();
        }, SESSION_INDEX_SYNC_INTERVAL_MS);
      },
    })),
    { name: "AppStore" },
  ),
);

const getChatLookup = (chats: ReadonlyArray<ChatItem>): Map<string, ChatItem> => {
  const cached = chatLookupCache.get(chats);
  if (cached) {
    return cached;
  }

  const lookup = new Map(chats.map((chat) => [chat.id, chat]));
  chatLookupCache.set(chats, lookup);
  return lookup;
};

export const selectSessionById =
  (sessionId: string | null) =>
  (state: AppState): ChatItem | null => {
    if (!sessionId) {
      return null;
    }

    return getChatLookup(state.chats).get(sessionId) ?? null;
  };

export const selectCurrentChat = (state: AppState): ChatItem | null => {
  if (!state.currentSessionId) {
    return null;
  }

  return getChatLookup(state.chats).get(state.currentSessionId) ?? null;
};

export const selectCurrentMessages = (state: AppState): Message[] =>
  selectCurrentChat(state)?.messages ?? [];

const applyStoredProxyAuth = async (): Promise<boolean> => {
  const storedAuth = readStoredProxyAuth();
  if (!storedAuth) {
    return false;
  }

  try {
    await serviceFactory.setProxyAuth(storedAuth);
    return true;
  } catch (error) {
    console.error("Failed to apply stored proxy auth during startup:", error);
    return false;
  }
};

const bootstrapProxyAuthGate = async (): Promise<boolean> => {
  try {
    const config = await useBambooConfigStore.getState().loadConfig();
    const mode =
      typeof config?.proxy_auth_mode === "string"
        ? config.proxy_auth_mode
        : DEFAULT_PROXY_AUTH_MODE;

    if (mode !== REQUIRED_PROXY_AUTH_MODE) {
      await applyStoredProxyAuth();
      return false;
    }

    // If the backend already has proxy auth configured (e.g. loaded from encrypted
    // config on disk), do not gate startup on localStorage.
    const status = await useBambooConfigStore.getState().loadProxyAuthStatus({ force: true });
    if (status?.configured) {
      return false;
    }

    const hasAppliedStoredAuth = await applyStoredProxyAuth();
    if (hasAppliedStoredAuth) {
      return false;
    }

    useAppStore.setState((state) => ({
      ...state,
      models: [],
      selectedModel: undefined,
      modelsError:
        "Proxy auth mode is set to required. Please configure proxy username/password and apply it.",
      isLoadingModels: false,
    }));

    return true;
  } catch (error) {
    console.error("Failed to evaluate startup proxy auth mode:", error);
    return false;
  }
};

// Staged bootstrap — split into critical vs deferred work so the first useful
// UI (chat shell + session list) appears without waiting for models / prompts.
let isInitialized = false;
let isCriticalDone = false;
let deferredBootstrapPromise: Promise<void> | null = null;

/**
 * Critical bootstrap — loads only what the chat shell needs to render:
 * provider defaults + session list.  Callers should `await` this before
 * rendering the main layout, then fire-and-forget `bootstrapDeferred()`.
 */
const bootstrapCritical = async (force: boolean = false): Promise<void> => {
  if (isInitialized && !force) {
    return;
  }
  isInitialized = true;

  if (import.meta.env.MODE !== "test") {
    // Primary real-time channel: one resumable account change-feed that pushes
    // cross-session updates (created/deleted/cleared/title/pinned/message/task)
    // and drives agent availability from its connection state.
    startAccountFeed();
    // Retained as a low-frequency self-healing fallback alongside the feed —
    // recovers from any missed window without the old high-frequency polling.
    useAppStore.getState().startAgentHealthCheck();
    useAppStore.getState().startSessionsIndexSync();
  }

  // Load provider state first so defaults (including default model) are available
  // before any session operations that may depend on them.
  //
  // Skip network-backed provider bootstrap in unit tests. Those tests commonly
  // stub only the specific bootstrap dependencies they care about, and they
  // should not hang on unrelated provider settings retries.
  const isVitestRuntime =
    typeof globalThis !== "undefined" &&
    "__vitest_worker__" in (globalThis as Record<string, unknown>);
  if (!isVitestRuntime) {
    try {
      await useProviderStore.getState().loadProviderInstances();
      if (!useProviderStore.getState().isInstancesLoaded) {
        await useProviderStore.getState().loadProviderConfig();
      }
    } catch (error) {
      console.error("[AppStore] Failed to bootstrap provider state:", error);
    }
  }

  // Load chats as early as possible so the UI always has an active chat.
  // This prevents the controlled message input from appearing "read-only"
  // in fresh sessions (e.g., Playwright E2E with empty localStorage).
  await useAppStore.getState().loadChats();

  isCriticalDone = true;
};

/**
 * Deferred bootstrap — fetches models, resolves proxy-auth gate, and loads
 * system prompts.  None of these block the initial shell render.
 * Errors are logged but never prevent the UI from being interactive.
 */
const bootstrapDeferred = async (): Promise<void> => {
  if (!isCriticalDone) {
    return;
  }

  if (deferredBootstrapPromise) {
    return deferredBootstrapPromise;
  }

  deferredBootstrapPromise = (async () => {
    try {
      const shouldSkipModelBootstrap = await bootstrapProxyAuthGate();

      if (!shouldSkipModelBootstrap) {
        await useAppStore.getState().fetchModels();
      }

      await useAppStore.getState().loadSystemPrompts();
    } catch (error) {
      console.error("[AppStore] Deferred bootstrap failed:", error);
    }
  })();

  return deferredBootstrapPromise;
};

/**
 * Backward-compatible wrapper: runs critical path, then deferred in background.
 * Existing callers (App.tsx) can continue to call this without changes.
 */
const initializeStore = async (force: boolean = false): Promise<void> => {
  await bootstrapCritical(force);
  // Fire-and-forget — deferred work must not block the shell from rendering.
  bootstrapDeferred().catch((err) => {
    console.error("[AppStore] Deferred bootstrap error:", err);
  });
};

// Export for explicit initialization by App.tsx after setup is complete.
// Also export staged variants for callers that want finer control.
export { initializeStore, bootstrapCritical, bootstrapDeferred };

// Execution-state selectors
export {
  selectExecutionState,
  selectExecutionPhase,
  selectIsBusy,
  selectIsStreaming,
  selectIsAwaitingUser,
  selectIsInputLocked,
  selectCanCancel,
  selectShouldObserve,
  selectActiveToolCalls,
  selectPendingQuestion,
  selectPendingChildApproval,
  selectRespondMode,
  selectChildren,
  selectChildrenSnapshot,
  selectGeneration,
  selectRailModel,
  selectExecutionByPane,
} from "./selectors/executionSelectors";
