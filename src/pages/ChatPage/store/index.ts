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
import { AgentClient } from "../services/AgentService";
import { serviceFactory } from "../../../services/common/ServiceFactory";
import { readStoredProxyAuth } from "../../../shared/utils/proxyAuth";
import { useBambooConfigStore } from "../../../shared/stores/bambooConfigStore";
import { useProviderStore } from "./slices/providerSlice";
import type { ChatItem, Message } from "../types/chat";

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

// Initialize the store
let isInitialized = false;

const initializeStore = async (force: boolean = false) => {
  if (isInitialized && !force) {
    return;
  }
  isInitialized = true;

  if (import.meta.env.MODE !== "test") {
    useAppStore.getState().startAgentHealthCheck();
    // Keep a low-frequency self-healing session-index sync running alongside
    // event-driven updates. This is intentionally much less frequent than the
    // old 2-second polling loop, but it helps recover from missed SSE windows,
    // reconnect gaps, and late task/sub-session state propagation.
    useAppStore.getState().startSessionsIndexSync();
  }

  // Load provider config first so defaults (including default model) are available
  // before any session operations that may depend on them.
  await useProviderStore.getState().loadProviderConfig();

  // Load chats as early as possible so the UI always has an active chat.
  // This prevents the controlled message input from appearing "read-only"
  // in fresh sessions (e.g., Playwright E2E with empty localStorage).
  await useAppStore.getState().loadChats();

  const shouldSkipModelBootstrap = await bootstrapProxyAuthGate();

  if (!shouldSkipModelBootstrap) {
    await useAppStore.getState().fetchModels();
  }

  await useAppStore.getState().loadSystemPrompts();
};

// Export for explicit initialization by App.tsx after setup is complete
export { initializeStore };

// Phase 1+ — execution-state selectors (short imports)
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
  selectRespondMode,
  selectChildren,
  selectChildrenSnapshot,
  selectGeneration,
  selectRailModel,
  selectExecutionByPane,
} from "./selectors/executionSelectors";
