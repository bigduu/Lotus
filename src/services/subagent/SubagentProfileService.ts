/**
 * Subagent Profile Service
 *
 * Fetches the catalogue of available subagent profiles (roles) from the
 * Bamboo backend so the UI can offer a role picker and render role tags.
 *
 * Backend route: `GET /v1/subagent_profiles`
 * (the `apiClient` already prepends `/v1`, so the path passed in is bare).
 */
import { apiClient } from "../api";
import type { SubagentProfileListResponse } from "./types";

/**
 * Service for reading the subagent profile registry.
 */
export class SubagentProfileService {
  /**
   * Fetch all available subagent profiles.
   *
   * Returns the full registry payload including `fallback_id` and `count`,
   * letting callers (e.g. a role picker) render a "default" indicator
   * without a second round-trip.
   */
  async listProfiles(): Promise<SubagentProfileListResponse> {
    return apiClient.get<SubagentProfileListResponse>("subagent_profiles");
  }
}

// Singleton (matches the `skillService` / `apiClient` pattern used elsewhere).
export const subagentProfileService = new SubagentProfileService();
