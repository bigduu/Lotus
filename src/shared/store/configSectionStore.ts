import { create } from "zustand";
import {
  CONFIG_SECTION_IDS,
  ConfigConflictError,
  configSectionsService,
  type ConfigRevisionConflict,
  type ConfigSectionDataMap,
  type ConfigSectionEnvelope,
  type ConfigSectionId,
  type ConfigSectionStatus,
  type ConnectSectionDraft,
  type McpCredentialChanges,
  type McpSection,
  type NotificationSectionEnvelope,
  type NotificationSectionDraft,
  type ProviderCredentialChanges,
  type ProviderSection,
  type ProxyAuthStatus,
  type WritableConfigSectionId,
} from "@services/config/configSections";

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
  loadSection: <K extends ConfigSectionId>(
    section: K,
    options?: { force?: boolean },
  ) => Promise<ConfigSectionEnvelope<ConfigSectionDataMap[K]>>;
  saveSection: <K extends Exclude<WritableConfigSectionId, "notifications" | "providers" | "mcp">>(
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
    expectedCredentialRevision: number,
  ) => Promise<{
    envelope: ConfigSectionEnvelope<ConfigSectionDataMap["connect"]>;
    credentialRevision: number;
  }>;
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
const eventTimers = new Map<ConfigSectionId, ReturnType<typeof setTimeout>>();
const pendingEventRevisions = new Map<ConfigSectionId, number>();
const mutationSequences = new Map<ConfigSectionId, number>();
const CONFIG_EVENT_DEBOUNCE_MS = 80;
const CONFIG_EVENT_RETRY_MS = 1_000;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unable to load configuration";

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

  return {
    sections: createInitialSections(),
    proxyAuthStatus: null,
    proxyAuthLoading: false,
    proxyAuthError: null,

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

    saveConnect: async (data, expectedCredentialRevision) => {
      const section = "connect" as const;
      const mutationSequence = beginMutation(section);
      try {
        const result = await configSectionsService.putConnect(expectedCredentialRevision, data);
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
            [section]: { ...state.sections[section], error: errorMessage(error), conflict },
          },
        }));
        throw error;
      }
    },

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
      if (proxyAuthLoad) return proxyAuthLoad;

      set({ proxyAuthLoading: true, proxyAuthError: null });
      proxyAuthLoad = configSectionsService.getProxyAuthStatus();
      try {
        const status = await proxyAuthLoad;
        set((state) => {
          const adopted =
            (state.proxyAuthStatus?.revision ?? -1) > status.revision
              ? state.proxyAuthStatus
              : status;
          return { proxyAuthStatus: adopted, proxyAuthLoading: false, proxyAuthError: null };
        });
        const adopted = get().proxyAuthStatus;
        return adopted && adopted.revision > status.revision ? adopted : status;
      } catch (error) {
        set({ proxyAuthLoading: false, proxyAuthError: errorMessage(error) });
        throw error;
      } finally {
        proxyAuthLoad = null;
      }
    },

    replaceProxyAuth: async (auth, expectedRevision) => {
      const revision = expectedRevision ?? (await get().loadProxyAuthStatus()).revision;
      const mutationSequence = beginMutation("credentials");
      try {
        const status = await configSectionsService.replaceProxyAuth(revision, auth);
        set((state) => ({
          proxyAuthStatus:
            (state.proxyAuthStatus?.revision ?? -1) > status.revision
              ? state.proxyAuthStatus
              : status,
          proxyAuthError: isLatestMutation("credentials", mutationSequence)
            ? null
            : state.proxyAuthError,
        }));
        const adopted = get().proxyAuthStatus;
        return adopted && adopted.revision > status.revision ? adopted : status;
      } catch (error) {
        if (!isLatestMutation("credentials", mutationSequence)) throw error;
        set({ proxyAuthError: errorMessage(error) });
        throw error;
      }
    },

    clearProxyAuth: async (expectedRevision) => {
      const revision = expectedRevision ?? (await get().loadProxyAuthStatus()).revision;
      const mutationSequence = beginMutation("credentials");
      try {
        const status = await configSectionsService.clearProxyAuth(revision);
        set((state) => ({
          proxyAuthStatus:
            (state.proxyAuthStatus?.revision ?? -1) > status.revision
              ? state.proxyAuthStatus
              : status,
          proxyAuthError: isLatestMutation("credentials", mutationSequence)
            ? null
            : state.proxyAuthError,
        }));
        const adopted = get().proxyAuthStatus;
        return adopted && adopted.revision > status.revision ? adopted : status;
      } catch (error) {
        if (!isLatestMutation("credentials", mutationSequence)) throw error;
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
      const results = await Promise.allSettled(
        loaded.map((section) => get().loadSection(section, { force: true })),
      );
      const failedSections = results.flatMap((result, index) =>
        result.status === "rejected" ? [loaded[index]] : [],
      );
      if (failedSections.length > 0) {
        throw new Error(`Failed to resync configuration sections: ${failedSections.join(", ")}`);
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
      set({
        sections: createInitialSections(),
        proxyAuthStatus: null,
        proxyAuthLoading: false,
        proxyAuthError: null,
      });
    },
  };
});
