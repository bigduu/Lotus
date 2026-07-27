import { create } from "zustand";
import {
  CONFIG_SECTION_IDS,
  ConfigConflictError,
  configSectionsService,
  type AccessMutationResult,
  type AccessPasswordClearMutation,
  type AccessPasswordMutation,
  type AccessRuntimeStatus,
  type ClusterDefinitionMutation,
  type ClusterMutationResult,
  type ClusterNodeMutation,
  type ConfigRevisionConflict,
  type ConfigSectionDataMap,
  type ConfigSectionEnvelope,
  type ConfigSectionId,
  type ConfigSectionStatus,
  type ConnectSectionDraft,
  type EnvMutationResult,
  type EnvVarMutation,
  type McpCredentialChanges,
  type McpSection,
  type NotificationSectionEnvelope,
  type NotificationSectionDraft,
  type ProviderCredentialChanges,
  type ProviderSection,
  type ProxyAuthStatus,
  type WritableConfigSectionId,
} from "@services/config/configSections";
import { redactConfigError } from "@shared/utils/configErrors";

export interface ConfigSectionSnapshot<K extends ConfigSectionId = ConfigSectionId> {
  envelope: ConfigSectionEnvelope<ConfigSectionDataMap[K]> | null;
  loading: boolean;
  error: string | null;
  conflict: ConfigRevisionConflict | null;
  requestId: number;
}

type ConfigSectionStateMap = {
  [K in ConfigSectionId]: ConfigSectionSnapshot<K>;
};

interface ConfigSectionStoreState {
  sections: ConfigSectionStateMap;
  proxyAuthStatus: ProxyAuthStatus | null;
  proxyAuthLoading: boolean;
  proxyAuthError: string | null;
  accessRuntimeStatus: AccessRuntimeStatus | null;
  accessRuntimeLoading: boolean;
  accessRuntimeError: string | null;
  loadSection: <K extends ConfigSectionId>(
    section: K,
    options?: { force?: boolean },
  ) => Promise<ConfigSectionEnvelope<ConfigSectionDataMap[K]>>;
  saveSection: <
    K extends Exclude<
      WritableConfigSectionId,
      | "notifications"
      | "providers"
      | "mcp"
      | "connect"
      | "cluster-fabric"
      | "env"
      | "access-control"
    >,
  >(
    section: K,
    data: ConfigSectionDataMap[K],
    expectedRevision?: number,
  ) => Promise<ConfigSectionEnvelope<ConfigSectionDataMap[K]>>;
  saveMcpSettings: (
    data: McpSection,
    credentialChanges?: McpCredentialChanges,
    expectedRevision?: number,
  ) => Promise<ConfigSectionEnvelope<McpSection>>;
  saveProviderSettings: (
    data: ProviderSection,
    credentialChanges?: ProviderCredentialChanges,
    expectedRevision?: number,
  ) => Promise<ConfigSectionEnvelope<ProviderSection>>;
  saveNotifications: (
    data: NotificationSectionDraft,
    expectedRevision?: number,
  ) => Promise<NotificationSectionEnvelope>;
  saveConnect: (
    data: ConnectSectionDraft,
    expectedRevision?: number,
  ) => Promise<ConfigSectionEnvelope<ConfigSectionDataMap["connect"]>>;
  saveEnvVar: (data: EnvVarMutation, expectedRevision?: number) => Promise<EnvMutationResult>;
  deleteEnvVar: (name: string, expectedRevision?: number) => Promise<EnvMutationResult>;
  loadAccessRuntimeStatus: (options?: { force?: boolean }) => Promise<AccessRuntimeStatus>;
  replaceAccessPassword: (
    data: AccessPasswordMutation,
    expectedRevision?: number,
  ) => Promise<AccessMutationResult>;
  clearAccessPassword: (
    data: AccessPasswordClearMutation,
    expectedRevision?: number,
  ) => Promise<AccessMutationResult>;
  saveClusterNode: (
    nodeId: string | null,
    data: ClusterNodeMutation,
    expectedRevision?: number,
  ) => Promise<ClusterMutationResult>;
  deleteClusterNode: (nodeId: string, expectedRevision?: number) => Promise<ClusterMutationResult>;
  saveCluster: (
    currentName: string | null,
    data: ClusterDefinitionMutation,
    expectedRevision?: number,
  ) => Promise<ClusterMutationResult>;
  deleteCluster: (name: string, expectedRevision?: number) => Promise<ClusterMutationResult>;
  runClusterNodeAction: (
    nodeId: string,
    action: "test" | "deploy" | "stop",
    expectedRevision?: number,
  ) => Promise<ClusterMutationResult>;
  resetSection: <K extends ConfigSectionId>(
    section: K,
    expectedRevision?: number,
  ) => Promise<ConfigSectionEnvelope<ConfigSectionDataMap[K]>>;
  loadProxyAuthStatus: (options?: { force?: boolean }) => Promise<ProxyAuthStatus>;
  replaceProxyAuth: (
    auth: { username: string; password: string },
    expectedRevision?: number,
  ) => Promise<ProxyAuthStatus>;
  clearProxyAuth: (expectedRevision?: number) => Promise<ProxyAuthStatus>;
  handleConfigEvent: (
    section: string,
    revision: number,
    eventType: "config.changed" | "config.invalid" | "config.recovered",
  ) => void;
  resyncLoadedSections: () => Promise<void>;
  clearConflict: (section: ConfigSectionId) => void;
  reset: () => void;
}

