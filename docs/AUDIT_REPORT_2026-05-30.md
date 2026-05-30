# Lotus Frontend Audit Report — 2026-05-30

> Generated via multi-agent audit: 6 parallel dimension scanners → adversarial verification of every falsifiable claim → synthesis. 49 raw findings → 30 confirmed, 5 refuted, 14 observations.

## Executive Summary

Highest-value wins are in dependency hygiene (6 genuinely unused npm packages, grep- and `npm ls`-confirmed) and a deprecated `AgentService` re-export stub still consumed by 6 files. Most type-safety and complexity items are real but lower-leverage; several aggressive claims were refuted on close inspection (see appendix).

| Theme | Confirmed | Observations | Refuted |
|---|---|---|---|
| Dependency & Config Hygiene | 7 | 3 | 0 |
| Architecture & Structure | 5 | 3 | 1 |
| Dead code (interfaces/comments) | 6 | 0 | 0 |
| Duplication | 7 | 0 | 0 |
| Type safety | 5 | 2 | 3 |
| Complexity | 2 | 6 | 1 |

**Any "delete X" must be confirmed with `tsc` before acting** — grep misses relative-path imports.

---

## 1. Dependency & Config Hygiene

### [HIGH] Six unused npm dependencies / type packages
**Files:** `package.json:54` (`@tauri-apps/plugin-notification`), `:59` (`html2pdf.js`), `:81-82` (`@babel/core`, `@babel/preset-react`), `:86-87` (`@types/json-stream`, `@types/lodash-es`), `:88` (`@types/markdown-it`)

Installed (confirmed via `npm ls`) but zero imports across all forms. Notably:
- `@tauri-apps/plugin-notification` — app uses custom `desktopNotification.ts` invoking the Rust backend directly.
- `html2pdf.js` — PDF export uses `jspdf` + `html2canvas` (dynamic imports in `MessageExportService.ts:106-107`); also a `manualChunks` entry in `vite.config.ts:64` to remove.
- `@babel/*` — legacy pre-Vite tooling; `@vitejs/plugin-react` handles JSX.
- `markdown-it` runtime dep also appears unused (only `react-markdown` in production) — verify and remove with its `@types`.

**Recommendation:** Remove all six (+ `markdown-it` if confirmed) and the `html2pdf.js` manualChunks entry. Run `npm install` + `tsc` + build to confirm.

### [MEDIUM] Unused `@` path alias in vitest config
**Files:** `vitest.config.ts:28` — `@` → `./src` defined only here, never used (all imports use `@services`/`@shared`). Delete it; keep alias sets aligned across vite/vitest/tsconfig.

### [LOW] Version-pinning / tooling (no action)
Tauri `~2` pinning and `rollup-plugin-visualizer` devDep are intentional/correct. Optionally document the Tauri `~` convention.

---

## 2. Architecture & Structure

### [HIGH] Deprecated `AgentService` stub still consumed by 6 files
**Files:** stub `src/pages/ChatPage/services/AgentService.ts`; consumers `QuestionDialog.tsx`, `ProviderSettings/{ProviderInstanceManager.tsx,providerInstanceUtils.ts,index.tsx}`, `SystemSettingsPage/{SystemSettingsSchedulesTab.tsx,SystemSettingsSessionsTab.tsx}`

Six non-ChatPage files import `ReasoningEffort`/`AgentClient`/schedule types through a `@deprecated` shim instead of `@services/chat/AgentService` — an upside-down dependency (SettingsPage reaching into a ChatPage-local stub).

**Recommendation:** Repoint all 6 to `@services/chat/AgentService` (or a new chat barrel), then delete the stub. `tsc`-confirm.

### [MEDIUM] No `services/chat` barrel; chat types missing from `services/index.ts`
`services/chat/` has no `index.ts`; `AgentService.ts` exports ~52 types unreachable via the public `@services` barrel — *the* reason consumers route through the ChatPage stub. Create `src/services/chat/index.ts` and re-export from `services/index.ts`. Prerequisite for a clean stub deletion above.

