# Lotus · 莲花交互层

> 📖 For English, see **[README.md](./README.md)**

> Zenith 的 React + Vite UI 层 · `@bigduu/lotus`

---

## 这是什么

Lotus 是你和 AI 智能体对话的那块「玻璃」。你打字、它回答——但更重要的是，你能**看见它在想什么、在做什么**：它正在读哪个文件、调用哪个工具、列了什么待办清单、画了什么流程图，全部实时呈现在屏幕上。它把一个原本黑箱的 AI，变成一个透明、可观察、可随时打断的工作伙伴。

---

## 一览能力

| 能力 | 说明 |
| --- | --- |
| **实时事件流** | 通过 SSE 逐字渲染回答、推理、工具调用，帧级流畅（`requestAnimationFrame` 批处理） |
| **命令面板** | `Cmd/Ctrl + K` 一键跳转会话、设置、主题、新建任务 |
| **设置中心** | Providers、模型上限、MCP、Hooks、计划任务、环境变量、关键词脱敏、指标仪表盘 |
| **待办清单** | 智能体的任务计划随执行实时更新进度 |
| **追问对话** | 智能体需要澄清时弹出，支持选项与自由输入 |
| **Mermaid 渲染** | 回答中的图表自动渲染，可缩放拖拽、错误可一键让 AI 修复 |
| **技能管理** | 浏览、启用/停用智能体技能 |
| **多窗格** | 可拆分布局并排查看多个会话 |
| **双语 + 主题** | 中英文界面，明暗主题，VDI 安全模式 |

---

## 架构

Lotus 是一个**纯前端**项目（React 18 + Vite 6 + TypeScript）。它本身不含业务逻辑后端——所有智能体的执行都发生在 **bamboo**（本地 Rust 运行时）里。Lotus 通过 **HTTP + SSE** 与 bamboo 对话：普通请求走 REST（`/api/v1/...`），实时输出走 Server-Sent Events（`/api/v1/events/{sessionId}`，由浏览器原生 `EventSource` 自动重连）。同一份构建产物（`dist/`）既被 **bodhi** 桌面外壳加载，也可在浏览器里直接开发调试。

```mermaid
flowchart LR
  subgraph Browser["Browser / Bodhi WebView"]
    UI["Lotus UI<br/>React + Vite"]
    ES["EventSource (SSE)"]
    REST["fetch (REST)"]
    Store["State: Jotai + Zustand<br/>Storage: Dexie (IndexedDB)"]
    UI --- Store
    UI --- ES
    UI --- REST
  end
  ES -- "/api/v1/events/{sessionId}" --> Bamboo
  REST -- "/api/v1/..." --> Bamboo
  Bamboo["bamboo<br/>local Rust agent runtime"]
```

**关键技术（已在 `package.json` 中验证）：**

- **UI / 组件**: Ant Design 5 (`antd`, `@ant-design/icons`)
- **状态**: Jotai (`jotai`, `jotai-family`) 用于细粒度流式原子 + Zustand (`zustand`) 用于应用/UI 存储
- **本地存储**: Dexie (IndexedDB) — `src/services/storage/StorageDb.ts`
- **Markdown**: `react-markdown` + `remark-gfm` / `remark-breaks` + `rehype-sanitize` + `react-syntax-highlighter`
- **图表**: `mermaid`（配 `react-zoom-pan-pinch` 查看器）
- **指标图表**: `recharts`
- **导出**: `jspdf` + `html2canvas`
- **国际化**: `i18next` + `react-i18next`（语言：`zh-CN`、`en-US`）
- **虚拟化**: `@tanstack/react-virtual`

**源码地图（`src/`）：**