const emptySection = <K extends ConfigSectionId>(): ConfigSectionSnapshot<K> => ({
  envelope: null,
  loading: false,
  error: null,
  conflict: null,
  requestId: 0,
});

const createInitialSections = (): ConfigSectionStateMap =>
  Object.fromEntries(
    CONFIG_SECTION_IDS.map((section) => [section, emptySection()]),
  ) as ConfigSectionStateMap;

const inFlightLoads = new Map<ConfigSectionId, Promise<ConfigSectionEnvelope<unknown>>>();
let proxyAuthLoad: Promise<ProxyAuthStatus> | null = null;
let accessRuntimeLoad: Promise<AccessRuntimeStatus> | null = null;
let accessRuntimeRequestSequence = 0;
let accessRuntimeGeneration = 0;
const eventTimers = new Map<ConfigSectionId, ReturnType<typeof setTimeout>>();
const pendingEventRevisions = new Map<ConfigSectionId, number>();
const mutationSequences = new Map<ConfigSectionId, number>();
const CONFIG_EVENT_DEBOUNCE_MS = 80;
const CONFIG_EVENT_RETRY_MS = 1_000;

const errorMessage = (error: unknown): string =>
  redactConfigError(error instanceof Error ? error.message : "Unable to load configuration");

const isSectionId = (value: string): value is ConfigSectionId =>
  (CONFIG_SECTION_IDS as readonly string[]).includes(value);

const unhealthyStatusFor = (
  eventType: "config.invalid" | "config.changed" | "config.recovered",
): ConfigSectionStatus | null => (eventType === "config.invalid" ? "invalid" : null);

const beginMutation = (section: ConfigSectionId): number => {
  const sequence = (mutationSequences.get(section) ?? 0) + 1;
  mutationSequences.set(section, sequence);
  return sequence;
};

const isLatestMutation = (section: ConfigSectionId, sequence: number): boolean =>
  mutationSequences.get(section) === sequence;

