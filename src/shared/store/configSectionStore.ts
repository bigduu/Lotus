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
  saveSection: <K extends Exclude<WritableConfigSectionId, "notifications" | "providers">>(
    section: K,
    data: ConfigSectionDataMap[K],
    expectedRevision?: number,
  ) => Promise<ConfigSectionEnvelope<ConfigSectionDataMap[K]>>;
  saveProviderSettings: (
    data: ProviderSection,
    credentialChanges?: ProviderCredentialChanges,
    expectedRevision?: number,
  ) => Promise<ConfigSectionEnvelope<ProviderSection>>;
  saveNotifications: (
    data: NotificationSectionDraft,
    expectedRevision?: number,
  ) => Promise<ConfigSectionEnvelope<ConfigSectionDataMap["notifications"]>>;
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
  replaceProxyAuth: (auth: { username: string; password: string }) => Promise<ProxyAuthStatus>;
  clearProxyAuth: () => Promise<ProxyAuthStatus>;
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
const CONFIG_EVENT_DEBOUNCE_MS = 80;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unable to load configuration";

const isSectionId = (value: string): value is ConfigSectionId =>
  (CONFIG_SECTION_IDS as readonly string[]).includes(value);

const unhealthyStatusFor = (
  eventType: "config.invalid" | "config.changed" | "config.recovered",
): ConfigSectionStatus | null => (eventType === "config.invalid" ? "invalid" : null);

export const useConfigSectionStore = create<ConfigSectionStoreState>((set, get) => ({
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
    try {
      const envelope = await configSectionsService.putSection(section, revision, data);
      set((state) => ({
        sections: {
          ...state.sections,
          [section]: {
            ...state.sections[section],
            envelope,
            loading: false,
            error: null,
            conflict: null,
          },
        },
      }));
      return envelope;
    } catch (error) {
      const conflict = error instanceof ConfigConflictError ? error.conflict : null;
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
    try {
      const envelope = await configSectionsService.putProviderSettings(
        revision,
        data,
        credentialChanges,
      );
      set((state) => ({
        sections: {
          ...state.sections,
          [section]: {
            ...state.sections[section],
            envelope,
            loading: false,
            error: null,
            conflict: null,
          },
        },
      }));
      return envelope;
    } catch (error) {
      const conflict = error instanceof ConfigConflictError ? error.conflict : null;
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
    try {
      const envelope = await configSectionsService.putNotifications(revision, data);
      set((state) => ({
        sections: {
          ...state.sections,
          [section]: {
            ...state.sections[section],
            envelope,
            loading: false,
            error: null,
            conflict: null,
          },
        },
      }));
      return envelope;
    } catch (error) {
      const conflict = error instanceof ConfigConflictError ? error.conflict : null;
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
    try {
      const result = await configSectionsService.putConnect(expectedCredentialRevision, data);
      set((state) => ({
        sections: {
          ...state.sections,
          [section]: {
            ...state.sections[section],
            envelope: result.envelope,
            loading: false,
            error: null,
            conflict: null,
          },
        },
      }));
      return result;
    } catch (error) {
      const conflict = error instanceof ConfigConflictError ? error.conflict : null;
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

    set((state) => ({
      sections: {
        ...state.sections,
        [section]: { ...state.sections[section], loading: true, error: null, conflict: null },
      },
    }));
    try {
      const envelope = await configSectionsService.resetSection(section, revision);
      set((state) => ({
        sections: {
          ...state.sections,
          [section]: {
            ...state.sections[section],
            envelope,
            loading: false,
            error: null,
            conflict: null,
          },
        },
      }));
      return envelope;
    } catch (error) {
      const conflict = error instanceof ConfigConflictError ? error.conflict : null;
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
      set({ proxyAuthStatus: status, proxyAuthLoading: false, proxyAuthError: null });
      return status;
    } catch (error) {
      set({ proxyAuthLoading: false, proxyAuthError: errorMessage(error) });
      throw error;
    } finally {
      proxyAuthLoad = null;
    }
  },

  replaceProxyAuth: async (auth) => {
    const current = await get().loadProxyAuthStatus();
    try {
      const status = await configSectionsService.replaceProxyAuth(current.revision, auth);
      set({ proxyAuthStatus: status, proxyAuthError: null });
      return status;
    } catch (error) {
      set({ proxyAuthError: errorMessage(error) });
      throw error;
    }
  },

  clearProxyAuth: async () => {
    const current = await get().loadProxyAuthStatus();
    try {
      const status = await configSectionsService.clearProxyAuth(current.revision);
      set({ proxyAuthStatus: status, proxyAuthError: null });
      return status;
    } catch (error) {
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
    if (!snapshot.envelope) return;
    pendingEventRevisions.set(
      section,
      Math.max(revision, pendingEventRevisions.get(section) ?? -1),
    );
    if (eventTimers.has(section)) return;
    eventTimers.set(
      section,
      setTimeout(() => {
        eventTimers.delete(section);
        const targetRevision = pendingEventRevisions.get(section) ?? revision;
        pendingEventRevisions.delete(section);
        const currentRevision = get().sections[section].envelope?.revision ?? -1;
        if (eventType === "config.invalid" || targetRevision >= currentRevision) {
          void get()
            .loadSection(section, { force: true })
            .catch(() => undefined);
        }
      }, CONFIG_EVENT_DEBOUNCE_MS),
    );
  },

  resyncLoadedSections: async () => {
    const loaded = CONFIG_SECTION_IDS.filter((section) =>
      Boolean(get().sections[section].envelope),
    );
    await Promise.allSettled(loaded.map((section) => get().loadSection(section, { force: true })));
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
    inFlightLoads.clear();
    proxyAuthLoad = null;
    set({
      sections: createInitialSections(),
      proxyAuthStatus: null,
      proxyAuthLoading: false,
      proxyAuthError: null,
    });
  },
}));
