# i18n 改进完整报告

## 📊 执行摘要

通过并行使用4个Agent探索代码库，发现了 **254个硬编码文本** 需要国际化翻译。

### 已完成 ✅

1. **ChatSidebarDateGroups.tsx** - 完全国际化
   - 添加了 `chat.sidebar.empty.*` 翻译键
   - 添加了 `chat.sidebar.dateGroups.*` 翻译键
   - 添加了 `chat.sidebar.actions.*` 翻译键
   - 支持所有6种语言: en-US, zh-CN, zh-TW, fr-FR, ja-JP, hi-IN

### 待改进 📋

| 优先级 | 文件 | 硬编码数量 | 预计工时 |
|--------|------|-----------|---------|
| 🔴 P0 | SetupPage.tsx | 32 | 2小时 |
| 🔴 P0 | SystemPromptManager/index.tsx | 20 | 1小时 |
| 🟡 P1 | WorkspacePathModal/index.tsx | 14 | 1小时 |
| 🟡 P1 | FolderBrowser/index.tsx | 11 | 45分钟 |
| 🟡 P1 | inputContainerPlaceholder.ts | 6 | 20分钟 |
| 🟢 P2 | Mermaid 组件 (5个文件) | 23 | 2小时 |
| 🟢 P2 | JsonSchemaViewer | 9 | 30分钟 |
| 🟢 P2 | TodoList 组件 | 12 | 45分钟 |
| 🟢 P2 | Tool 相关组件 | 15 | 1小时 |

## 🎯 详细发现

### 1. ChatPage 组件 (147个硬编码)

**最关键的文件：**

#### SetupPage.tsx - 32个硬编码
```typescript
// ❌ 需要改进
"Unable to load setup status. You can continue with manual proxy configuration."
"Proxy settings are invalid."
"Failed to save proxy configuration. Please try again."
"Welcome"
"Welcome to Bodhi"
"Let's set up your environment before entering the main app."
"Next"
"Skip for now"
"Proxy Configuration"
"Complete Setup"
"Setup Complete!"
"Please restart the application to apply all settings."
"Restart"
```

**建议翻译键：**
```typescript
setup: {
  welcome: {
    title: "Welcome to Bodhi",
    description: "Let's set up your environment before entering the main app.",
    skipInfo: "You can skip setup now and configure proxy settings later in System Settings."
  },
  proxy: {
    title: "Proxy Configuration",
    info: {
      corporate: "If you're behind a corporate proxy, configure it below.",
      providerSettings: "Provider configuration is done later in Provider Settings. This setup step only stores network/proxy settings."
    },
    detecting: "Detecting network environment...",
    noProxyDetected: "No existing proxy was detected. You can leave these fields empty if your network does not require a proxy."
  },
  complete: {
    title: "Setup Complete!",
    restartMessage: "Please restart the application to apply all settings."
  },
  button: {
    next: "Next",
    skipForNow: "Skip for now",
    completeSetup: "Complete Setup",
    restart: "Restart"
  },
  error: {
    loadStatusFailed: "Unable to load setup status. You can continue with manual proxy configuration.",
    invalidProxy: "Proxy settings are invalid.",
    saveProxyFailed: "Failed to save proxy configuration. Please try again.",
    completeFailed: "Failed to complete setup. Please try again."
  }
}
```

#### SystemPromptManager/index.tsx - 20个硬编码
```typescript
// ❌ 需要改进
"Default system prompts are locked and cannot be edited."
"Prompt updated successfully"
"Prompt added successfully"
"Failed to save prompt. Please try again."
"Prompt deleted successfully"
"System Prompt Management"
"Add Prompt"
"Are you sure to delete this prompt?"
"Default (Locked)"
"Edit System Prompt"
"Add New System Prompt"
"Prompt Name"
"Prompt Description"
"Prompt Content"
```