export const useConfigSectionStore = create<ConfigSectionStoreState>((set, get) => {
  function scheduleEventConvergence(
    section: ConfigSectionId,
    delay = CONFIG_EVENT_DEBOUNCE_MS,
  ): void {
    if (eventTimers.has(section)) return;
    eventTimers.set(
      section,
      setTimeout(() => {
        eventTimers.delete(section);
        void convergeToEventRevision(section);
      }, delay),
    );
  }

  async function convergeToEventRevision(section: ConfigSectionId): Promise<void> {
    const targetRevision = pendingEventRevisions.get(section);
    if (targetRevision === undefined) return;

    const beforeRevision = get().sections[section].envelope?.revision ?? -1;
    if (beforeRevision > targetRevision) {
      pendingEventRevisions.delete(section);
      return;
    }

    let refreshed = false;
    try {
      await get().loadSection(section, { force: true });
      refreshed = true;
    } catch {
      // loadSection records a visible error while preserving the LKG envelope.
      // Keep the event target and retry: dropping it here can strand a section
      // below the durable revision advertised by the feed.
    }

    const latestTarget = pendingEventRevisions.get(section);
    if (latestTarget === undefined) return;
    const currentRevision = get().sections[section].envelope?.revision ?? -1;
    if (currentRevision > latestTarget || (refreshed && currentRevision >= latestTarget)) {
      pendingEventRevisions.delete(section);
      return;
    }
    scheduleEventConvergence(section, CONFIG_EVENT_RETRY_MS);
  }

  async function commitClusterMutation(
    expectedRevision: number | undefined,
    mutate: (revision: number) => Promise<ClusterMutationResult>,
  ): Promise<ClusterMutationResult> {
    const section = "cluster-fabric" as const;
    const snapshot = get().sections[section];
    const revision = expectedRevision ?? snapshot.envelope?.revision;
    if (revision === undefined) throw new Error("Load cluster-fabric before changing it.");
    const mutationSequence = beginMutation(section);

    try {
      const result = await mutate(revision);
      set((state) => {
        const current = state.sections[section];
        const adoptedEnvelope =
          (current.envelope?.revision ?? -1) > result.envelope.revision
            ? current.envelope
            : result.envelope;
        const latestMutation = isLatestMutation(section, mutationSequence);
        return {
          sections: {
            ...state.sections,
            [section]: {
              ...current,
              envelope: adoptedEnvelope,
              loading: false,
              error: latestMutation ? null : current.error,
              conflict: latestMutation ? null : current.conflict,
            },
          },
        };
      });
      const adopted = get().sections[section].envelope;
      return {
        ...result,
        envelope:
          adopted && adopted.revision > result.envelope.revision ? adopted : result.envelope,
      };
    } catch (error) {
      const conflict = error instanceof ConfigConflictError ? error.conflict : null;
      if (!isLatestMutation(section, mutationSequence)) throw error;
      set((state) => ({
        sections: {
          ...state.sections,
          [section]: {
            ...state.sections[section],
            error: errorMessage(error),
            conflict,
          },
        },
      }));
      throw error;
    }
  }

  async function commitEnvMutation(
    expectedRevision: number | undefined,
    mutate: (revision: number) => Promise<EnvMutationResult>,
  ): Promise<EnvMutationResult> {
    const section = "env" as const;
    const snapshot = get().sections[section];
    const revision = expectedRevision ?? snapshot.envelope?.revision;
    if (revision === undefined) throw new Error("Load env before changing it.");
    const mutationSequence = beginMutation(section);

    try {
      const result = await mutate(revision);
      set((state) => {
        const current = state.sections[section];
        const adoptedEnvelope =
          (current.envelope?.revision ?? -1) > result.envelope.revision
            ? current.envelope
            : result.envelope;
        const latestMutation = isLatestMutation(section, mutationSequence);
        return {
          sections: {
            ...state.sections,
            [section]: {
              ...current,
              envelope: adoptedEnvelope,
              loading: false,
              error: latestMutation ? null : current.error,
              conflict: latestMutation ? null : current.conflict,
            },
          },
        };
      });
      return {
        envelope: get().sections.env.envelope ?? result.envelope,
      };
    } catch (error) {
      const conflict = error instanceof ConfigConflictError ? error.conflict : null;
      if (!isLatestMutation(section, mutationSequence)) throw error;
      set((state) => ({
        sections: {
          ...state.sections,
          [section]: {
            ...state.sections[section],
            error: errorMessage(error),
            conflict,
          },
        },
      }));
      throw error;
    }
  }

  async function commitAccessMutation(
    expectedRevision: number | undefined,
    mutate: (revision: number) => Promise<AccessMutationResult>,
  ): Promise<AccessMutationResult> {
    const section = "access-control" as const;
    const snapshot = get().sections[section];
    const revision = expectedRevision ?? snapshot.envelope?.revision;
    if (revision === undefined) throw new Error("Load access-control before changing it.");
    const mutationSequence = beginMutation(section);

    try {
      const result = await mutate(revision);
      accessRuntimeRequestSequence += 1;
      set((state) => {
        const current = state.sections[section];
        const adoptedEnvelope =
          (current.envelope?.revision ?? -1) > result.envelope.revision
            ? current.envelope
            : result.envelope;
        const latestMutation = isLatestMutation(section, mutationSequence);
        const currentRuntime = state.accessRuntimeStatus;
        const adoptRuntime =
          currentRuntime !== null && currentRuntime.revision <= result.envelope.revision;
        const access = result.envelope.data;
        const adoptedRuntime = adoptRuntime
          ? {
              ...currentRuntime,
              revision: result.envelope.revision,
              status: result.envelope.status,
              source_kind: result.envelope.source_kind,
              loaded_at: result.envelope.loaded_at,
              last_error: result.envelope.last_error,
              password_configured: result.credential.configured,
              credential_state: result.credential.state,
              credential_ref: result.credential.credential_ref,
              credential_source: result.credential.source,
              credential_updated_at: result.credential.updated_at,
              password_enabled: Boolean(access?.password_enabled && result.credential.configured),
              requires_password: Boolean(
                access?.password_enabled &&
                  result.credential.configured &&
                  !currentRuntime.local_bypass,
              ),
            }
          : currentRuntime;
        return {
          accessRuntimeStatus: adoptedRuntime,
          accessRuntimeLoading: false,
          accessRuntimeError: latestMutation ? null : state.accessRuntimeError,
          sections: {
            ...state.sections,
            [section]: {
              ...current,
              envelope: adoptedEnvelope,
              loading: false,
              error: latestMutation ? null : current.error,
              conflict: latestMutation ? null : current.conflict,
            },
          },
        };
      });
      const adopted = get().sections[section].envelope;
      // The credential projection and section envelope are one canonical
      // response pair. If another event already installed a newer section,
      // keep that newer snapshot in the store but return this mutation's
      // original pair so a form cannot bind stale credential metadata to the
      // newer revision and accidentally hide the external update.
      return adopted && adopted.revision > result.envelope.revision
        ? result
        : {
            envelope: adopted ?? result.envelope,
            credential: result.credential,
          };
    } catch (error) {
      const conflict = error instanceof ConfigConflictError ? error.conflict : null;
      if (!isLatestMutation(section, mutationSequence)) throw error;
      set((state) => ({
        sections: {
          ...state.sections,
          [section]: {
            ...state.sections[section],
            error: errorMessage(error),
            conflict,
          },
        },
      }));
      throw error;
    }
  }

  return {
    sections: createInitialSections(),
    proxyAuthStatus: null,
    proxyAuthLoading: false,
    proxyAuthError: null,
    accessRuntimeStatus: null,
    accessRuntimeLoading: false,
    accessRuntimeError: null,

    loadSection: async <K extends ConfigSectionId>(section: K, options?: { force?: boolean }) => {
      const cached = get().sections[section].envelope;
      if (cached && !options?.force) {
        return cached as ConfigSectionEnvelope<ConfigSectionDataMap[K]>;
      }
      const existing = inFlightLoads.get(section);
      if (existing) {
        return existing as Promise<ConfigSectionEnvelope<ConfigSectionDataMap[K]>>;
      }

      const requestId = get().sections[section].requestId + 1;
      set((state) => ({
        sections: {
          ...state.sections,
          [section]: { ...state.sections[section], loading: true, error: null, requestId },
        },
      }));

      const request = configSectionsService.getSection(section);
      inFlightLoads.set(section, request as Promise<ConfigSectionEnvelope<unknown>>);
      try {
        const envelope = await request;
        set((state) => {
          const current = state.sections[section];
          if (current.requestId !== requestId) return state;
          const currentRevision = current.envelope?.revision ?? -1;
          if (envelope.revision < currentRevision) {
            return {
              sections: {
                ...state.sections,
                [section]: { ...current, loading: false },
              },
            };
          }
          return {
            sections: {
              ...state.sections,
              [section]: {
                ...current,
                envelope,
                loading: false,
                error: null,
                conflict: null,
              },
            },
          };
        });
        // A save may commit a newer revision while this GET is still in flight.
        // Keep both the store and awaiting form loaders on the adopted snapshot;
        // returning the stale response here would let component-local state
        // regress even though the Zustand snapshot correctly rejected it.
        const adopted = get().sections[section].envelope as ConfigSectionEnvelope<
          ConfigSectionDataMap[K]
        > | null;
        return adopted && adopted.revision > envelope.revision ? adopted : envelope;
      } catch (error) {
        set((state) => {
          const current = state.sections[section];
          if (current.requestId !== requestId) return state;
          return {
            sections: {
              ...state.sections,
              [section]: { ...current, loading: false, error: errorMessage(error) },
            },
          };
        });
        throw error;
      } finally {
        if (inFlightLoads.get(section) === request) inFlightLoads.delete(section);
      }
    },

    saveSection: async (section, data, expectedRevision) => {
      const snapshot = get().sections[section];
      const revision = expectedRevision ?? snapshot.envelope?.revision;
      if (revision === undefined) {
        throw new Error(`Load ${section} before saving it.`);
      }
      const mutationSequence = beginMutation(section);
      try {
        const envelope = await configSectionsService.putSection(section, revision, data);
        set((state) => {
          const current = state.sections[section];
          const adoptedEnvelope =
            (current.envelope?.revision ?? -1) > envelope.revision ? current.envelope : envelope;
          const latestMutation = isLatestMutation(section, mutationSequence);
          return {
            sections: {
              ...state.sections,
              [section]: {
                ...current,
                envelope: adoptedEnvelope,
                loading: false,
                error: latestMutation ? null : current.error,
                conflict: latestMutation ? null : current.conflict,
              },
            },
          };
        });
        const adopted = get().sections[section].envelope;
        return adopted && adopted.revision > envelope.revision ? adopted : envelope;
      } catch (error) {
        const conflict = error instanceof ConfigConflictError ? error.conflict : null;
        if (!isLatestMutation(section, mutationSequence)) throw error;
        set((state) => ({
          sections: {
            ...state.sections,
            [section]: {
              ...state.sections[section],
              error: errorMessage(error),
              conflict,
            },
          },
        }));
        throw error;
      }
    },

    saveMcpSettings: async (data, credentialChanges = {}, expectedRevision) => {
      const section = "mcp" as const;
      const snapshot = get().sections[section];
      const revision = expectedRevision ?? snapshot.envelope?.revision;
      if (revision === undefined) throw new Error("Load mcp before saving it.");
      const mutationSequence = beginMutation(section);
      try {
        const envelope = await configSectionsService.putMcpSettings(
          revision,
          data,
          credentialChanges,
        );
        set((state) => {
          const current = state.sections[section];
          const adoptedEnvelope =
            (current.envelope?.revision ?? -1) > envelope.revision ? current.envelope : envelope;
          return {
            sections: {
              ...state.sections,
              [section]: {
                ...current,
                envelope: adoptedEnvelope,
                loading: false,
                error: isLatestMutation(section, mutationSequence) ? null : current.error,
                conflict: isLatestMutation(section, mutationSequence) ? null : current.conflict,
              },
            },
          };
        });
        const adopted = get().sections[section]
          .envelope as ConfigSectionEnvelope<McpSection> | null;
        return adopted && adopted.revision > envelope.revision ? adopted : envelope;
      } catch (error) {
        const conflict = error instanceof ConfigConflictError ? error.conflict : null;
        if (!isLatestMutation(section, mutationSequence)) throw error;
        set((state) => ({
          sections: {
            ...state.sections,
            [section]: {
              ...state.sections[section],
              error: errorMessage(error),
              conflict,
            },
          },
        }));
        throw error;
      }
    },

    saveProviderSettings: async (data, credentialChanges = {}, expectedRevision) => {
      const section = "providers" as const;
      const snapshot = get().sections[section];
      const revision = expectedRevision ?? snapshot.envelope?.revision;
      if (revision === undefined) throw new Error("Load providers before saving them.");
      const mutationSequence = beginMutation(section);
      try {
        const envelope = await configSectionsService.putProviderSettings(
          revision,
          data,
          credentialChanges,
        );
        set((state) => {
          const current = state.sections[section];
          const adoptedEnvelope =
            (current.envelope?.revision ?? -1) > envelope.revision ? current.envelope : envelope;
          const latestMutation = isLatestMutation(section, mutationSequence);
          return {
            sections: {
              ...state.sections,
              [section]: {
                ...current,
                envelope: adoptedEnvelope,
                loading: false,
                error: latestMutation ? null : current.error,
                conflict: latestMutation ? null : current.conflict,
              },
            },
          };
        });
        const adopted = get().sections[section]
          .envelope as ConfigSectionEnvelope<ProviderSection> | null;
        return adopted && adopted.revision > envelope.revision ? adopted : envelope;
      } catch (error) {
        const conflict = error instanceof ConfigConflictError ? error.conflict : null;
        if (!isLatestMutation(section, mutationSequence)) throw error;
        set((state) => ({
          sections: {
            ...state.sections,
            [section]: {
              ...state.sections[section],
              error: errorMessage(error),
              conflict,
            },
          },
        }));
        throw error;
      }
    },

    saveNotifications: async (data, expectedRevision) => {
      const section = "notifications" as const;
      const snapshot = get().sections[section];
      const revision = expectedRevision ?? snapshot.envelope?.revision;
      if (revision === undefined) throw new Error("Load notifications before saving them.");
      const mutationSequence = beginMutation(section);
      try {
        const envelope = await configSectionsService.putNotifications(revision, data);
        set((state) => {
          const current = state.sections[section];
          const adoptedEnvelope =
            (current.envelope?.revision ?? -1) > envelope.revision ? current.envelope : envelope;
          const latestMutation = isLatestMutation(section, mutationSequence);
          return {
            sections: {
              ...state.sections,
              [section]: {
                ...current,
                envelope: adoptedEnvelope,
                loading: false,
                error: latestMutation ? null : current.error,
                conflict: latestMutation ? null : current.conflict,
              },
            },
          };
        });
        const adopted = get().sections[section].envelope as NotificationSectionEnvelope | null;
        return adopted && adopted.revision > envelope.revision ? adopted : envelope;
      } catch (error) {
        const conflict = error instanceof ConfigConflictError ? error.conflict : null;
        if (!isLatestMutation(section, mutationSequence)) throw error;
        set((state) => ({
          sections: {
            ...state.sections,
            [section]: { ...state.sections[section], error: errorMessage(error), conflict },
          },
        }));
        throw error;
      }
    },

    saveConnect: async (data, expectedRevision) => {
      const section = "connect" as const;
      const snapshot = get().sections[section];
      const revision = expectedRevision ?? snapshot.envelope?.revision;
      if (revision === undefined) throw new Error("Load connect before saving it.");
      const mutationSequence = beginMutation(section);
      try {
        const envelope = await configSectionsService.putConnect(revision, data);
        set((state) => {
          const current = state.sections[section];
          const adoptedEnvelope =
            (current.envelope?.revision ?? -1) > envelope.revision ? current.envelope : envelope;
          const latestMutation = isLatestMutation(section, mutationSequence);
          return {
            sections: {
              ...state.sections,
              [section]: {
                ...current,
                envelope: adoptedEnvelope,
                loading: false,
                error: latestMutation ? null : current.error,
                conflict: latestMutation ? null : current.conflict,
              },
            },
          };
        });
        const adopted = get().sections[section].envelope;
        return adopted && adopted.revision > envelope.revision ? adopted : envelope;
      } catch (error) {
        const conflict = error instanceof ConfigConflictError ? error.conflict : null;
        if (!isLatestMutation(section, mutationSequence)) throw error;
        set((state) => ({
          sections: {
            ...state.sections,
            [section]: { ...state.sections[section], error: errorMessage(error), conflict },
          },
        }));
        throw error;
      }
    },

    saveEnvVar: (data, expectedRevision) =>
      commitEnvMutation(expectedRevision, (revision) =>
        configSectionsService.upsertEnvVar(revision, data),
      ),

    deleteEnvVar: (name, expectedRevision) =>
      commitEnvMutation(expectedRevision, (revision) =>
        configSectionsService.deleteEnvVar(name, revision),
      ),

    loadAccessRuntimeStatus: async (options) => {
      const cached = get().accessRuntimeStatus;
      if (cached && !options?.force) return cached;
      if (accessRuntimeLoad && !options?.force) return accessRuntimeLoad;

      const requestSequence = ++accessRuntimeRequestSequence;
      const requestGeneration = accessRuntimeGeneration;
      set({ accessRuntimeLoading: true, accessRuntimeError: null });
      const request = configSectionsService.getAccessRuntimeStatus();
      accessRuntimeLoad = request;
      try {
        const status = await request;
        if (requestGeneration === accessRuntimeGeneration) {
          set((state) => {
            const current = state.accessRuntimeStatus;
            const accessRuntimeStatus =
              current === null || status.revision >= current.revision ? status : current;
            const isLatestRequest = requestSequence === accessRuntimeRequestSequence;
            return {
              accessRuntimeStatus,
              accessRuntimeLoading: isLatestRequest ? false : state.accessRuntimeLoading,
              accessRuntimeError: isLatestRequest ? null : state.accessRuntimeError,
            };
          });
        }
        return get().accessRuntimeStatus ?? status;
      } catch (error) {
        if (requestSequence === accessRuntimeRequestSequence) {
          set({ accessRuntimeLoading: false, accessRuntimeError: errorMessage(error) });
        }
        throw error;
      } finally {
        if (accessRuntimeLoad === request) accessRuntimeLoad = null;
      }
    },

    replaceAccessPassword: (data, expectedRevision) =>
      commitAccessMutation(expectedRevision, (revision) =>
        configSectionsService.replaceAccessPassword(revision, data),
      ),

    clearAccessPassword: (data, expectedRevision) =>
      commitAccessMutation(expectedRevision, (revision) =>
        configSectionsService.clearAccessPassword(revision, data),
      ),

    saveClusterNode: (nodeId, data, expectedRevision) =>
      commitClusterMutation(expectedRevision, (revision) =>
        nodeId
          ? configSectionsService.updateClusterNode(nodeId, revision, data)
          : configSectionsService.createClusterNode(revision, data),
      ),

    deleteClusterNode: (nodeId, expectedRevision) =>
      commitClusterMutation(expectedRevision, (revision) =>
        configSectionsService.deleteClusterNode(nodeId, revision),
      ),

    saveCluster: (currentName, data, expectedRevision) =>
      commitClusterMutation(expectedRevision, (revision) =>
        currentName
          ? configSectionsService.updateCluster(currentName, revision, data)
          : configSectionsService.createCluster(revision, data),
      ),

    deleteCluster: (name, expectedRevision) =>
      commitClusterMutation(expectedRevision, (revision) =>
        configSectionsService.deleteCluster(name, revision),
      ),

    runClusterNodeAction: (nodeId, action, expectedRevision) =>
      commitClusterMutation(expectedRevision, (revision) =>
        configSectionsService.runClusterNodeAction(nodeId, action, revision),
      ),

    resetSection: async (section, expectedRevision) => {
      const snapshot = get().sections[section];
      const revision = expectedRevision ?? snapshot.envelope?.revision;
      if (revision === undefined) throw new Error(`Load ${section} before resetting it.`);
      const mutationSequence = beginMutation(section);

      set((state) => ({
        sections: {
          ...state.sections,
          [section]: { ...state.sections[section], loading: true, error: null, conflict: null },
        },
      }));
      try {
        const envelope = await configSectionsService.resetSection(section, revision);
        set((state) => {
          const current = state.sections[section];
          const adoptedEnvelope =
            (current.envelope?.revision ?? -1) > envelope.revision ? current.envelope : envelope;
          const latestMutation = isLatestMutation(section, mutationSequence);
          return {
            sections: {
              ...state.sections,
              [section]: {
                ...current,
                envelope: adoptedEnvelope,
                loading: false,
                error: latestMutation ? null : current.error,
                conflict: latestMutation ? null : current.conflict,
              },
            },
          };
        });
        const adopted = get().sections[section].envelope;
        return adopted && adopted.revision > envelope.revision ? adopted : envelope;
      } catch (error) {
        const conflict = error instanceof ConfigConflictError ? error.conflict : null;
        if (!isLatestMutation(section, mutationSequence)) throw error;
        set((state) => ({
          sections: {
            ...state.sections,
            [section]: {
              ...state.sections[section],
              loading: false,
              error: errorMessage(error),
              conflict,
            },
          },
        }));
        throw error;
      }
    },

    loadProxyAuthStatus: async (options) => {
      const cached = get().proxyAuthStatus;
      if (cached && !options?.force) return cached;
      if (proxyAuthLoad && !options?.force) return proxyAuthLoad;

      set({ proxyAuthLoading: true, proxyAuthError: null });
      const request = configSectionsService.getProxyAuthStatus();
      proxyAuthLoad = request;
      try {
        const status = await request;
        set((state) => {
          const adopted =
            (state.proxyAuthStatus?.revision ?? -1) > status.revision
              ? state.proxyAuthStatus
              : status;
          const core = state.sections.core;
          const adoptedCore =
            (core.envelope?.revision ?? -1) > status.section.revision
              ? core.envelope
              : status.section;
          return {
            proxyAuthStatus: adopted,
            proxyAuthLoading: false,
            proxyAuthError: null,
            sections: {
              ...state.sections,
              core: { ...core, envelope: adoptedCore, error: null },
            },
          };
        });
        const adopted = get().proxyAuthStatus;
        return adopted && adopted.revision > status.revision ? adopted : status;
      } catch (error) {
        set({ proxyAuthLoading: false, proxyAuthError: errorMessage(error) });
        throw error;
      } finally {
        if (proxyAuthLoad === request) proxyAuthLoad = null;
      }
    },

    replaceProxyAuth: async (auth, expectedRevision) => {
      const revision = expectedRevision ?? (await get().loadProxyAuthStatus()).revision;
      const mutationSequence = beginMutation("core");
      try {
        const status = await configSectionsService.replaceProxyAuth(revision, auth);
        set((state) => {
          const core = state.sections.core;
          return {
            proxyAuthStatus:
              (state.proxyAuthStatus?.revision ?? -1) > status.revision
                ? state.proxyAuthStatus
                : status,
            proxyAuthError: isLatestMutation("core", mutationSequence)
              ? null
              : state.proxyAuthError,
            sections: {
              ...state.sections,
              core: {
                ...core,
                envelope:
                  (core.envelope?.revision ?? -1) > status.section.revision
                    ? core.envelope
                    : status.section,
              },
            },
          };
        });
        const adopted = get().proxyAuthStatus;
        return adopted && adopted.revision > status.revision ? adopted : status;
      } catch (error) {
        if (!isLatestMutation("core", mutationSequence)) throw error;
        set({ proxyAuthError: errorMessage(error) });
        throw error;
      }
    },

    clearProxyAuth: async (expectedRevision) => {
      const revision = expectedRevision ?? (await get().loadProxyAuthStatus()).revision;
      const mutationSequence = beginMutation("core");
      try {
        const status = await configSectionsService.clearProxyAuth(revision);
        set((state) => {
          const core = state.sections.core;
          return {
            proxyAuthStatus:
              (state.proxyAuthStatus?.revision ?? -1) > status.revision
                ? state.proxyAuthStatus
                : status,
            proxyAuthError: isLatestMutation("core", mutationSequence)
              ? null
              : state.proxyAuthError,
            sections: {
              ...state.sections,
              core: {
                ...core,
                envelope:
                  (core.envelope?.revision ?? -1) > status.section.revision
                    ? core.envelope
                    : status.section,
              },
            },
          };
        });
        const adopted = get().proxyAuthStatus;
        return adopted && adopted.revision > status.revision ? adopted : status;
      } catch (error) {
        if (!isLatestMutation("core", mutationSequence)) throw error;
        set({ proxyAuthError: errorMessage(error) });
        throw error;
      }
    },

    handleConfigEvent: (rawSection, revision, eventType) => {
      if (!isSectionId(rawSection)) return;
      const section = rawSection;
      if ((section === "core" || section === "credentials") && get().proxyAuthStatus) {
        void get()
          .loadProxyAuthStatus({ force: true })
          .catch(() => undefined);
      }
      if (
        (section === "access-control" || section === "credentials") &&
        get().accessRuntimeStatus
      ) {
        void get()
          .loadAccessRuntimeStatus({ force: true })
          .catch(() => undefined);
      }
      const snapshot = get().sections[section];
      const status = unhealthyStatusFor(eventType);
      if (status && snapshot.envelope) {
        set((state) => ({
          sections: {
            ...state.sections,
            [section]: {
              ...state.sections[section],
              envelope: {
                ...state.sections[section].envelope!,
                status,
              },
            },
          },
        }));
      }
      if (!snapshot.envelope && !inFlightLoads.has(section)) return;
      pendingEventRevisions.set(
        section,
        Math.max(revision, pendingEventRevisions.get(section) ?? -1),
      );
      scheduleEventConvergence(section);
    },

    resyncLoadedSections: async () => {
      const loaded = CONFIG_SECTION_IDS.filter((section) =>
        Boolean(get().sections[section].envelope),
      );
      const targets: Array<{ label: string; refresh: () => Promise<unknown> }> = loaded.map(
        (section) => ({
          label: section,
          refresh: () => get().loadSection(section, { force: true }),
        }),
      );
      if (get().proxyAuthStatus) {
        targets.push({
          label: "proxy-auth",
          refresh: () => get().loadProxyAuthStatus({ force: true }),
        });
      }
      if (get().accessRuntimeStatus) {
        targets.push({
          label: "access-runtime",
          refresh: () => get().loadAccessRuntimeStatus({ force: true }),
        });
      }

      const results = await Promise.allSettled(targets.map(({ refresh }) => refresh()));
      const failedTargets = results.flatMap((result, index) =>
        result.status === "rejected" ? [targets[index].label] : [],
      );
      if (failedTargets.length > 0) {
        throw new Error(`Failed to resync configuration state: ${failedTargets.join(", ")}`);
      }
    },

    clearConflict: (section) =>
      set((state) => ({
        sections: {
          ...state.sections,
          [section]: { ...state.sections[section], conflict: null },
        },
      })),

    reset: () => {
      for (const timer of eventTimers.values()) clearTimeout(timer);
      eventTimers.clear();
      pendingEventRevisions.clear();
      mutationSequences.clear();
      inFlightLoads.clear();
      proxyAuthLoad = null;
      accessRuntimeLoad = null;
      accessRuntimeRequestSequence += 1;
      accessRuntimeGeneration += 1;
      set({
        sections: createInitialSections(),
        proxyAuthStatus: null,
        proxyAuthLoading: false,
        proxyAuthError: null,
        accessRuntimeStatus: null,
        accessRuntimeLoading: false,
        accessRuntimeError: null,
      });
    },
  };
});
