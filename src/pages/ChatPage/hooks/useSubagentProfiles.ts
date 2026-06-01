/**
 * `useSubagentProfiles` — fetches the subagent profile catalogue once on mount.
 *
 * Used by:
 *   - SubAgent role pickers (selecting `subagent_type` before creating a child).
 *   - SubAgentsPanel role tags (resolving an id to its display_name / icon).
 *
 * The list rarely changes during a session (it's loaded from disk on backend
 * boot), so this hook performs a single GET on mount and caches the payload
 * in component state. Callers may pass `refreshKey` to force a re-fetch.
 *
 * NOTE: lotus does not use react-query; we follow the existing
 * `useEffect` + `useState` convention seen elsewhere in `src/hooks/`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  subagentProfileService,
  type SubagentProfile,
  type SubagentProfileListResponse,
} from "@services/subagent";

export interface UseSubagentProfilesOptions {
  /**
   * If false, the hook will NOT auto-fetch on mount. Defaults to true.
   * Useful when the picker is rendered eagerly but data should only load
   * when a panel becomes visible.
   */
  enabled?: boolean;
  /**
   * Bump this value to force a re-fetch (e.g. after a profiles file edit).
   */
  refreshKey?: number | string;
}

export interface UseSubagentProfilesResult {
  /** All profiles in registry order, or `[]` until the first response arrives. */
  profiles: SubagentProfile[];
  /** Profile id used by the backend when an unknown subagent_type is requested. */
  fallbackId: string | null;
  /** True while the initial fetch (or any explicit refresh) is in-flight. */
  loading: boolean;
  /** Last fetch error; cleared on next successful fetch. */
  error: Error | null;
  /** Imperatively re-fetch the catalogue (e.g. from an "Edit profiles" save flow). */
  refresh: () => Promise<void>;
  /** O(1) helper: `byId.get("researcher")` -> SubagentProfile or undefined. */
  byId: Map<string, SubagentProfile>;
}

const EMPTY_PROFILES: SubagentProfile[] = [];

export function useSubagentProfiles(
  options: UseSubagentProfilesOptions = {},
): UseSubagentProfilesResult {
  const { enabled = true, refreshKey } = options;

  const [data, setData] = useState<SubagentProfileListResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchProfiles = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await subagentProfileService.listProfiles();
      setData(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void fetchProfiles();
    // refreshKey is intentionally part of the dep list so consumers can force refetch.
  }, [enabled, fetchProfiles, refreshKey]);

  const byId = useMemo(() => {
    const map = new Map<string, SubagentProfile>();
    if (data?.profiles) {
      for (const p of data.profiles) {
        map.set(p.id, p);
      }
    }
    return map;
  }, [data]);

  return {
    profiles: data?.profiles ?? EMPTY_PROFILES,
    fallbackId: data?.fallback_id ?? null,
    loading,
    error,
    refresh: fetchProfiles,
    byId,
  };
}
