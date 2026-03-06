# Lotus Frontend

Lotus is the standalone React/Vite frontend for the Bodhi desktop shell and Bamboo HTTP backend.

## What Lotus Owns

- Frontend UI (`src/`)
- Frontend unit/integration tests (Vitest)
- End-to-end browser tests (`e2e/`, Playwright)

## Related Projects

- `bodhi/`: Tauri shell and native desktop integrations
- `bamboo/`: Rust HTTP backend (`bamboo serve`)

## Prerequisites

- Node.js (LTS)
- npm
- Rust (for running the backend locally during integration/E2E)

## Install

```bash
cd lotus
npm install
```

## Development

### Frontend only

```bash
cd lotus
npm run dev
```

### Frontend + real backend

Terminal 1:
```bash
cd bamboo
cargo run --bin bamboo -- serve --port 9562 --bind 127.0.0.1 --data-dir /tmp/bamboo-data
```

Terminal 2:
```bash
cd lotus
npm run dev
```

## Build

```bash
cd lotus
npm run build
```

## Tests

### Unit/integration (Vitest)

```bash
cd lotus
npm run test:run
```

### E2E (Playwright)

```bash
cd lotus
npm run test:e2e
```

### E2E with auto-started backend

```bash
cd lotus
npm run test:e2e:with-server
```

## Project Structure

```text
lotus/
├── src/                    # React app
├── e2e/                    # Playwright tests
├── scripts/                # Build/rebrand tooling
├── public/                 # Static assets
└── vite.config.ts          # Vite config
```
