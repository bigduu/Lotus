# Backend Base URL Default Analysis

## Question
Should the frontend default backend API base URL follow the host from the user-facing URL?

## Findings

### Current frontend behavior
- Implementation: `lotus/src/shared/utils/backendBaseUrl.ts`
- Default fallback: `http://127.0.0.1:9562/v1`
- Async resolution order:
  1. `window.__BAMBOO_BACKEND_PORT__` -> `http://127.0.0.1:<port>/v1`
  2. localStorage override
  3. `http://127.0.0.1:9562/v1` if healthy
  4. `VITE_BACKEND_BASE_URL` / fallback default

### Current backend behavior
- Default server bind: `127.0.0.1`
- Implementation: `bamboo/src/core/config.rs`
- Default port: `9562`

### Architectural implication
Following the browser URL host by default only works reliably when the backend is intentionally exposed on the same host name as the frontend entrypoint.

That is **not the general default architecture in this project**:
- Bamboo defaults to loopback (`127.0.0.1`)
- Bodhi embedded backend is local-first
- Lotus browser dev mode talks to a local backend on port `9562`

So a blanket rule like:
- `backend = window.location.host + :9562`

would be risky as a global default, because it would fail or change semantics in these cases:
- Tauri/Bodhi local app using embedded local backend
- setups where frontend is reachable via a hostname alias but backend still binds only to `127.0.0.1`
- remote/reverse-proxy setups that want explicit backend routing

## Recommended design
Use a layered strategy:

1. Explicit override wins
   - localStorage override
   - `VITE_BACKEND_BASE_URL`
   - injected runtime config such as `__BAMBOO_BACKEND_PORT__`

2. Local-first default remains
   - keep `127.0.0.1:9562` as the generic fallback for desktop/local mode

3. Optional browser-host-derived candidate can be added for browser dev mode
   - only as a discovery candidate, not the unconditional default
   - example: if current page is `http://mac.local:1420`, try `http://mac.local:9562/v1`
   - if health check fails, fall back to `127.0.0.1:9562/v1`

## Best fit for current request
For your `mac.local` scenario, the safest improvement is **not** replacing the global fallback with the current browser host.

Instead, add a host-derived candidate during async discovery:
- current page host -> backend on same host with port 9562
- then fallback to `127.0.0.1:9562`

This preserves local/Tauri behavior while making browser access via `mac.local` work more naturally.

## Relevant files
- `lotus/src/shared/utils/backendBaseUrl.ts`
- `lotus/src/shared/utils/__tests__/backendBaseUrl.test.ts`
- `lotus/src/services/api/client.ts`
- `lotus/src/pages/ChatPage/services/openaiClient.ts`
- `bamboo/src/core/config.rs`