**建议翻译键：**
```typescript
settings: {
  systemPromptManager: {
    title: "System Prompt Management",
    addButton: "Add Prompt",
    defaultPromptLocked: "Default system prompts are locked and cannot be edited.",
    updateSuccess: "Prompt updated successfully",
    addSuccess: "Prompt added successfully",
    saveError: "Failed to save prompt. Please try again.",
    deleteSuccess: "Prompt deleted successfully",
    deleteError: "Failed to delete prompt. Please try again.",
    deleteConfirm: "Are you sure to delete this prompt?",
    defaultTag: "Default (Locked)",
    editTitle: "Edit System Prompt",
    addTitle: "Add New System Prompt",
    nameLabel: "Prompt Name",
    nameRequired: "Please input the name of the prompt!",
    descriptionLabel: "Prompt Description",
    descriptionRequired: "Please input the description of the prompt!",
    contentLabel: "Prompt Content",
    contentRequired: "Please input the content of the prompt!"
  }
}
```

### 2. 共享组件 (55个硬编码)

#### Mermaid 图表组件 - 23个硬编码
```typescript
// ❌ 关键硬编码
"Code copied to clipboard"
"Copy failed"
"Mermaid Diagram Error"
"Fix Mermaid"
"Rendering diagram..."
"Export SVG"
"Failed to render Mermaid diagram"
```

#### JsonSchemaViewer - 9个硬编码
```typescript
// ❌ 表格列标题
"Field"
"Type"
"Required"
"Yes" / "No"
"Default"
"Description"
"No properties in schema"
```

#### TodoList - 12个硬编码
```typescript
// ❌ 状态标签
"Pending"
"In Progress"
"Completed"
"Blocked"
"Task List"
"Evaluating"
```

### 3. SettingsPage 组件 (20个硬编码)

仅1个文件需要改进：**SystemPromptManager/index.tsx**

### 4. 其他页面 (32个硬编码)

#### MainLayout.tsx - 2个硬编码
```typescript
// ❌ 侧边栏切换
"Show sidebar"
```

## 🚀 实施计划

### 阶段 1: 核心UI (本周完成)
**目标**: 覆盖用户最常看到的文本

- [x] ChatSidebarDateGroups.tsx
- [ ] SetupPage.tsx (32个文本) - **最高优先级**
- [ ] SystemPromptManager/index.tsx (20个文本)
- [ ] inputContainerPlaceholder.ts (6个文本)

**预计工时**: 4小时
**影响范围**: 新用户设置流程、系统提示词管理

### 阶段 2: 交互组件 (下周完成)
**目标**: 改进对话框和工具组件

- [ ] WorkspacePathModal/index.tsx (14个文本)
- [ ] FolderBrowser/index.tsx (11个文本)
- [ ] JsonSchemaViewer/index.tsx (9个文本)
- [ ] ModalFooter/index.tsx (5个文本)

**预计工时**: 3小时
**影响范围**: 工作区选择、文件浏览、模态框

### 阶段 3: 特殊组件 (按需完成)
**目标**: 国际化工具相关组件

- [ ] Mermaid 图表组件 (23个文本)
- [ ] TodoList 组件 (12个文本)
- [ ] Tool 相关组件 (15个文本)
- [ ] QuestionDialog 组件 (7个文本)

**预计工时**: 4小时
**影响范围**: Mermaid图表、任务列表、工具调用

## 📝 翻译键结构建议

