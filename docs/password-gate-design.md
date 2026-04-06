# 密码界面 / 本地访问绕过 设计方案

## 目标

实现一个全局访问门禁（password gate）：

1. 如果后端未设置密码：
   - 不显示密码界面
   - 直接进入现有应用流程
2. 如果后端已设置密码：
   - 非本地访问必须先输入密码
   - `localhost / 127.0.0.1 / ::1` 本地访问可直接绕过
3. 密码保存在后端
4. 前端可以修改密码，但只有在：
   - 已正确输入当前密码，或
   - 当前访问属于本地访问
   时才允许修改

---

## 现有架构接入点

## 前端入口
- 文件：`lotus/src/app/App.tsx`
- 当前逻辑：
  - 启动时调用 `serviceFactory.getSetupStatus()`
  - 根据 `isSetupComplete` 决定显示 `MainLayout` 还是 `SetupPage`
- 结论：
  - **密码界面最适合挂在 App 启动层，而不是 SetupPage 层**
  - 因为它是“全局访问门禁”，应该在进入主界面前先判断

## Setup 页面
- 文件：`lotus/src/pages/SetupPage/SetupPage.tsx`
- 当前职责：代理与首次 setup 完成流程
- 结论：
  - 不建议把密码门禁塞进 SetupPage
  - 否则“首次 setup 状态”和“访问鉴权状态”会耦合

## 后端配置入口
- 文件：
  - `bamboo/src/server/handlers/settings/bamboo_config/config_endpoints/get.rs`
  - `bamboo/src/server/handlers/settings/bamboo_config/config_endpoints/set.rs`
- 当前能力：
  - 已支持读/写 Bamboo config.json
  - 前端 Settings 也是通过该入口改配置
- 结论：
  - **密码元数据应放到 config.json 中的一个新字段**
  - 不建议单独新建文件，除非以后要做更复杂的 auth 子系统

---

## 推荐配置模型

在 `config.json` 新增一段，例如：

```json
{
  "access_password": {
    "enabled": true,
    "password_hash": "...",
    "salt": "...",
    "updated_at": "2026-04-05T18:00:00Z"
  }
}
```

更推荐的命名是：

```json
{
  "access_control": {
    "password_enabled": true,
    "password_hash": "...",
    "password_salt": "...",
    "updated_at": "..."
  }
}
```

### 建议规则
- **绝不保存明文密码**
- 保存：
  - `password_hash`
  - `password_salt`
- 使用已有安全依赖或新增 KDF：
  - 如果只做最小实现，可先 `sha2 + salt`
  - 更推荐 `argon2` / `scrypt`

> 从安全性角度，推荐 argon2；如果你想快速落地，第一版也可以先用项目里已有依赖做 salted hash，再第二步升级。

---

## 后端新增接口设计

## 1. 查询访问门禁状态

### `GET /v1/bamboo/access/status`
返回：

```json
{
  "password_enabled": true,
  "local_bypass": false,
  "requires_password": true,
  "authenticated": false
}
```

说明：
- `password_enabled`: 后端是否设置了密码
- `local_bypass`: 当前请求是否属于本地访问来源
- `requires_password`: 当前请求是否需要显示密码界面
- `authenticated`: 当前会话/请求是否已认证（第一版可以先不做持久会话，仅登录后保存在前端内存 token）

## 2. 验证密码

### `POST /v1/bamboo/access/verify`
请求：

```json
{
  "password": "user-input"
}
```

返回：

```json
{
  "success": true,
  "token": "short-lived-session-token"
}
```

建议：
- 第一版就应该返回一个短期 token
- 前端后续修改密码时带上该 token

## 3. 修改/设置密码

### `POST /v1/bamboo/access/password`
请求：

```json
{
  "current_password": "old-password",
  "new_password": "new-password"
}
```

授权规则：
- 若当前请求是本地访问：允许直接修改
- 若当前请求不是本地访问：必须提供正确的当前密码，或有效 access token

返回：

```json
{
  "success": true
}
```

## 4. 清除密码（可选）

### `DELETE /v1/bamboo/access/password`
授权规则同上。

---

## 本地访问绕过规则

## 推荐规则
只有这些 host / remote addr 视为本地：
- `localhost`
- `127.0.0.1`
- `::1`

### 判断来源建议
后端在 Actix handler 内基于以下信息判断：
1. `HttpRequest.connection_info()`
2. `peer_addr()`
3. 视部署情况再考虑 `X-Forwarded-For`

### 重要建议
**第一版不要把 `mac.local` 自动视为本地绕过。**

原因：
- `mac.local` 是主机名，不等于安全意义上的 loopback
- 它可能来自远程设备解析后的访问
- 你当前就有“远程访问”的需求，因此 `mac.local` 更应该走密码保护而不是本地绕过

### 因此推荐定义
- **本地绕过 = loopback only**
- `mac.local` / LAN IP / 域名访问 = 需要密码

---

## 前端页面流程设计

