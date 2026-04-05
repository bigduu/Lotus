# Structured Mermaid Fix Implementation Checklist

Reference design:
- `docs/fixes/STRUCTURED_MERMAID_FIX_PLAN.md`

This checklist converts the design into a file-by-file implementation sequence for the first engineering pass.

---

## Scope of first implementation pass

### Goal

Deliver a working end-to-end Mermaid fix flow for:

1. assistant text messages
2. assistant `_text` messages derived from assistant messages with tool calls
3. `conclusion_with_options` Mermaid stored at `$.conclusion.mermaid.graph`
4. raw `tool_result` Mermaid when the rendered graph comes directly from `message.result.result`

### Non-goals for first pass

- moving Mermaid fix generation from Lotus into Bamboo
- generic arbitrary JSON patching for all message payloads
- solving every historical formatting inconsistency in tool result persistence
- changing unrelated Mermaid rendering behavior

---

## Recommended coding order

1. **Bamboo API types + route skeleton**
2. **Bamboo fix-mermaid handler for assistant text + raw tool results**
3. **Bamboo JSON-path patch support for `$.conclusion.mermaid.graph`**
4. **Lotus API client + target types**
5. **Lotus Mermaid render pipeline target propagation**
6. **Lotus structured conclusion renderer source mapping**
7. **Lotus fix hook rewrite**
8. **Frontend state refresh / reconciliation**
9. **Unit tests**
10. **E2E tests**

This order minimizes time spent wiring UI before the backend contract exists.

---

# Bamboo checklist

## A. Add dedicated backend route

### File
- `bamboo/src/server/routes/agent.rs`

### Work
- Add a new route:
  - `POST /sessions/{session_id}/messages/{message_id}/fix-mermaid`
- Route should point to a new handler under message handlers.

### Completion criteria
- Route exists and compiles.
- Route is grouped with other message mutation endpoints.

---

## B. Export new handler module

### File
- `bamboo/src/server/handlers/agent/messages/mod.rs`

### Work
- Add new module declaration for `fix_mermaid`
- Re-export handler function

### Completion criteria
- Message handler module exposes the new handler cleanly.

---

## C. Add request/response types

### File
- `bamboo/src/server/handlers/agent/messages/types.rs`

### Work
- Add request enum/structs for Mermaid fix target kinds:
  - `assistant_text`
  - `tool_result_raw`
  - `tool_result_json_path`
- Add response struct for success payload
- Add serde tests for each target shape

### Suggested structures
- `FixMermaidRequest`
- `FixMermaidTarget`
- `FixMermaidResponse`

### Completion criteria
- JSON request bodies for all supported target kinds deserialize.
- Tests cover valid and invalid payload shapes.

---

## D. Implement new handler

### File
- `bamboo/src/server/handlers/agent/messages/fix_mermaid.rs` (new)

### Work
- Load session by ID
- Reject if session is running
- Find message by `message_id`
- Switch on target kind
- Patch the correct persisted source
- Save session and update in-memory cache
- Return success response with updated content

### Required behavior

#### For `assistant_text`
- message must be `Role::Assistant`
- replace Mermaid block inside `message.content`
- allow assistant messages that currently include tool-call commentary if the requested field is the persisted assistant content
- do not reuse the older `patch_message` “no tool calls allowed” limitation

#### For `tool_result_raw`
- message must be `Role::Tool`
- replace Mermaid block inside `message.content`

#### For `tool_result_json_path`
- message must be `Role::Tool`
- parse `message.content` as JSON
- support exact initial path:
  - `$.conclusion.mermaid.graph`
- patch only that string field
- serialize back into `message.content`

### Completion criteria
- Handler compiles.
- Success response includes `session_id`, `message_id`, and updated content.
- Rejects unsupported role/target combinations cleanly.

---

## E. Add Mermaid replacement utility helpers

### File
- Prefer colocated helper functions in `fix_mermaid.rs`
- If they grow, move into a helper file under message handlers

### Work
- Add normalized Mermaid extraction helper
- Add “replace matching Mermaid block” helper
- Add JSON-path patch helper for known supported paths

### Validation rules
- `fixed_chart` must not be empty
- original `chart` must not be empty
- if exact Mermaid block match fails:
  - replace the first Mermaid block only when exactly one block exists
  - otherwise return conflict
- for JSON path patch:
  - current value must be string
  - current value should match submitted chart after normalization, or return conflict

### Completion criteria
- Helper functions have focused unit tests.

