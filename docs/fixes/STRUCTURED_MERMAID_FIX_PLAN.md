# Structured Mermaid Fix Plan for Lotus + Bamboo

## Summary

This document describes the end-to-end repair plan for Lotus Mermaid auto-fix so it works not only for assistant text messages, but also for Mermaid diagrams rendered from structured tool results such as `conclusion_with_options` and other `tool_result` payloads.

Current behavior is inconsistent:
- Lotus shows the **Fix Mermaid** button anywhere a Mermaid block is rendered through the shared Markdown renderer.
- But the actual fix flow only supports `assistant` messages with `type === "text"`.
- Bamboo backend patch API also only supports patching assistant text messages without tool calls.

As a result, Mermaid diagrams rendered from `tool_result` content can display a fix button but fail at click time with:

> Mermaid fix is only available for assistant text messages

This document proposes a full-stack implementation plan to support structured Mermaid fixes safely and persistently.

---

## Problem statement

### User expectation

If Lotus renders a Mermaid diagram and shows a **Fix Mermaid** action after a parse/render failure, users expect the action to work regardless of whether the Mermaid originated from:
- a plain assistant text message
- the assistant text portion of a tool-call message
- a structured `tool_result`
- a formatted `conclusion_with_options` conclusion section

### Current failure modes

1. **Frontend eligibility mismatch**
   - Button visibility is driven by shared Markdown rendering.
   - Actual execution is gated by `useMessageCardMermaidFix`, which only accepts assistant text messages.

2. **Backend patch route is too narrow**
   - `PATCH /sessions/{session_id}/messages/{message_id}` currently only patches assistant messages with no tool calls.
   - Tool-result messages (`role = tool`) are rejected.

3. **Structured content loses source identity at render time**
   - Lotus formats certain tool results into Markdown for display.
   - Mermaid blocks rendered from that derived Markdown no longer carry enough source-location context to patch the original persisted payload safely.

4. **History mapping is lossy for tool results**
   - Lotus rebuilds `AssistantToolResultMessage` from backend history using `msg.content` as `result.result`.
   - `display_preference` is currently reconstructed as `"Default"` instead of being preserved from persisted tool payloads.

---

## Evidence from current implementation

### Lotus frontend

#### Fix handler only allows assistant text
- `src/pages/ChatPage/components/MessageCard/useMessageCardMermaidFix.ts`
- `isAssistantTextMessage()` requires `role === "assistant" && type === "text"`
- click path throws `Mermaid fix is only available for assistant text messages`

#### Shared Markdown renderer shows Fix button broadly
- `src/pages/ChatPage/components/MessageCard/index.tsx`
- `src/shared/components/Markdown/markdownComponents.tsx`
- `src/shared/components/Markdown/MarkdownCodeBlock.tsx`
- `src/shared/components/MermaidChart/index.tsx`
- `src/shared/components/MermaidChart/MermaidChartError.tsx`

#### Structured tool results render Mermaid via derived markdown
- `src/pages/ChatPage/components/MessageCard/MessageCardContent.tsx`
- `src/pages/ChatPage/components/MessageCard/InteractiveQuestionToolCard.tsx`
- `src/pages/ChatPage/utils/resultFormatters.ts`

#### History mapping splits assistant tool-call messages into derived text + tool_call messages
- `src/pages/ChatPage/store/slices/chatSessionSlice.ts`
- messages with `role = assistant` and `tool_calls` may produce:
  - synthetic `assistant text` UI message with id `${backendId}_text`
  - a `tool_call` UI message with id `backendId`

#### Tool results are mapped from backend `role = tool` to UI `type = tool_result`
- `src/pages/ChatPage/store/slices/chatSessionSlice.ts`
- backend `msg.content` becomes UI `toolResult.result.result`

### Bamboo backend

#### Patch route only supports assistant text messages without tool calls
- `src/server/routes/agent.rs`
- `src/server/handlers/agent/messages/patch.rs`

Current route behavior:
- loads target message by ID
- rejects if role is not `Assistant`
- rejects if message has any `tool_calls`
- only patches `message.content`

#### Tool results are persisted as `role = Tool`
- `src/agent/core/agent/types.rs`
- `Message::tool_result_with_status()` stores:
  - `role = Tool`
  - `content = tool result text`
  - `tool_call_id`
  - `tool_success`

#### Pending-question response flow updates tool-result messages directly
- `src/server/handlers/agent/respond/handlers/submit.rs`
- this code already mutates persisted `role = Tool` messages by locating them via `tool_call_id`
- therefore, Bamboo already has precedent for editing tool-result messages safely in targeted server flows

