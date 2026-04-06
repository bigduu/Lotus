# Remote Access Analysis

## Question
Does the backend need to listen on `0.0.0.0` to support remote access?

## Findings

### Current backend defaults
- Bamboo default bind: `127.0.0.1`
- Location: `bamboo/src/core/config.rs:639`
- Bamboo server uses `run_with_bind(...)` when bind is not `127.0.0.1`
- Location: `bamboo/src/lib.rs:119`

### Current CORS behavior
- `127.0.0.1` / `localhost` / `::1` bind: allow any origin (safe only because service is local-only)
- `0.0.0.0` bind: restrict to localhost/loopback/Tauri origins plus optional allowlist
- Custom bind address: allow same-host origins plus optional allowlist
- Location: `bamboo/src/server/config.rs:297`

### Architectural implication
If the user wants true remote access, the backend cannot remain bound only to `127.0.0.1`.

At least one of these must be true:
1. backend listens on `0.0.0.0`
2. backend listens on a real LAN IP (for example `192.168.x.x`)
3. a reverse proxy exposes the service remotely

## Recommendation
For remote access, the backend must not stay on `127.0.0.1`.

### Safer recommendation
Prefer binding to a specific LAN IP when possible:
- example: `192.168.0.172`

This is safer than `0.0.0.0` because it avoids exposing the service on every interface.

### Simpler recommendation
If convenience is more important and you understand the exposure risk:
- use `0.0.0.0`

## Frontend alignment
The current frontend host-derived logic is compatible with remote access when the backend is reachable via the same hostname.
Example:
- frontend: `http://mac.local:1420`
- backend default candidate: `http://mac.local:9562/v1`

This only works if the backend is reachable via `mac.local:9562`, which usually requires non-loopback bind.

## Security note
Changing backend bind away from loopback exposes the HTTP service beyond the local machine.
CORS helps browser-origin control, but it does not replace network exposure control.

Recommended hardening:
- restrict with firewall
- narrow CORS allowlist
- prefer LAN IP bind over `0.0.0.0` when possible
- use authentication / reverse proxy if exposure scope grows