---

## F. Preserve existing message-state cleanup rules

### File
- `bamboo/src/server/handlers/agent/messages/fix_mermaid.rs`
- shared message helper usage from `shared.rs`

### Work
- Clear derived context state after persisted history mutation
- Save session to storage and cache

### Completion criteria
- Session save path mirrors other mutation endpoints.

---

## G. Add unit tests for backend handler

### Files
- `bamboo/src/server/handlers/agent/messages/fix_mermaid.rs`
- or `bamboo/src/server/handlers/agent/messages/fix_mermaid/tests.rs`

### Test cases
1. assistant text message patch succeeds
2. assistant message derived from tool-call commentary content can still patch persisted assistant content
3. raw tool-result Mermaid patch succeeds
4. JSON path patch succeeds for `$.conclusion.mermaid.graph`
5. session running returns conflict/bad request
6. empty `fixed_chart` returns bad request
7. non-string JSON-path field returns bad request
8. missing message returns not found
9. Mermaid mismatch with multiple blocks returns conflict

### Completion criteria
- Tests pass and cover all target kinds.

---

## H. Add backend e2e/API tests

### Candidate files
- `bamboo/tests/e2e/messages/*`
- add a new focused test file for Mermaid fix

### Work
- Create persisted session with:
  - assistant text Mermaid
  - tool-result raw Mermaid
  - `conclusion_with_options` JSON payload Mermaid
- Call new endpoint and verify session reload contains updated graph

### Completion criteria
- Endpoint behavior is verified against persisted session storage.

---

# Lotus checklist

## I. Add frontend target types

### Files
- `lotus/src/pages/ChatPage/types/chatMessages.ts`
- or create `lotus/src/pages/ChatPage/types/mermaidFix.ts`

### Work
- Add `MermaidFixTarget` union type
- Add request/response types matching Bamboo endpoint
- Avoid burying patch identity only inside arbitrary metadata

### Completion criteria
- All target kinds are represented in a shared type definition.

---

## J. Extend agent client API

### File
- `lotus/src/services/chat/AgentService.ts`

### Work
- Add:
  - `FixSessionMessageMermaidRequest`
  - `FixSessionMessageMermaidResponse`
  - `fixSessionMessageMermaid(sessionId, messageId, req)`
- Keep existing `patchSessionMessage()` unchanged for backwards compatibility

### Completion criteria
- New API method compiles and is unit-tested.

---

## K. Add backendMessageId to patchable UI messages

### Files
- `lotus/src/pages/ChatPage/types/chatMessages.ts`
- `lotus/src/pages/ChatPage/store/slices/chatSessionSlice.ts`

### Work
- Add explicit `backendMessageId?: string` to base or relevant message types
- Populate it when mapping history:
  - assistant text direct messages
  - assistant `_text` synthetic messages
  - tool_result UI messages
  - tool_call UI messages if useful for future expansion

### Why
This avoids scattered fallback inference via `metadata.backendMessageId` only.

### Completion criteria
- Patchable message types carry stable backend identity.

---

## L. Preserve raw source identity in history mapping

### File
- `lotus/src/pages/ChatPage/store/slices/chatSessionSlice.ts`

### Work
- Ensure assistant `_text` synthetic messages preserve original backend message ID
- Ensure tool_result UI messages preserve backend message ID
- Do not depend solely on synthetic UI `id`

### Completion criteria
- Reloaded session messages provide enough identity for structured Mermaid fix.

---

## M. Preserve tool-result metadata better on reload

### File
- `lotus/src/pages/ChatPage/store/slices/chatSessionSlice.ts`

### Work
- Stop hardcoding tool-result `display_preference: "Default"` when authoritative value is available
- If backend does not yet expose full display preference in history, add a TODO and isolate the fallback so future persistence work is localized

### Completion criteria
- Tool-result mapping is not silently more lossy after this feature work.

---

## N. Redesign Markdown component API for source-aware Mermaid fix

### File
- `lotus/src/shared/components/Markdown/markdownComponents.tsx`

### Work
- Extend options to include Mermaid source descriptors / fix target context
- Keep current code path for plain code blocks unchanged

### Completion criteria
- Markdown code renderer can attach the correct fix target to Mermaid blocks.

---

## O. Extend Mermaid code block rendering path

### File
- `lotus/src/shared/components/Markdown/MarkdownCodeBlock.tsx`