---

## High-level design goal

Add a **structured Mermaid fix capability** that can patch the correct persisted source for a rendered Mermaid block, regardless of whether the source is:

1. assistant final text message
2. assistant text segment derived from an assistant message that also contains tool calls
3. persisted tool-result message (`role = tool`)
4. structured JSON embedded inside a tool-result payload and rendered as derived Markdown

The fix must be:
- source-aware
- persistent
- refresh-safe
- replay-safe after `loadChatHistory`
- explicit about which message field is being patched

---

## Recommended architecture

### Key principle

Do **not** treat Mermaid fix as a generic “replace markdown snippet in currently rendered UI text” operation.

Instead, treat it as a **source-targeted patch**:

1. identify the persisted backend message
2. identify which logical field contains the Mermaid source
3. fix Mermaid using fast model
4. patch the original source field on the backend
5. reload or locally update frontend state from that authoritative result

---

## New abstraction: MermaidFixTarget

Introduce a typed frontend descriptor representing the persisted source of a rendered Mermaid block.

### Proposed TypeScript shape

```ts
export type MermaidFixTarget =
  | {
      kind: "assistant_text";
      sessionId: string;
      backendMessageId: string;
      uiMessageId: string;
      sourceField: "content";
      originalMessageContent: string;
    }
  | {
      kind: "tool_result_raw";
      sessionId: string;
      backendMessageId: string;
      uiMessageId: string;
      toolCallId?: string;
      sourceField: "content";
      originalMessageContent: string;
    }
  | {
      kind: "tool_result_json_path";
      sessionId: string;
      backendMessageId: string;
      uiMessageId: string;
      toolCallId?: string;
      sourceField: "content_json";
      jsonPath: string; // example: $.conclusion.mermaid.graph
      originalMessageContent: string;
    };
```

This becomes the contract between the rendered Mermaid block and the fix workflow.

---

## Frontend redesign

### 1. Pass source-aware fix context into Markdown renderer

Today `createMarkdownComponents()` accepts only:
- `onFixMermaid`

We should extend it to accept:

```ts
interface MermaidFixContext {
  target?: MermaidFixTarget;
}
```

or directly:

```ts
createMarkdownComponents(token, {
  mermaidFixTarget,
  onFixMermaid,
})
```

### 2. Mermaid renderer should call fix with target + chart + renderError

Change callback shape from:

```ts
(chart: string, renderError?: string) => Promise<void>
```

to:

```ts
(args: {
  chart: string;
  renderError?: string;
  target: MermaidFixTarget;
}) => Promise<void>
```

### 3. Produce different targets per rendering source

#### A. Standard assistant text message
When `MessageCard` renders normal assistant text markdown:
- build `MermaidFixTarget(kind = "assistant_text")`
- use backend message id when available via `metadata.backendMessageId`

#### B. Assistant text derived from assistant tool-call message
For `_text` synthetic messages created from assistant messages that also contain tool calls:
- continue to patch the original backend assistant message `content`
- target kind remains `assistant_text`
- backendMessageId must always be present in metadata, not inferred ad hoc

#### C. Tool result raw markdown
If a `tool_result` card ever renders raw markdown directly from `message.result.result`, build:
- `MermaidFixTarget(kind = "tool_result_raw")`

#### D. Structured markdown derived from parsed tool result JSON
For `conclusion_with_options` or future structured payload renderers:
- attach a precise JSON path target when formatting the structured payload into Markdown
- example for conclusion Mermaid:
  - `kind = "tool_result_json_path"`
  - `jsonPath = $.conclusion.mermaid.graph`

This is the crucial step that the current system lacks.

---

## Preserve source metadata through derived markdown

### Current issue

`formatConclusionWithOptionsConclusionAsMarkdown()` returns just a string.
That discards where the Mermaid came from.

### Proposed replacement

Instead of returning only Markdown, return a richer structure:

```ts
interface DerivedMarkdownBlock {
  markdown: string;
  mermaidTargets?: Array<{
    graph: string;
    jsonPath: string;
  }>;
}
```

Or more generally:

```ts
interface StructuredMarkdownRenderModel {
  markdown: string;
  mermaidSources: Array<{
    graph: string;
    target: MermaidFixTarget;
  }>;
}
```

The ReactMarkdown code renderer can then look up the rendered Mermaid block’s exact target by matching chart text to the known source list.

### Matching strategy

For each Mermaid code block encountered during render:
- normalize the chart text
- look up matching source descriptors
- if one unique match exists, attach that source target
- if multiple identical Mermaid graphs exist in the same markdown blob, include occurrence index information