```typescript
// src/shared/i18n/resources.ts
{
  "en-US": {
    // 已有的结构
    app: { ... },
    chat: {
      sidebar: { // ✅ 已完成
        empty: { ... },
        dateGroups: { ... },
        actions: { ... }
      },
      modal: {
        newSessionTitle: "Create New Session - Select System Prompt"
      },
      input: {
        placeholder: "Send a message...",
        placeholderWithReference: "Send a message (includes reference)",
        placeholderWithWorkflows: "Send a message... (type '/' for workflows)",
        toolCallsOnly: "Tool calls only (allowed tools: {{tools}})",
        autoPrefixMode: "Auto-prefix mode: {{prefix}} (type '/' to select tools)",
        toolSpecificMode: "Tool-specific mode (allowed tools: {{tools}})",
        processingFiles: "Processing files…"
      },
      workspace: {
        modalTitle: "Set Workspace Path",
        invalidTitle: "Invalid Workspace Path",
        issuesDetected: "Potential issues detected with the workspace path:",
        confirmSaveInvalid: "Do you still want to save this path?",
        placeholder: "e.g. /Users/alice/Workspace/MyProject",
        label: "Workspace",
        browseFolder: "Browse folder"
      },
      prompt: {
        selectorTitle: "Select System Prompt",
        createButton: "Create New Session",
        helperText: "Select a base system prompt for the AI. You can add or edit prompts in the System Settings.",
        emptyDescription: "No system prompts found. Add one in System Settings."
      },
      folderBrowser: {
        title: "Select Workspace Folder",
        selectCurrent: "Select Current Folder",
        emptyFolder: "This folder is empty",
        tip: "Tip: Click a folder to enter, click \"Select Current Folder\" to confirm"
      },
      actions: {
        regenerate: "Regenerate response",
        retryFailed: "Retry failed request",
        cancelRequest: "Cancel request",
        sendMessage: "Send message",
        copyMessage: "Copy message",
        referenceMessage: "Reference message"
      },
      fileReference: {
        title: "@ File Reference",
        setWorkspace: "Set Workspace",
        noMatches: "No matching files found",
        emptyDirectory: "Directory is empty"
      }
    },
    setup: {
      welcome: {
        title: "Welcome to Bodhi",
        description: "Let's set up your environment before entering the main app.",
        skipInfo: "You can skip setup now and configure proxy settings later in System Settings."
      },
      steps: {
        welcome: "Welcome",
        proxy: "Proxy Configuration"
      },
      proxy: {
        title: "Proxy Configuration",
        info: {
          corporate: "If you're behind a corporate proxy, configure it below.",
          providerSettings: "Provider configuration is done later in Provider Settings. This setup step only stores network/proxy settings."
        },
        detecting: "Detecting network environment...",
        noProxyDetected: "No existing proxy was detected. You can leave these fields empty if your network does not require a proxy.",
        label: {
          httpProxy: "HTTP Proxy URL:",
          httpsProxy: "HTTPS Proxy URL:",
          username: "Username",
          password: "Password",
          rememberCredentials: "Remember credentials (encrypted)"
        },
        placeholder: {
          httpProxy: "http://proxy.company.com:8080"
        }
      },
      complete: {
        title: "Setup Complete!",
        restartMessage: "Please restart the application to apply all settings."
      },
      button: {
        next: "Next",
        skipForNow: "Skip for now",
        back: "Back",
        completeSetup: "Complete Setup",
        restart: "Restart"
      },
      error: {
        loadStatusFailed: "Unable to load setup status. You can continue with manual proxy configuration.",
        invalidProxy: "Proxy settings are invalid.",
        missingUsername: "To store proxy credentials, please enter a username or uncheck 'Remember credentials'.",
        saveProxyFailed: "Failed to save proxy configuration. Please try again.",
        completeFailed: "Failed to complete setup. Please try again."
      }
    },
    components: {
      markdown: {
        codeCopiedSuccess: "Code copied to clipboard",
        copyFailed: "Copy failed"
      },
      jsonSchema: {
        field: "Field",
        type: "Type",
        required: "Required",
        yes: "Yes",
        no: "No",
        default: "Default",
        description: "Description",
        noProperties: "No properties in schema"
      },
      mermaid: {
        errorTitle: "Mermaid Diagram Error",
        fixButton: "Fix Mermaid",
        consoleHint: "Check browser console (F12) for detailed error information",
        saveSuccess: "Saved: {{filename}}",
        exportFailed: "Export failed",
        exportError: "Failed to export Mermaid graph",
        rendering: "Rendering diagram...",
        exportSvgTooltip: "Export SVG",
        loadingDiagram: "Loading diagram...",
        renderFailed: "Failed to render Mermaid diagram"
      },
      questionDialog: {
        selectOptionWarning: "Please select an option",
        submitSuccess: "Response submitted, AI will continue processing",
        noModelError: "No model configured. Please select a default model in Provider Settings, then resume the agent.",
        submitFailed: "Submission failed",
        customOption: "Other (type below)",
        customHint: "↓ Type your answer in the input box below and press Enter",
        confirmButton: "Confirm"
      },
      todoList: {
        status: {
          pending: "Pending",
          inProgress: "In Progress",
          completed: "Completed",
          blocked: "Blocked"
        },
        defaultTitle: "Task List",
        evaluating: "Evaluating",
        pin: "Pin",
        unpin: "Unpin",
        evaluationTitle: "LLM Evaluation",
        toolsCount: "{{count}} tools",
        dependsOn: "Depends on: {{dependencies}}",
        depsCount: "{{count}} deps"
      },
      skillSelector: {
        placeholder: "Select skills"
      },
      skillManager: {
        title: "Skill Manager",
        refreshButton: "Refresh",
        lastUpdated: "Last updated: {{time}}",
        readOnlyInfo: "Skills are read-only. Edit `~/.bamboo/skills/<skill-name>/SKILL.md` and refresh to apply changes. Auto-refresh every 30s.",
        searchPlaceholder: "Search skills...",
        noSkillsFiltered: "No skills match your filters",
        noSkillsFound: "No skills found. Add skill folders in ~/.bamboo/skills"
      }
    },
    common: {
      save: "Save",
      cancel: "Cancel",
      ok: "OK",
      apply: "Apply",
      delete: "Delete",
      edit: "Edit",
      close: "Close",
      home: "Home",
      parentDirectory: "Parent Directory",
      currentPath: "Current Path:",
      directory: "Directory",
      file: "File",
      workspace: "Workspace",
      server: "Server:",
      category: "Category:",
      parameters: "Parameters",
      approve: "Approve",
      reject: "Reject",
      download: "Download",
      saveAnyway: "Save Anyway",
      yes: "Yes",
      no: "No"
    },
    validation: {
      workspaceRequired: "Please enter a workspace path",
      invalidPath: "Invalid path"
    },
    error: {
      saveWorkspaceFailed: "Failed to save workspace path",
      readFolderFailed: "Unable to read folder",
      copyPromptFailed: "Failed to copy prompt content"
    },
    success: {
      promptCopied: "Copied \"{{name}}\" prompt"
    },
    // ... 其他现有翻译
  }
}
```

