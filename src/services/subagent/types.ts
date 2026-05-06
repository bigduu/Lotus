/**
 * Subagent Profile types
 *
 * Mirrors the JSON shape returned by the Bamboo backend's
 * `GET /v1/subagent_profiles` endpoint and the
 * `SubAgent.action=list_profiles` tool action.
 *
 * Backend reference:
 *   crates/bamboo-server/src/handlers/subagent_profiles.rs
 *   crates/bamboo-server/src/tools/sub_agent.rs (list_profiles_payload)
 *
 * `system_prompt` is intentionally NOT exposed by either surface
 * (it can be lengthy and is not needed for role selection).
 */

/**
 * Tool policy that gates which tools a child session may invoke.
 * Matches `bamboo_domain::subagent::ToolPolicy` JSON discriminator.
 */
export type SubagentToolPolicy =
  | { mode: "inherit" }
  | { mode: "allowlist"; allow: string[] }
  | { mode: "denylist"; deny: string[] };

/**
 * Optional UI hint metadata for rendering a profile chip / picker entry.
 */
export interface SubagentProfileUiHints {
  /** A short emoji/icon to display next to the name. */
  icon?: string | null;
  /** A semantic colour name (e.g. "blue", "green"). UI is free to map. */
  color?: string | null;
}

/**
 * A single subagent profile (role) as exposed to the frontend.
 *
 * Note: `system_prompt` is omitted on purpose — see module docstring.
 */
export interface SubagentProfile {
  /** Stable identifier used as `subagent_type` when creating a child session. */
  id: string;
  /** Human-friendly name shown in the picker. */
  display_name: string;
  /** Short description shown in tooltips / help text. */
  description: string;
  /** Tool gating policy for child sessions assuming this role. */
  tools: SubagentToolPolicy;
  /** Optional model preference recorded by the profile (advisory). */
  model_hint?: string | null;
  /** Optional default `responsibility` string suggested for this role. */
  default_responsibility?: string | null;
  /** Optional UI hints (icon/color). */
  ui?: SubagentProfileUiHints | null;
}

/**
 * Response shape returned by `GET /v1/subagent_profiles`.
 */
export interface SubagentProfileListResponse {
  profiles: SubagentProfile[];
  /** Profile id to fall back to when an unknown `subagent_type` is requested. */
  fallback_id: string;
  /** Convenience count, matches `profiles.length`. */
  count: number;
}