## 新增页面/状态
建议新增一个独立页面：

- `PasswordGatePage`

它不替代 SetupPage，而是和 SetupPage 并列。

## App 启动流程建议
在 `lotus/src/app/App.tsx` 里把当前初始化流程扩展为：

1. 检查 backend 可达
2. 调用 `GET /v1/bamboo/access/status`
3. 根据返回值分支：
   - `password_enabled = false` → 继续原逻辑（Setup/MainLayout）
   - `local_bypass = true` → 继续原逻辑
   - `requires_password = true` → 显示 `PasswordGatePage`
4. 用户验证成功后，再继续原有 `SetupPage` / `MainLayout` 分支

也就是说顶层分支会变成：

```text
App
├─ backend 未就绪 → loading/error
├─ 需要密码 → PasswordGatePage
├─ setup 未完成 → SetupPage
└─ setup 完成 → MainLayout
```

---

## 前端密码修改入口

## 推荐放置位置
放到现有 Settings 体系里，而不是 SetupPage。

建议位置：
- `SystemSettingsPage` 下新增一个小卡片或新 tab
- 比如：
  - `Security` / `Access Control`
  - 或放在现有 `config` 页中

## UI 字段
如果未设置密码：
- New Password
- Confirm Password
- Save

如果已设置密码：
- Current Password（非本地访问时必填）
- New Password
- Confirm Password
- Save
- Remove Password（可选）

## 前端授权逻辑
前端只是辅助，不做真正授权判断。
真正规则必须以后端为准：
- 本地访问：可直接改
- 非本地访问：必须 current password 正确，或已持有 verify token

---

## 推荐认证模型

## 第一版可用模型
- 用户在 `PasswordGatePage` 输入密码
- 后端校验成功后返回一个短期 token
- 前端把 token 存内存（不要 localStorage）
- 后续敏感接口（如改密码）带 `Authorization: Bearer <token>`

## 为什么不用 localStorage
- 你的这个 token 具有“进入应用/修改密码”的能力
- 存 localStorage 会扩大 XSS 风险
- 第一版存在 React state / Zustand memory 就够了

---

## 推荐后端保护范围

如果只是“页面密码门禁”，最小实现可以只保护这些接口：
- setup status
- 主要聊天/数据接口
- settings 修改接口

但更合理的实现是：
- 通过一个统一 middleware / guard
- 对大部分业务接口统一做访问校验
- 对少数白名单接口放行：
  - `/api/v1/health`
  - `/v1/bamboo/access/status`
  - `/v1/bamboo/access/verify`

### 否则会出现的问题
如果只在前端做密码页，而后端 API 不拦：
- 用户可以绕过 UI 直接请求 API
- 安全模型会失效

所以：
> **密码门禁必须以后端校验为主，前端页面只是交互入口。**

---

## 推荐错误码与响应

建议在 `AppError` 中新增：
- `Unauthorized(String)` -> 401
- `Forbidden(String)` -> 403

例如：
- 未通过密码验证访问受保护接口 → 401
- 已认证但不满足修改规则 → 403

---

## 推荐实现阶段

## Phase 1：最小可用版
- 后端 config 增加密码存储字段（hash + salt）
- 新增 access status / verify / password update 接口
- 前端 App 增加 `PasswordGatePage`
- localhost/127.0.0.1/::1 直接绕过
- Settings 中增加修改密码入口

## Phase 2：统一后端保护
- 新增 middleware/guard
- 对业务 API 统一做密码门禁拦截
- 引入短期 token / session 验证

## Phase 3：增强安全性
- 使用 argon2
- 登录失败限速
- token 过期/刷新
- 审计日志

---

## 我对你这个需求的推荐实现结论

### 最推荐的产品规则
- **没有设置密码**：不显示密码界面
- **设置了密码**：
  - loopback 本地访问直接绕过
  - 其他访问必须先输密码
- **修改密码**：
  - 本地访问可直接改
  - 远程访问必须输入当前密码或持有有效认证 token

### 最推荐的技术接入点
- 前端：`App.tsx` 顶层 gate
- 页面：新增 `PasswordGatePage`
- 后端：新增 `access` 系列接口
- 存储：`config.json` 新增 `access_control` 字段
- 判断本地：只认 `localhost / 127.0.0.1 / ::1`

---

## 关键风险提醒

1. **不要把 `mac.local` 当成本地绕过**
   - 你当前有远程访问诉求
   - `mac.local` 更应该属于“需要密码”的访问

2. **不要只做前端页面，不做后端拦截**
   - 否则可绕过 UI 直接打 API

3. **不要明文保存密码**
   - 至少 salted hash
   - 更推荐 argon2

4. **不要把认证 token 存 localStorage**
   - 第一版存在内存足够

---

## 建议下一步

如果继续实现，我建议顺序是：

1. 先在后端设计 `access_control` 配置结构与接口
2. 再在前端 `App.tsx` 接入 `PasswordGatePage`
3. 最后把 Settings 中的“修改密码”表单接上