## ✅ 验收标准

完成 i18n 改进后，应满足以下标准：

1. ✅ **所有用户可见文本都已国际化**
2. ✅ **支持所有6种语言**: en-US, zh-CN, zh-TW, fr-FR, ja-JP, hi-IN
3. ✅ **翻译键命名规范一致** (如: `namespace.component.element`)
4. ✅ **动态文本使用插值** (如: `t("key", { variable: value })`)
5. ✅ **测试通过**: 切换语言后所有文本正确显示
6. ✅ **代码质量**: 无硬编码字符串，无 ESLint 警告

## 📈 进度追踪

- [x] ChatSidebarDateGroups - ✅ 完成
- [ ] SetupPage - 32个文本
- [ ] SystemPromptManager - 20个文本
- [ ] WorkspacePathModal - 14个文本
- [ ] FolderBrowser - 11个文本
- [ ] inputContainerPlaceholder - 6个文本
- [ ] Mermaid组件 - 23个文本
- [ ] JsonSchemaViewer - 9个文本
- [ ] TodoList - 12个文本
- [ ] Tool组件 - 15个文本

**总进度**: 6/254 (2.4%)

## 🔧 开发指南

### 添加新翻译的步骤

1. **在 `resources.ts` 中添加翻译键**:
   ```typescript
   // src/shared/i18n/resources.ts
   en-US: {
     myComponent: {
       title: "My Component Title"
     }
   }
   ```

2. **在组件中使用翻译**:
   ```typescript
   import { useTranslation } from "react-i18next";

   const MyComponent = () => {
     const { t } = useTranslation();
     return <h1>{t("myComponent.title")}</h1>;
   };
   ```

3. **为其他语言添加翻译**:
   ```typescript
   // zh-CN
   myComponent: {
     title: "我的组件标题"
   }
   ```

### 翻译键命名规范

- 使用点号分隔: `namespace.component.element`
- 使用驼峰命名: `userName`, `pageTitle`
- 保持一致性: `chat.sidebar.newSession` 而不是 `chat.new_sidebar_session`

## 📚 参考资源

- [react-i18next 官方文档](https://react.i18next.com/)
- [ICU 消息格式](https://formatjs.io/docs/core-concepts/icu-syntax/)
- [本地化最佳实践](https://www.w3.org/International/questions/qa-i18n)

---

**生成时间**: 2026-03-24
**版本**: 1.0
**维护者**: Claude Code Assistant
