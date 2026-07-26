import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ConfigSectionDataMap,
  ConfigSectionEnvelope,
  ConfigSectionId,
} from "@services/config/configSections";
import { useConfigSectionStore } from "@shared/store/configSectionStore";

type DraftUpdater<T> = T | ((current: T) => T);

export interface ConfigDraftComparison<T> {
  base: T;
  draft: T;
  latest: T;
  baseRevision: number;
  latestRevision: number;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isDeepEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => isDeepEqual(value, right[index]))
    );
  }
  if (!isObject(left) || !isObject(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) => Object.prototype.hasOwnProperty.call(right, key) && isDeepEqual(left[key], right[key]),
    )
  );
};

const reapplyChanges = (base: unknown, draft: unknown, latest: unknown): unknown => {
  if (isDeepEqual(base, draft)) return latest;
  if (!isObject(base) || !isObject(draft) || !isObject(latest)) return draft;
  const result: Record<string, unknown> = { ...latest };
  const keys = new Set([...Object.keys(base), ...Object.keys(draft)]);
  for (const key of keys) {
    if (!(key in draft)) {
      if (key in base) delete result[key];
      continue;
    }
    result[key] = reapplyChanges(base[key], draft[key], latest[key]);
  }
  return result;
};

export const reapplyConfigChanges = <T,>(base: T, draft: T, latest: T): T =>
  reapplyChanges(base, draft, latest) as T;

export interface UseConfigSectionDraftResult<K extends ConfigSectionId> {
  draft: ConfigSectionDataMap[K] | null;
  envelope: ConfigSectionEnvelope<ConfigSectionDataMap[K]> | null;
  loading: boolean;
  error: string | null;
  dirty: boolean;
  externalRevision: number | null;
  comparison: ConfigDraftComparison<ConfigSectionDataMap[K]> | null;
  setDraft: (updater: DraftUpdater<ConfigSectionDataMap[K]>) => void;
  markSaved: (envelope: ConfigSectionEnvelope<ConfigSectionDataMap[K]>) => void;
  reload: () => Promise<void>;
  reapply: () => void;
  discard: () => void;
}

export const useConfigSectionDraft = <K extends ConfigSectionId>(
  section: K,
): UseConfigSectionDraftResult<K> => {
  const snapshot = useConfigSectionStore((state) => state.sections[section]);
  const loadSection = useConfigSectionStore((state) => state.loadSection);
  const [draft, setDraftState] = useState<ConfigSectionDataMap[K] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [externalRevision, setExternalRevision] = useState<number | null>(null);
  const baseRef = useRef<ConfigSectionDataMap[K] | null>(null);
  const baseRevisionRef = useRef<number | null>(null);

  useEffect(() => {
    void loadSection(section).catch(() => undefined);
  }, [loadSection, section]);

  useEffect(() => {
    const envelope = snapshot.envelope as ConfigSectionEnvelope<ConfigSectionDataMap[K]> | null;
    if (!envelope) return;
    if (baseRevisionRef.current === null) {
      baseRef.current = envelope.data;
      baseRevisionRef.current = envelope.revision;
      setDraftState(envelope.data);
      setDirty(false);
      setExternalRevision(null);
      return;
    }
    if (envelope.revision === baseRevisionRef.current) return;
    if (dirty) {
      setExternalRevision(envelope.revision);
      return;
    }
    baseRef.current = envelope.data;
    baseRevisionRef.current = envelope.revision;
    setDraftState(envelope.data);
    setExternalRevision(null);
  }, [dirty, snapshot.envelope]);

  const setDraft = useCallback((updater: DraftUpdater<ConfigSectionDataMap[K]>) => {
    setDraftState((current) => {
      if (current === null) return current;
      return typeof updater === "function"
        ? (updater as (value: ConfigSectionDataMap[K]) => ConfigSectionDataMap[K])(current)
        : updater;
    });
    setDirty(true);
  }, []);

  const markSaved = useCallback((envelope: ConfigSectionEnvelope<ConfigSectionDataMap[K]>) => {
    baseRef.current = envelope.data;
    baseRevisionRef.current = envelope.revision;
    setDraftState(envelope.data);
    setDirty(false);
    setExternalRevision(null);
  }, []);

  const reload = useCallback(async () => {
    const envelope = await loadSection(section, { force: true });
    markSaved(envelope);
  }, [loadSection, markSaved, section]);

  const reapply = useCallback(() => {
    const envelope = snapshot.envelope as ConfigSectionEnvelope<ConfigSectionDataMap[K]> | null;
    if (!envelope || draft === null || baseRef.current === null) return;
    const rebased = reapplyConfigChanges(baseRef.current, draft, envelope.data);
    baseRef.current = envelope.data;
    baseRevisionRef.current = envelope.revision;
    setDraftState(rebased);
    setDirty(true);
    setExternalRevision(null);
  }, [draft, snapshot.envelope]);

  const discard = useCallback(() => {
    const envelope = snapshot.envelope as ConfigSectionEnvelope<ConfigSectionDataMap[K]> | null;
    if (!envelope) return;
    markSaved(envelope);
  }, [markSaved, snapshot.envelope]);

  const comparison = useMemo(() => {
    const envelope = snapshot.envelope as ConfigSectionEnvelope<ConfigSectionDataMap[K]> | null;
    if (
      externalRevision === null ||
      envelope === null ||
      draft === null ||
      baseRef.current === null ||
      baseRevisionRef.current === null
    ) {
      return null;
    }
    return {
      base: baseRef.current,
      draft,
      latest: envelope.data,
      baseRevision: baseRevisionRef.current,
      latestRevision: envelope.revision,
    };
  }, [draft, externalRevision, snapshot.envelope]);

  return {
    draft,
    envelope: snapshot.envelope as ConfigSectionEnvelope<ConfigSectionDataMap[K]> | null,
    loading: snapshot.loading,
    error: snapshot.error,
    dirty,
    externalRevision,
    comparison,
    setDraft,
    markSaved,
    reload,
    reapply,
    discard,
  };
};