Recommended robust shape:

```ts
interface MermaidSourceDescriptor {
  normalizedGraph: string;
  occurrenceIndex: number;
  target: MermaidFixTarget;
}
```

---

## Backend redesign

### Current backend API is insufficient

Current route:

`PATCH /sessions/{session_id}/messages/{message_id}`

Current request shape:

```json
{ "content": "..." }
```

This only supports replacing `message.content` for assistant text messages.

### Required backend capability

We need a **source-aware patch API**.

### Recommended new endpoint

Add a dedicated endpoint instead of overloading the current generic patch route.

#### New endpoint

`POST /api/v1/sessions/{session_id}/messages/{message_id}/fix-mermaid`

### Proposed request body

```json
{
  "chart": "graph TD\nA -->",
  "fixed_chart": "graph TD\nA --> B",
  "target": {
    "kind": "assistant_text",
    "source_field": "content"
  }
}
```

or for structured tool result:

```json
{
  "chart": "graph TD\nA -->",
  "fixed_chart": "graph TD\nA --> B",
  "target": {
    "kind": "tool_result_json_path",
    "source_field": "content_json",
    "json_path": "$.conclusion.mermaid.graph"
  }
}
```

### Why a dedicated endpoint is better

1. avoids making generic message patch semantics ambiguous
2. allows server-side validation specific to Mermaid/source patching
3. avoids accidental arbitrary mutation of tool-result payloads
4. allows future audit/logging if desired
5. keeps current `patch_message` route backward-compatible for plain text edits

---

## Backend server behavior for new endpoint

### Case 1: assistant_text target

1. load session
2. ensure session is not running
3. locate message by ID
4. validate role is `Assistant`
5. replace Mermaid block in `message.content`
6. save session
7. clear derived context state
8. return updated message summary

### Case 2: tool_result_raw target

1. load session
2. ensure session is not running
3. locate message by ID
4. validate role is `Tool`
5. replace Mermaid block in `message.content`
6. save session
7. return updated message summary

### Case 3: tool_result_json_path target

1. load session
2. ensure session is not running
3. locate message by ID
4. validate role is `Tool`
5. parse `message.content` as JSON object
6. validate requested `json_path` exists and is a string
7. validate current value matches the submitted original chart or normalized equivalent
8. replace the target field with fixed Mermaid graph text
9. reserialize JSON preserving stable formatting (canonical/minified is acceptable if UI already tolerates it)
10. save session
11. return updated message summary plus optionally normalized parsed payload

### Recommended validation rules

- reject empty `fixed_chart`
- reject non-string target field values
- reject unsupported target kinds
- reject JSON-path patch if current graph mismatch is too large, unless caller passes `allow_fallback_first_match`
- reject if session currently running

---

## Should the backend call the fast model?

### Recommendation: keep AI fix generation in Lotus frontend for now

You asked whether this fix is basically using a separate fast-model completion flow. Yes, currently Lotus does that itself.

Current flow:
- Lotus calls OpenAI-compatible completion using fast model
- gets corrected Mermaid
- then patches backend session message

This is acceptable to keep initially because:
1. model selection is already wired in Lotus (`useFastModel()`)
2. no Bamboo provider changes are required for phase 1
3. the main missing piece is safe persistence of structured sources

### Alternative future design
Move the entire Mermaid-fix generation into Bamboo as a tool or endpoint.

Pros:
- one source of truth
- backend can reuse session provider config directly
- easier auditability

Cons:
- larger scope
- introduces another backend execution path
- duplicates some provider/client logic already working in Lotus

### Final recommendation
**Phase 1:** keep AI generation in Lotus, add source-aware patch endpoint in Bamboo.

---

## Exact end-to-end flow after redesign

1. Mermaid render fails in Lotus.
2. Mermaid chart component receives:
   - chart text
   - render error
   - `MermaidFixTarget`
3. User clicks **Fix Mermaid**.
4. Lotus uses fast model to generate corrected Mermaid graph.
5. Lotus calls new Bamboo endpoint:
   - `POST /sessions/{session_id}/messages/{message_id}/fix-mermaid`
   - includes `fixed_chart` and structured target descriptor
6. Bamboo patches the correct persisted source:
   - assistant `content`
   - tool `content`
   - or JSON subfield inside tool `content`
7. Lotus updates local state optimistically if safe, then reloads history or reconciles returned content.
8. Mermaid rerenders successfully.
9. Page reload preserves the fix.

---

## Data model improvements recommended along the way

### 1. Preserve backend message IDs for all patchable UI messages

