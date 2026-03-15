# Prompt System Alignment Plan (No-Drift Refactor Prep)

## Scope

This document captures:

1. Which findings are **confirmed issues** in the current codebase.
2. Which findings are **not bugs** (or are design tradeoffs).
3. A **phased refactor plan** that preserves current behavior while reducing long-term complexity.

All conclusions below are based on current `lotus` + `bamboo` implementation.

## Verified Findings and Decisions

| Item | Verdict | Reasoning | Action |
|---|---|---|---|
| `BambooConfigService` returned empty presets | Confirmed bug | Frontend ignored backend prompt settings due hardcoded empty return | Fixed |
| Marker-based stripping could delete user prompt content | Confirmed bug | Header-based truncation could collide with user-authored text | Fixed via explicit generated block markers |
| UI "View Enhanced" may differ from actual runtime prompt | Partially valid | Runtime truth is backend persisted system message; frontend previously showed local composition only | Mitigated: prefer persisted backend system message when available |
| Session `model` recorded as `"unknown"` | Confirmed bug | Session creation always sent `model: undefined` | Fixed (propagate active provider model when available) |
| `SystemPromptService.getEnhancedSystemPrompt` duplicate request in `catch` | Confirmed bug | Catch path retried the same failing call | Fixed |
| Read-before-write/edit rule not visible in tool descriptions | Confirmed UX bug | Enforcement existed in runtime, but tool descriptions were too weak and increased failure risk | Fixed (Read/Write/Edit descriptions updated) |
| `WebFetch` description implied extra model processing by `prompt` | Confirmed UX bug | `prompt` is metadata context, not an internal summarization model input | Fixed (description + schema description clarified) |
| Tool guide coverage "missing 12 of 28 tools" | Needs nuance | Builtin guide list is explicitly scoped to current exposed builtin surface (`BUILTIN_GUIDE_NAMES`) | No immediate change |
| `/v1/agent/system-prompt` vs `/api/v1/chat` source split | Architectural misalignment (not immediate bug) | One path is global settings file; runtime path is session-scoped prompt state | Refactor recommended (phased) |

## Current Design: What Is Reasonable

1. Session-scoped base prompt (`metadata.base_system_prompt`) is the right runtime source of truth.
2. Per-round dynamic injection (external memory + todo) is reasonable and now safer with explicit markers.
3. Rebuilding system message on send keeps tool guidance and runtime context fresh after backend upgrades.

## Current Design: What Is Not Reasonable Long-Term

1. Two mental models for prompt ownership:
   - Global prompt file (`/v1/agent/system-prompt`)
   - Session runtime prompt (`/api/v1` flow)
2. Frontend still keeps custom prompt variants in `localStorage`, making cross-device consistency difficult.
3. No dedicated backend endpoint for "effective prompt snapshot" (base + enhancement + runtime sections), so UI/debug paths still need fallback heuristics.

## Phased Refactor Plan (Non-Breaking First)

## Phase 1: Runtime Prompt Observability (No behavior change)

Add backend read API for current effective system prompt of a session:

- `GET /api/v1/sessions/{id}/system-prompt`
- Response contains:
  - `base_system_prompt`
  - `enhancement_prompt`
  - `workspace_context`
  - `skill_context`
  - `tool_guide_context`
  - `external_memory`
  - `todo_list`
  - `effective_system_prompt`

Frontend "View Enhanced" should always prefer this API when available.

## Phase 2: Unify Prompt Source Ownership

Introduce backend-managed prompt presets API (single source of truth), then migrate frontend prompt CRUD from localStorage to backend:

- `GET /api/v1/prompt-presets`
- `POST /api/v1/prompt-presets`
- `PATCH /api/v1/prompt-presets/{id}`
- `DELETE /api/v1/prompt-presets/{id}`

Keep localStorage as temporary cache only during migration window.

## Phase 3: Clarify Global vs Session Prompt Semantics

Reframe `/v1/agent/system-prompt` as "global default template" only:

- New sessions default from this template when explicit base prompt is missing.
- Existing sessions remain immutable unless user explicitly changes session prompt.

This keeps deterministic replay for old sessions while preserving admin-level defaults.

## Phase 4: Cleanup and Deprecation

1. Remove legacy fallback logic that synthesizes enhanced prompt purely on frontend.
2. Remove redundant prompt keys from localStorage after migration.
3. Keep backward-compatible marker stripping for one release cycle, then remove legacy marker handling.

## Rollout Guardrails

1. Do not change execution semantics while introducing observability endpoints.
2. Migrate read paths first, then write paths.
3. Ship compatibility adapters before deleting legacy code paths.
4. Add integration tests for:
   - session creation with explicit/implicit base prompt
   - prompt rebuild after enhancement/workspace change
   - parity between displayed and actual effective system prompt