```text
src/
├── app/                  # App bootstrap, MainLayout (sidebar + panes + settings)
├── pages/
│   ├── ChatPage/         # The chat experience (the flagship)
│   │   ├── streaming/    # Jotai atoms + RAF-batched streaming state
│   │   ├── hooks/        # useAgentEventSubscription, useChatManager, ...
│   │   ├── components/   # ~50 cards: ToolCallCard, TodoListDisplay,
│   │   │                 #   StreamingMessageCard, PlanMessageCard, ...
│   │   ├── conversation/ workspace/ inspector/ services/ utils/
│   ├── SettingsPage/     # SystemSettingsPage + tabs (providers, MCP, metrics...)
│   ├── SetupPage/  PasswordGatePage/
├── components/           # Skill, TodoList, QuestionDialog
├── shared/
│   ├── components/       # CommandPalette, MermaidChart, Markdown, ResizableSplit...
│   ├── store/            # Zustand stores (appStore, theme, settingsView, uiLayout...)
│   ├── i18n/             # zh-CN + en-US resources
│   ├── services/  hooks/  theme/  types/  utils/
├── services/             # HTTP/SSE clients: api/, chat/ (AgentService), config/,
│                         #   mcp/, metrics/, skill/, workspace/, storage/, ...
```

---

## 招牌深潜

### 实时事件流

这是 Lotus 的灵魂。`src/services/chat/AgentService.ts` 定义了与 bamboo 一一对应的事件类型——从 `token`、`reasoning_token`、`tool_token`，到 `tool_start` / `tool_complete` / `tool_error`、`task_list_updated`、`token_budget_updated`、`context_compression_status`、`sub_agent_started`、`need_clarification`、`plan_mode_entered` 等几十种。前端用浏览器原生 `EventSource`（带 `withCredentials`、自动重连、`Last-Event-ID` 续传）订阅每个会话的 `/api/v1/events/{sessionId}`；账号级广播则走 `accountFeed.ts` 的单一长连接。

为了让逐字输出既流畅又不拖垮浏览器，流式状态用 **Jotai 原子** 存储，并在 `pages/ChatPage/streaming/useKeyedRafAtomState.ts` 里用 `requestAnimationFrame` **按帧批量提交**——你看到的是丝滑的打字机效果，而不是每个 token 都触发一次重渲染。

### 对话体验

`pages/ChatPage` 不是一个聊天框，而是一整套「卡片」语言。每一种智能体活动都有对应的可视化组件：`StreamingMessageCard`（流式回答）、`ToolCallCard` / `ToolResultCard` / `ToolSessionCard`（工具调用全过程）、`PlanMessageCard`（计划模式）、`QuestionMessageCard`（追问）、`FileChangeViewer`（文件改动 diff）、`TokenUsageDisplay`（上下文预算）、`SessionSummaryCard`（上下文压缩摘要）等约 50 个组件。`MultiPaneChatView` + `ResizableSplit` 让你能拆分窗格并排看多个会话；长列表用 `@tanstack/react-virtual` 虚拟化保持流畅。

### 命令面板

按 `Cmd/Ctrl + K`（绑定在 `app/MainLayout.tsx` 与 `shared/components/CommandPalette/index.tsx`）即可呼出。它统一了两类入口：**动作**（打开 Provider 设置、模型上限、提示词、技能、MCP、工作流、Hooks、计划任务、会话、指标、关键词脱敏、切换主题、新建任务、折叠侧栏……）和**会话搜索**（按标题模糊匹配跳转，含置顶标记）。所有标签均走 i18n，中英文一致。

### 设置中心

`pages/SettingsPage/components/SystemSettingsPage` 是一个标签化的控制台，懒加载以保持启动轻量。已验证的标签包括：**Providers**（`ProviderSettings`）、**模型上限**（`ModelLimitsSettings`）、**提示词**（`SystemPromptManager`）、**MCP**（服务器表单与管理）、**工作流**、**Hooks**、**计划任务 / Schedules**、**会话 / Sessions**、**环境变量 / Env Vars**、**关键词脱敏 / Keyword Masking**、**通知 / Notifications**、**Mermaid 设置**、**访问密码 / Access Password**、**网络 / Network**，以及基于 `recharts` 的 **指标仪表盘 / Metrics**（`UnifiedMetricsDashboard`、token 图、内存趋势、模型分布、转发端点分布等）。

