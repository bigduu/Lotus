# Lotus Frontend

Lotus is a standalone React + Vite frontend project. It is the UI asset source for the Bodhi desktop shell and also supports browser-mode development and testing.

## Ownership

- Frontend UI and interaction logic: `src/`
- Frontend unit/integration tests: Vitest
- Browser E2E tests: Playwright (`e2e/`)
- npm distribution artifact: `dist/` (package name: `@bigduu/lotus`)

Related projects:
- `bodhi/`: Tauri desktop shell that consumes Lotus build output
- `bamboo/`: Rust backend service

## Prerequisites

- Node.js LTS (recommended: 20+)
- npm
- Rust (required only when integrating with bamboo or running some E2E flows)

## Quick Start

```bash
cd lotus
npm install
npm run dev
```

## Common Commands

```bash
npm run dev               # local development
npm run type-check        # TypeScript checks
npm run test:run          # run Vitest once
npm run test:e2e          # run Playwright E2E
npm run build             # build dist
npm run pack:dry-run      # inspect npm package contents
```

## Integrate with Bamboo

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

## npm Publishing (@bigduu/lotus)

`package.json` is configured with:
- package name: `@bigduu/lotus`
- `publishConfig.access`: `public`
- `prepack`: automatically runs `npm run build` before publish

Manual local publish:

```bash
cd lotus
npm version patch
npm publish
```

## GitHub Actions Auto Publish

Workflow file: `.github/workflows/publish-npm.yml`

Triggers:
- Tag push: `v*` or `lotus-v*`
- Manual trigger: `workflow_dispatch`

### npm Auth in Actions

Do not use interactive `npm login` in CI. Use an npm token:

1. Create an npm access token that can publish `@bigduu/lotus`.
2. In GitHub repo settings, open `Settings -> Secrets and variables -> Actions`.
3. Add a repository secret named `NPM_TOKEN`.
4. The workflow authenticates with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`.

## Project Structure

```text
lotus/
├── src/                       # React application source
├── e2e/                       # Playwright tests
├── scripts/                   # build/branding scripts
├── public/                    # static assets
├── .github/workflows/         # CI/CD
├── vite.config.ts             # Vite configuration
└── package.json               # package metadata and scripts
```