Today only some assistant text messages carry `metadata.backendMessageId`.

Recommendation:
- add a consistent optional `backendMessageId` field to all UI message variants
- not buried only in `metadata`
- especially for:
  - `AssistantTextMessage`
  - `AssistantToolResultMessage`
  - `AssistantToolCallMessage`

Example:

```ts
interface BaseMessage {
  id: string;
  backendMessageId?: string;
  createdAt: string;
  ...
}
```

### 2. Preserve tool-result display preference from backend history

Current mapping in `chatSessionSlice.ts` hardcodes:

```ts
display_preference: "Default"
```

This should instead come from persisted tool-result content or message metadata.

Recommended backend persistence change:
- when persisting tool results, also persist:
  - canonical tool name
  - display preference
- either in `message.metadata`
- or by storing canonical JSON payload in `message.content` consistently

### 3. Add message-origin metadata to derived markdown renderers

Derived markdown from structured results should retain source descriptors instead of becoming anonymous markdown text.

---

## API design options

### Option A: extend existing PATCH route

Request body could become:

```json
{
  "mode": "replace_mermaid",
  "content": "...",
  "target_kind": "tool_result_json_path",
  "json_path": "$.conclusion.mermaid.graph"
}
```

#### Pros
- no new route

#### Cons
- muddies semantics of a simple text patch route
- easier to misuse
- weaker discoverability and validation clarity

### Option B: add dedicated Mermaid-fix route

#### Pros
- explicit intent
- simpler validation rules
- safer future extension
- cleaner docs and tests

#### Cons
- one extra route

### Recommendation
**Option B** is strongly preferred.

---

## Frontend implementation blueprint

### Files to change in Lotus

#### Core flow
- `src/pages/ChatPage/components/MessageCard/useMessageCardMermaidFix.ts`
- `src/pages/ChatPage/components/MessageCard/index.tsx`
- `src/shared/components/Markdown/markdownComponents.tsx`
- `src/shared/components/Markdown/MarkdownCodeBlock.tsx`
- `src/shared/components/MermaidChart/index.tsx`

#### Structured rendering / source retention
- `src/pages/ChatPage/components/MessageCard/MessageCardContent.tsx`
- `src/pages/ChatPage/components/MessageCard/InteractiveQuestionToolCard.tsx`
- `src/pages/ChatPage/utils/resultFormatters.ts`

#### History mapping / message identity
- `src/pages/ChatPage/store/slices/chatSessionSlice.ts`
- `src/pages/ChatPage/types/chatMessages.ts`
- `src/services/chat/AgentService.ts`

### New frontend service additions

Add a dedicated API client method:

```ts
async fixSessionMessageMermaid(
  sessionId: string,
  messageId: string,
  req: FixSessionMessageMermaidRequest,
): Promise<FixSessionMessageMermaidResponse>
```

### Frontend local update strategy

Recommended:
- optimistic update only for assistant_text target if replacement is deterministic
- for `tool_result_json_path`, prefer reloading the session or using response payload from backend

Reason:
- derived markdown for structured payloads should be regenerated from authoritative persisted JSON

---

## Backend implementation blueprint

### Files to change in Bamboo

#### Routes
- `src/server/routes/agent.rs`

#### Handlers
- add `src/server/handlers/agent/messages/fix_mermaid.rs`
- update `src/server/handlers/agent/messages/mod.rs`
- update `src/server/handlers/agent/messages/types.rs`

#### Session/message utilities
- shared message lookup helpers under `src/server/handlers/agent/messages/shared.rs`

#### Optional persistence/schema improvement
- `src/agent/core/agent/types.rs`
- anywhere tool-result metadata is serialized from tool completion flow

### Proposed Rust request type

```rust
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MermaidFixTarget {
    AssistantText { source_field: String },
    ToolResultRaw { source_field: String },
    ToolResultJsonPath { source_field: String, json_path: String },
}

#[derive(Debug, Deserialize)]
pub struct FixMermaidRequest {
    pub chart: String,
    pub fixed_chart: String,
    pub target: MermaidFixTarget,
}
```

### Proposed response type

```rust
#[derive(Debug, Serialize)]
pub struct FixMermaidResponse {
    pub success: bool,
    pub session_id: String,
    pub message_id: String,
    pub updated_content: String,
}
```

---

## Matching and replacement rules

### Assistant/raw content replacement
Use existing Lotus replacement logic conceptually:
- try exact Mermaid block match first
- if exact match fails and only one Mermaid block exists, replace that block
- otherwise reject with conflict/mismatch