### Work
- Update `renderCodeBlock()` to pass a target-aware `onFix` callback into `MermaidChart`
- Ensure callback signature carries:
  - `chart`
  - `renderError`
  - `target`

### Completion criteria
- Mermaid chart component can invoke fix with full source info.

---

## P. Update MermaidChart props and callback shape

### File
- `lotus/src/shared/components/MermaidChart/index.tsx`

### Work
- Change `onFix` prop shape from chart-only callback to structured callback
- Keep loading/error UI intact
- Ensure `fixError` can display backend validation failures meaningfully

### Completion criteria
- MermaidChart can invoke the new structured fix flow without regressing current behavior.

---

## Q. Rewrite `useMessageCardMermaidFix`

### File
- `lotus/src/pages/ChatPage/components/MessageCard/useMessageCardMermaidFix.ts`

### Work
- Replace assistant-text-only gate with target-aware patch flow
- Keep fast model generation path
- Delegate persistence to Bamboo `fixSessionMessageMermaid()`
- Use authoritative backend message id from target
- After success:
  - optimistic update for assistant text and raw tool-result when deterministic
  - otherwise reload history or reconcile from response

### New responsibilities
1. call fast model to fix Mermaid
2. build backend fix request
3. call Bamboo new endpoint
4. update local session state safely

### Completion criteria
- Hook supports all first-pass target kinds.
- Old assistant-text path still works.

---

## R. Add structured render model for `conclusion_with_options`

### Files
- `lotus/src/pages/ChatPage/utils/resultFormatters.ts`
- `lotus/src/pages/ChatPage/components/MessageCard/InteractiveQuestionToolCard.tsx`
- `lotus/src/pages/ChatPage/components/MessageCard/MessageCardContent.tsx`

### Work
- Replace “markdown string only” output with a richer render model for structured conclusion content
- Include Mermaid source descriptors with exact JSON path mapping
- Initial required mapping:
  - `$.conclusion.mermaid.graph`

### Suggested shape
```ts
interface StructuredMarkdownRenderModel {
  markdown: string;
  mermaidSources: MermaidSourceDescriptor[];
}
```

### Completion criteria
- `conclusion_with_options` rendered Mermaid has a deterministic fix target.

---

## S. Support raw `tool_result` Mermaid targets

### Files
- `lotus/src/pages/ChatPage/components/MessageCard/MessageCardContent.tsx`
- `lotus/src/pages/ChatPage/components/ToolResultCard/index.tsx`
- possibly shared markdown helpers if ToolResultCard already uses formatted output paths

### Work
- If a tool result is rendered from raw markdown that contains Mermaid, provide a `tool_result_raw` target
- Ensure target uses persisted backend tool message ID

### Completion criteria
- Raw tool-result Mermaid can be fixed without pretending it is assistant text.

---

## T. Make assistant `_text` fix path explicit

### Files
- `lotus/src/pages/ChatPage/store/slices/chatSessionSlice.ts`
- `lotus/src/pages/ChatPage/components/MessageCard/useMessageCardMermaidFix.ts`

### Work
- For synthetic `${backendId}_text` messages, stop relying on suffix stripping as the only fallback
- Use explicit `backendMessageId`
- Ensure fix flow targets persisted assistant message content, not the synthetic UI id

### Completion criteria
- `_text` messages remain fixable and less brittle after refactor.

---

## U. Update MessageCard composition

### File
- `lotus/src/pages/ChatPage/components/MessageCard/index.tsx`

### Work
- Ensure `markdownComponents` receives the right Mermaid source model depending on message type
- For plain assistant text, use message-level target
- For structured tool-rendered markdown, use per-block source descriptors

### Completion criteria
- MessageCard becomes the clean composition boundary for Mermaid fix context.

---

# Test checklist

## V. Lotus unit tests: hook

### File
- `lotus/src/pages/ChatPage/components/MessageCard/useMessageCardMermaidFix.test.tsx`

### Add/modify tests
1. assistant text target works
2. `_text` synthetic assistant target uses backendMessageId
3. raw tool-result target works
4. structured JSON-path target works
5. backend conflict surfaces usable error
6. reload fallback works after message not found

### Completion criteria
- Hook tests cover all first-pass target kinds.

---

## W. Lotus unit tests: result formatter / source retention

### Files
- `lotus/src/pages/ChatPage/utils/__tests__/resultFormatters.test.ts`
- add tests for render-model output