### [MEDIUM] ChatPage/services mixes deprecated stub with real services
One re-export stub alongside four real domain services (94–420 lines). After deleting the stub the directory becomes coherent; optionally document the page-local vs `@services` boundary.

### [LOW] WorkspaceService legacy type aliases still in use
`workspace/types.ts:117-119` (`WorkspaceValidationResult`, `WorkspaceInfo`) still consumed; a separate same-named local interface exists in `ChatPage/utils/workspaceValidator.ts`. Migrate internal refs to `Workspace`; keep aliases marked for next major.

### [LOW] Inconsistent singletons; ServiceFactory mixed role; CommandPalette layering
`getInstance()` vs `new` split across services; `ServiceFactory` is factory + utility; **genuine layering violation: only `CommandPalette` (shared) depends on ChatPage state.** Pick one singleton convention; abstract ChatPage selectors behind a `shared/store` adapter for CommandPalette.

---

## 3. Dead Code (interfaces & commented blocks)

### [MEDIUM] Commented-out localStorage block in `modelSlice`
`src/pages/ChatPage/store/slices/modelSlice.ts:47-51` — references undefined `SELECTED_MODEL_LS_KEY`, contradicts current architecture. Delete.

### [LOW] Five unused exported interfaces
`ToolService.ts:50-53` (`ToolsUIResponse`), `:55-58` (`ValidationResult`), `api/types.ts:12-15` (`ApiPaginationParams`), `:17-21` (`ApiFilterParams`), `api/errors.ts:11-15` (`ErrorResponse`) — all exported through barrels with zero consumers. Delete each + re-export lines (~25-30 lines). `tsc`-confirm.

---

## 4. Duplication

> All concentrated in `SystemSettingsSchedulesTab.tsx`/`.logic.ts`. Root cause: `.logic.ts` exists only for tests while `.tsx` keeps its own full copy of every type/helper.

### [MEDIUM] Schedule logic duplicated between `.tsx` and `.logic.ts`
`.tsx` does NOT import from `.logic.ts` (0 imports). Identical types + builders in both; `.logic.ts` is consumed only by its test → the shipped component logic is untested. Make `.tsx` import from `.logic.ts`; delete local copies (~70+ lines). **Do first.**

### [MEDIUM] `buildTriggerFromValues` ↔ `scheduleToFormValues` mirror switches
`.logic.ts:66-151` vs `.tsx:348-395` — inverse 5-case mappings kept in sync by hand. Consider a bidirectional mapper registry (~40-60 lines). Secondary.

### [MEDIUM] Nine identical try/catch error blocks
`SystemSettingsSchedulesTab.tsx` (9 sites) — `catch → console.error → msgApi.error(t(key))`. Extract `runWithScheduleError(label, errorKey, fn)` (~40-50 lines).

### [LOW] Modal state / JSX duplication in SchedulesTab
3 near-identical modal state objects, duplicate `onCancel`, 3 copies of hour/minute Form.Item pairs. Optional `useModalState` hook + `<TimeInputPair>` (~50 lines).

### [LOW] Status-to-color mappers across three files
`SchedulesTab.tsx:37-53`, `resultFormatters.ts:1034-1045`, `SubAgentRow.tsx:102-111` — same switch shape but divergent status unions AND color systems. Shared part shallow; consider leaving as-is.

---

## 5. Type Safety

### [HIGH] Unvalidated `JSON.parse` + unsafe cast — one genuinely unsafe
Only **`ToolService.ts:140`** is genuinely unsafe (raw cast, no try/catch, no validation → malformed tool output silently corrupts state). The other flagged sites (`uiLayoutStore.ts:393`, `chatSessionSlice.ts:226`, `ModelLimitsSettings.tsx`) already guard post-parse. Add a type guard/try-catch around the ToolService parse; swap `uiLayoutStore` `as any`→`as unknown`.