### Structured JSON-path replacement
For `$.conclusion.mermaid.graph`:
- parse JSON
- get string field value
- normalize current graph and submitted chart
- if equal, replace
- if not equal but chart appears exactly once among known Mermaid-bearing fields of the payload, optionally replace with warning-safe server rule
- otherwise reject with 409 conflict

### Why server-side replacement matters
This avoids frontend patching stale or derived markdown that no longer matches the persisted message.

---

## Compatibility with current conclusion_with_options flow

### Current state
- Bamboo stores tool-result content as a string payload
- `conclusion_with_options` question state is also tracked through `pending_question`
- `respond/submit` already mutates matching tool-result messages by `tool_call_id`

### Implication
There is already precedent for server-side mutation of tool-result messages.
That makes the new dedicated Mermaid-fix mutation route conceptually safe and aligned with existing patterns.

---

## Testing plan

### Lotus unit tests

#### `useMessageCardMermaidFix`
- supports assistant text target
- supports tool_result_raw target
- supports tool_result_json_path target
- rejects missing target metadata
- reload retry works after `message not found`

#### `resultFormatters`
- conclusion_with_options formatter returns structured mermaid source descriptors
- multiple Mermaid graphs preserve stable occurrence indexes
- identical Mermaid blocks can still map uniquely via occurrence index

#### markdown renderer
- passes fix target through to Mermaid component
- does not show fix button when target is absent

### Lotus integration tests
- clicking fix on assistant message patches and rerenders
- clicking fix on conclusion_with_options Mermaid patches structured payload and rerenders
- clicking fix on raw tool_result Mermaid patches backend tool message and rerenders

### Lotus e2e tests
Extend `e2e/tests/mermaid-fix-persistence.spec.ts` with new scenarios:
1. assistant text
2. assistant text derived from assistant+tool_calls history item
3. conclusion_with_options tool_result containing Mermaid in `conclusion.mermaid.graph`
4. generic tool_result markdown Mermaid block
5. reload persistence for all above

### Bamboo unit tests
- fix_mermaid handler patches assistant content
- fix_mermaid handler patches tool content
- fix_mermaid handler patches JSON path field
- rejects unsupported roles/paths
- rejects empty fixed chart
- rejects running session
- clears derived context state when needed

### Bamboo e2e tests
- route works against persisted session.json
- conclusion_with_options tool_result Mermaid survives reload
- refresh after patch returns updated history matching Lotus expectations

---

## Migration and rollout plan

### Phase 1: infrastructure
1. add backend dedicated fix-mermaid route
2. add frontend `MermaidFixTarget`
3. preserve backend IDs on tool_result UI messages
4. preserve structured source descriptors through markdown rendering

### Phase 2: product support
1. enable fix for assistant text
2. enable fix for structured conclusion_with_options Mermaid
3. enable fix for generic tool_result raw Mermaid where safe

### Phase 3: consistency improvements
1. persist/recover tool-result display_preference properly
2. unify patch response payloads for better optimistic updates
3. optionally move Mermaid-fix generation into Bamboo later

---

## Risks

### Risk: ambiguous Mermaid source in derived markdown
If the same Mermaid graph appears multiple times in a rendered markdown blob, naive text matching can patch the wrong source.

**Mitigation:** use occurrence index or explicit source descriptors during formatting.

### Risk: tool-result JSON reserialization formatting changes
If backend rewrites JSON in minified form, visual diffs may be surprising.

**Mitigation:** accept canonical JSON formatting or add stable pretty-print if required.

### Risk: stale local optimistic updates
Derived markdown may not match persisted structured payload exactly.

**Mitigation:** after structured patch, reload the session or use backend-returned updated content.

### Risk: over-generalized patch surface
A generic tool-result patch API could become unsafe.

**Mitigation:** keep endpoint purpose-built for Mermaid source replacement only.

---

## Final recommendation

Implement **full solution B** as a source-aware structured Mermaid fix feature, not as a widened version of the existing assistant-text patch.

### Minimum acceptable implementation
- new Bamboo route dedicated to Mermaid fix
- frontend `MermaidFixTarget`
- structured source retention for `conclusion_with_options`
- support for patching tool-result JSON path `$.conclusion.mermaid.graph`
- tests for persistence and reload

### Strongly recommended extras
- preserve `display_preference` across reloads
- add `backendMessageId` to all patchable UI message variants
- support generic tool_result raw Mermaid if exact source location is known

This delivers the product behavior users expect:

> if Lotus shows a Mermaid diagram with a Fix Mermaid button, clicking it should succeed and persist, regardless of whether the Mermaid came from plain assistant text or structured tool output.