### 技能、追问、待办、Mermaid

- **技能 / Skill** (`src/components/Skill`): `SkillCard` / `SkillSelector` / `SkillManager` 浏览智能体技能，开关启用/停用，显示许可证标记。
- **追问对话 / Question dialog** (`src/components/QuestionDialog`): 当事件流出现 `need_clarification` 时弹出，支持预设选项与自由文本，并记住每个会话的推理强度（reasoning effort）。
- **待办清单 / To-do list** (`src/components/TodoList` + `pages/ChatPage/components/TodoListDisplay`): 随 `task_list_updated` 等事件实时刷新进度、状态图标、依赖与备注，可折叠、可置顶。
- **Mermaid 渲染** (`shared/components/MermaidChart`): 懒加载渲染器，超宽图自动适配视口，`react-zoom-pan-pinch` 缩放拖拽；渲染失败时提供 `onFix` 回调，把错误交给 AI 修复。

---

## 快速开始

**前置：** Node.js LTS (20+) 与 npm。实时智能体功能需要一个运行中的 **bamboo** 后端（见下文）。

```bash
npm install
npm run dev          # Vite dev server → http://localhost:1420
```

**与 bamboo 联调** — 在第二个终端，从仓库根目录运行：

```bash
cargo run --manifest-path bamboo/Cargo.toml --bin bamboo -- \
  serve --port 9562 --bind 127.0.0.1 --data-dir /tmp/bamboo-data
```

Lotus 默认连接 `http://127.0.0.1:9562/v1` 后端（可通过 `VITE_BACKEND_BASE_URL` 覆盖；见 `src/shared/utils/backendBaseUrl.ts`）。

### 常用脚本（`package.json`）

```bash
npm run dev               # Vite dev server (port 1420)
npm run build             # tsc + vite build → dist/
npm run preview           # preview the production build
npm run type-check        # tsc --noEmit
npm run lint              # eslint src   (lint:fix to autofix)
npm run format            # prettier --write   (format:check to verify)

npm run test              # vitest (watch)        test:ui / test:coverage
npm run test:run          # vitest run (one-shot)
npm run test:e2e          # Playwright (delegates to ./e2e)
npm run test:e2e:browser  # Playwright against http://localhost:1420
npm run test:e2e:with-server  # boots a throwaway bamboo, then runs Playwright

npm run pack:dry-run      # inspect the npm package contents
```

### 打包与品牌（已验证）

```bash
npm run build:bamboo-package   # build, then stage dist into bamboo as a prebuilt frontend
npm run build:public           # rebrand (public) + build
npm run build:internal         # rebrand (internal) + build
npm run rebrand:check          # verify branding state
```

以 **`@bigduu/lotus`** 发布（`publishConfig.access: public`）；`prepack` 会自动运行 `npm run build`。

---

## 其余技术栈

Lotus 是 Zenith 单体仓库中的 UI 层，与以下模块协作：

- [`../bamboo`](../bamboo) — 本地优先的 Rust 智能体运行时（Lotus 通过 HTTP + SSE 对话的执行引擎）
- [`../bodhi`](../bodhi) — 桌面 AI 产品界面（加载 Lotus `dist/` 的 Tauri 外壳）
- [`../bodhi-server`](../bodhi-server) — Go 后端（认证 / 持久化 / 计费 + 配额 / LLM 代理）
- [`../pavilion`](../pavilion) — 官方网站与文档
- [`..`](..) — Zenith 根目录（单体仓库入口、子模块指针、发布列车）

**模块内文档：**

- 前端文档根目录: [`docs/README.md`](./docs/README.md)
- 前端架构: [`docs/architecture/FRONTEND_ARCHITECTURE.md`](./docs/architecture/FRONTEND_ARCHITECTURE.md)
- 设计规范: [`docs/DESIGN_SPEC.md`](./docs/DESIGN_SPEC.md)
- 功能文档（Command Selector / Question Dialog / Mermaid）: [`docs/features/`](./docs/features/)
- 开发指南: [`docs/development/`](./docs/development/)