### [MEDIUM] React-Markdown prop casts via `any`/double-cast
`MessageExportService.ts:181`, `markdownComponents.tsx:65`, `SystemPromptPreview.tsx:96`, `StreamingMessageCard/index.tsx:136`. Define one typed code-block handler + shared typed markdown factory; import ReactMarkdown's real props type.

### [MEDIUM] Error-object property access without guards
`ProviderInstanceManager.tsx:547`, `AccessPasswordCard.tsx:82` — `(error as unknown as Record<...>).errorFields`. Add `isFormError(e)` guard.

### [MEDIUM] Widespread `as unknown as Record<string, unknown>` (50+)
`api/client.ts`, `desktopNotification.ts`, `McpService.ts:52-104`, `ProviderInstanceManager.tsx`, shared utils. For MCP, define discriminated unions (SSE vs Stdio) with predicates. Incremental.

### [MEDIUM] Loose return types — both effectively dead
`SkillService.ts:40` (`Promise<unknown[]>`, unused) and the entire `chatCompletion.ts` interface (never imported). Prefer deleting `chatCompletion.ts` after `tsc` confirm; fold into dead-code PR.

---

## 6. Complexity (mostly observations)

### [HIGH] Oversized hooks/components
`useAgentEventSubscription.ts` (2041), `ProviderSettings/index.tsx` (1671), `InputContainer/index.tsx` (1464) — comprehension/merge hotspots mixing several concerns. Extract cohesive hooks/subcomponents. High-value, high-effort → standalone refactors.

### [MEDIUM] Other large units
`AgentService.ts` (1459), `SystemSettingsSchedulesTab.tsx` (1235), `resultFormatters.ts` (1061), `CommandPalette` (771), `uiLayoutStore.ts` (787), `chatSessionSlice.ts` (repeated `hasOwnProperty` checks). Extract helpers opportunistically when next editing.

---

## Suggested PR Grouping

- **PR A — Dead dependencies.** Remove 6 unused packages (+`markdown-it` if confirmed), drop `html2pdf.js` manualChunks, unused `@` vitest alias. *(Highest ROI, lowest risk.)*
- **PR B — Dead interfaces & comments.** 5 unused interfaces + re-exports, `modelSlice.ts:47-51`, unused `chatCompletion.ts`. ~50-60 lines.
- **PR C — Chat services barrel + stub removal.** Add `services/chat/index.ts`, re-export, repoint 6 consumers, delete stub.
- **PR D — SchedulesTab dedup.** `.tsx` imports from `.logic.ts`; delete duplicated types/builders. *(Biggest duplication win; fixes untested-code gap.)*
- **PR E — SchedulesTab helpers.** Error-handler helper, `useModalState`, `<TimeInputPair>`. (Stack on D.)
- **PR F — Type-safety guards.** ToolService parse validation, `isFormError` (2 sites), `uiLayoutStore` cast, typed markdown handlers.
- **PR G — Workspace alias migration.** Internal refs → `Workspace`.

Defer Section 6 complexity extractions to dedicated refactor PRs.

---

## Refuted / Not Real (checked and dismissed)

- **"Shared components import ChatPage internals" (14 violations)** — `src/components/*` is page-layer (ChatPage imports fine). Only `CommandPalette` (shared, 4 imports) is genuine; ~11 others acceptable.
- **"`applyExecutionEvent` is a 407-line switch with 25+ cases"** — Actually ~364 lines, 19 cases. Real but inflated.
- **"Non-null assertions cause races in WorkspaceService / ErrorBoundary"** — Both safe (cache guard; synchronous error boundary).
- **"Type-unsafe message mutation via Record casting" (`chatSessionSlice` ~1074-1090)** — A `hasOwnProperty` guard restricts updates to existing props; signature is `Partial<Message>`.
- **"Tauri window API: no validation that `invoke` exists"** — All 4 call sites do `typeof invoke === "function"` checks first.

*Every "delete" recommendation must be `tsc`-confirmed before acting.*