### Add tests
1. `conclusion_with_options` emits markdown and Mermaid source metadata
2. JSON path `$.conclusion.mermaid.graph` is attached correctly
3. identical Mermaid graphs can be disambiguated by occurrence index if implemented

### Completion criteria
- Structured markdown path is verified independently of UI.

---

## X. Lotus unit tests: Mermaid error component behavior

### Files
- `lotus/src/shared/components/MermaidChart/__tests__/MermaidChartError.test.tsx`
- `lotus/src/shared/components/Markdown/markdownComponents.test.tsx`

### Add tests
1. fix button renders only when target-aware callback exists
2. callback receives target context
3. no fix button for Mermaid blocks without a resolvable source target

### Completion criteria
- Renderer/button behavior matches target availability.

---

## Y. Lotus store tests

### Files
- `lotus/src/pages/ChatPage/store/slices/__tests__/chatSessionSlice*.test.ts`

### Add tests
1. assistant `_text` messages preserve backend message ID
2. tool_result messages preserve backend message ID
3. tool_result metadata/display preference handling remains stable

### Completion criteria
- History mapping remains reliable after reload.

---

## Z. Lotus E2E tests

### File
- `lotus/e2e/tests/mermaid-fix-persistence.spec.ts`

### Extend with scenarios
1. assistant text Mermaid
2. assistant `_text` synthetic message mapped from assistant+tool_calls history item
3. `conclusion_with_options` Mermaid under `$.conclusion.mermaid.graph`
4. raw tool_result Mermaid block
5. page reload persists fixed result in all supported scenarios

### Completion criteria
- E2E confirms real product behavior, not just mocked hook behavior.

---

# PR breakdown recommendation

## PR 1 — Bamboo API foundation
- route
- request/response types
- handler scaffold
- assistant text + raw tool-result support
- backend tests

## PR 2 — Bamboo structured JSON-path support
- `$.conclusion.mermaid.graph`
- JSON-path validation logic
- structured backend tests

## PR 3 — Lotus target model + client API
- `MermaidFixTarget`
- AgentService client method
- backendMessageId propagation
- store tests

## PR 4 — Lotus render pipeline refactor
- Markdown target propagation
- MermaidChart callback shape
- hook rewrite
- assistant text + `_text` + raw tool_result support

## PR 5 — Lotus structured conclusion support
- result formatter render model
- `conclusion_with_options` source descriptors
- structured fix flow
- unit tests + e2e

## PR 6 — polish and persistence consistency
- tool_result display preference recovery
- error copy refinement
- cleanup / docs / regression coverage

---

# Immediate next file to edit

## Start here
### `bamboo/src/server/handlers/agent/messages/types.rs`

Why first:
- it forces the API contract to become explicit
- frontend work depends on these target shapes
- it naturally leads into the new route and handler implementation

### Then
1. `bamboo/src/server/routes/agent.rs`
2. `bamboo/src/server/handlers/agent/messages/fix_mermaid.rs`
3. `lotus/src/services/chat/AgentService.ts`
4. `lotus/src/pages/ChatPage/types/mermaidFix.ts` (new or merged into existing types)

---

# Blockers / unknowns to watch

1. **JSON serialization format for patched tool-result content**
   - Decide whether stable minified JSON is acceptable for first pass.

2. **How many JSON paths to support initially**
   - Recommendation: only `$.conclusion.mermaid.graph` in v1.

3. **Tool-result display preference persistence**
   - Current reload behavior is lossy; may need a small parallel cleanup.

4. **Duplicate Mermaid graphs in one structured markdown block**
   - If encountered, implement occurrence index disambiguation before broad rollout.

5. **Assistant commentary messages with tool_calls**
   - Existing patch route rejects them; new fix route must intentionally support them when target says assistant text.

---

# Definition of done for first pass

The first pass is done when all of the following are true:

- Clicking **Fix Mermaid** on a normal assistant message works and persists.
- Clicking **Fix Mermaid** on a synthetic `_text` assistant message works and persists.
- Clicking **Fix Mermaid** on a `conclusion_with_options` Mermaid works and persists.
- Clicking **Fix Mermaid** on a raw tool-result Mermaid works and persists.
- Page reload preserves the corrected Mermaid in all supported scenarios.
- Unsupported Mermaid sources do **not** show a broken fix action.

---

# Related docs

- Main design: `docs/fixes/STRUCTURED_MERMAID_FIX_PLAN.md`
- Existing Mermaid fix e2e: `e2e/tests/mermaid-fix-persistence.spec.ts`
