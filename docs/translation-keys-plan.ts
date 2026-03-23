// Translation keys to add to resources.ts
// This file documents all the translation keys that need to be added

export const translationKeysToAdd = {
  enUS: {
    // Common buttons
    common: {
      cancel: "Cancel",
      ok: "OK",
      apply: "Apply",
      save: "Save",
      delete: "Delete",
      saveAnyway: "Save Anyway",
      yes: "Yes",
      no: "No",
      home: "Home",
      parentDirectory: "Parent Directory",
      currentPath: "Current Path:",
      workspace: "Workspace",
      server: "Server:",
      category: "Category:",
      parameters: "Parameters",
      approve: "Approve",
      reject: "Reject",
      download: "Download",
      directory: "Directory",
      file: "File",
    },

    // Setup page
    setup: {
      welcome: {
        title: "Welcome",
        heading: "Welcome to Bodhi",
        description: "Let's set up your environment before entering the main app.",
        skipInfo: "You can skip setup now and configure proxy settings later in System Settings.",
      },
      steps: {
        welcome: "Welcome",
        proxy: "Proxy Configuration",
      },
      proxy: {
        title: "Proxy Configuration",
        info: "If you're behind a corporate proxy, configure it below.",
        providerInfo: "Provider configuration is done later in Provider Settings. This setup step only stores network/proxy settings.",
        detecting: "Detecting network environment...",
        noProxyDetected: "No existing proxy was detected. You can leave these fields empty if your network does not require a proxy.",
        httpProxyLabel: "HTTP Proxy URL:",
        httpsProxyLabel: "HTTPS Proxy URL:",
        httpProxyPlaceholder: "http://proxy.company.com:8080",
        httpsProxyPlaceholder: "http://proxy.company.com:8080",
        usernameLabel: "Username",
        passwordLabel: "Password",
        rememberCredentials: "Remember credentials (encrypted)",
      },
      complete: {
        title: "Setup Complete!",
        restartMessage: "Please restart the application to apply all settings.",
      },
      button: {
        next: "Next",
        skipForNow: "Skip for now",
        back: "Back",
        completeSetup: "Complete Setup",
        restart: "Restart",
      },
      error: {
        loadStatusFailed: "Unable to load setup status. You can continue with manual proxy configuration.",
        invalidProxy: "Proxy settings are invalid.",
        credentialsUsername: "To store proxy credentials, please enter a username or uncheck 'Remember credentials'.",
        saveProxyFailed: "Failed to save proxy configuration. Please try again.",
        completeFailed: "Failed to complete setup. Please try again.",
      },
    },

    // Chat workspace
    chat: {
      sidebar: {
        // Already exists: newSession
        empty: {
          noSessions: "No sessions yet",
          hint: "Click \"New Session\" to get started",
        },
        dateGroups: {
          today: "Today",
          yesterday: "Yesterday",
          thisWeek: "This Week",
          thisMonth: "This Month",
          pinned: "Pinned",
          scheduled: "Scheduled",
        },
        actions: {
          collapseChildren: "Collapse child sessions",
          expandChildren: "Expand child sessions",
        },
      },
      workspace: {
        modalTitle: "Set Workspace Path",
        invalidTitle: "Invalid Workspace Path",
        issuesDetected: "Potential issues detected with the workspace path:",
        confirmSaveInvalid: "Do you still want to save this path?",
        placeholder: "e.g. /Users/alice/Workspace/MyProject",
        label: "Workspace",
        browseFolder: "Browse folder",
        descriptionTitle: "Workspace Path Description",
        checkTitle: "Workspace Path Check",
      },
      folderBrowser: {
        title: "Select Workspace Folder",
        selectCurrent: "Select Current Folder",
        emptyFolder: "This folder is empty",
        tip: "Tip: Click a folder to enter, click \"Select Current Folder\" to confirm",
      },
      input: {
        placeholder: "Send a message...",
        placeholderWithReference: "Send a message (includes reference)",
        placeholderWithWorkflows: "Send a message... (type '/' for workflows)",
        toolCallsOnly: "Tool calls only (allowed tools: {{tools}})",
        autoPrefixMode: "Auto-prefix mode: {{prefix}} (type '/' to select tools)",
        toolSpecificMode: "Tool-specific mode (allowed tools: {{tools}})",
        processingFiles: "Processing files…",
      },
      actions: {
        regenerate: "Regenerate response",
        retryFailed: "Retry failed request",
        retryOptions: "Retry options",
        cancelRequest: "Cancel request",
        sendMessage: "Send message",
        copyMessage: "Copy message",
        referenceMessage: "Reference message",
        unpin: "Unpin",
        pin: "Pin",
        generateTitle: "Generate AI Title",
      },
      prompt: {
        selectorTitle: "Select System Prompt",
        createButton: "Create New Session",
        helperText: "Select a base system prompt for the AI. You can add or edit prompts in the System Settings.",
        emptyDescription: "No system prompts found. Add one in System Settings.",
      },
      fileReference: {
        title: "@ File Reference",
        setWorkspace: "Set Workspace",
        noMatches: "No matching files found",
        emptyDirectory: "Directory is empty",
      },
    },

    // Components
    components: {
      markdown: {
        codeCopiedSuccess: "Code copied to clipboard",
        copyFailed: "Copy failed",
      },
      jsonSchema: {
        field: "Field",
        type: "Type",
        required: "Required",
        yes: "Yes",
        no: "No",
        default: "Default",
        description: "Description",
        noProperties: "No properties in schema",
      },
    },

    // Validation
    validation: {
      workspaceRequired: "Please enter a workspace path",
      invalidPath: "Invalid path",
    },

    // Error messages
    error: {
      saveWorkspaceFailed: "Failed to save workspace path",
      readFolderFailed: "Unable to read folder",
      copyPromptFailed: "Failed to copy prompt content",
    },

    // Success messages
    success: {
      promptCopied: "Copied \"{{name}}\" prompt",
    },
  },

  zhCN: {
    // 通用按钮
    common: {
      cancel: "取消",
      ok: "确定",
      apply: "应用",
      save: "保存",
      delete: "删除",
      saveAnyway: "仍然保存",
      yes: "是",
      no: "否",
      home: "主页",
      parentDirectory: "上级目录",
      currentPath: "当前路径：",
      workspace: "工作区",
      server: "服务器：",
      category: "类别：",
      parameters: "参数",
      approve: "批准",
      reject: "拒绝",
      download: "下载",
      directory: "目录",
      file: "文件",
    },

    // 设置页面
    setup: {
      welcome: {
        title: "欢迎",
        heading: "欢迎使用 Bodhi",
        description: "让我们在进入主应用之前先设置您的环境。",
        skipInfo: "您现在可以跳过设置，稍后在系统设置中配置代理设置。",
      },
      steps: {
        welcome: "欢迎",
        proxy: "代理配置",
      },
      proxy: {
        title: "代理配置",
        info: "如果您在公司代理后面，请在下面配置。",
        providerInfo: "提供商配置稍后在提供商设置中完成。此设置步骤仅存储网络/代理设置。",
        detecting: "正在检测网络环境...",
        noProxyDetected: "未检测到现有代理。如果您的网络不需要代理，可以将这些字段留空。",
        httpProxyLabel: "HTTP 代理 URL：",
        httpsProxyLabel: "HTTPS 代理 URL：",
        httpProxyPlaceholder: "http://proxy.company.com:8080",
        httpsProxyPlaceholder: "http://proxy.company.com:8080",
        usernameLabel: "用户名",
        passwordLabel: "密码",
        rememberCredentials: "记住凭据（加密）",
      },
      complete: {
        title: "设置完成！",
        restartMessage: "请重启应用程序以应用所有设置。",
      },
      button: {
        next: "下一步",
        skipForNow: "暂时跳过",
        back: "返回",
        completeSetup: "完成设置",
        restart: "重启",
      },
      error: {
        loadStatusFailed: "无法加载设置状态。您可以继续进行手动代理配置。",
        invalidProxy: "代理设置无效。",
        credentialsUsername: "要存储代理凭据，请输入用户名或取消选中「记住凭据」。",
        saveProxyFailed: "保存代理配置失败。请重试。",
        completeFailed: "完成设置失败。请重试。",
      },
    },

    // 聊天工作区
    chat: {
      sidebar: {
        // 已存在: newSession
        empty: {
          noSessions: "暂无会话",
          hint: "点击「新建会话」开始",
        },
        dateGroups: {
          today: "今天",
          yesterday: "昨天",
          thisWeek: "本周",
          thisMonth: "本月",
          pinned: "置顶",
          scheduled: "计划任务",
        },
        actions: {
          collapseChildren: "折叠子会话",
          expandChildren: "展开子会话",
        },
      },
      workspace: {
        modalTitle: "设置工作区路径",
        invalidTitle: "无效的工作区路径",
        issuesDetected: "检测到工作区路径的潜在问题：",
        confirmSaveInvalid: "您仍要保存此路径吗？",
        placeholder: "例如：/Users/alice/Workspace/MyProject",
        label: "工作区",
        browseFolder: "浏览文件夹",
        descriptionTitle: "工作区路径描述",
        checkTitle: "工作区路径检查",
      },
      folderBrowser: {
        title: "选择工作区文件夹",
        selectCurrent: "选择当前文件夹",
        emptyFolder: "此文件夹为空",
        tip: "提示：点击文件夹进入，点击「选择当前文件夹」确认",
      },
      input: {
        placeholder: "发送消息...",
        placeholderWithReference: "发送消息（包含引用）",
        placeholderWithWorkflows: "发送消息...（输入 '/' 选择工作流）",
        toolCallsOnly: "仅工具调用（允许的工具：{{tools}}）",
        autoPrefixMode: "自动前缀模式：{{prefix}}（输入 '/' 选择工具）",
        toolSpecificMode: "工具特定模式（允许的工具：{{tools}}）",
        processingFiles: "正在处理文件…",
      },
      actions: {
        regenerate: "重新生成响应",
        retryFailed: "重试失败的请求",
        retryOptions: "重试选项",
        cancelRequest: "取消请求",
        sendMessage: "发送消息",
        copyMessage: "复制消息",
        referenceMessage: "引用消息",
        unpin: "取消置顶",
        pin: "置顶",
        generateTitle: "生成 AI 标题",
      },
      prompt: {
        selectorTitle: "选择系统提示词",
        createButton: "创建新会话",
        helperText: "为 AI 选择一个基础系统提示词。您可以在系统设置中添加或编辑提示词。",
        emptyDescription: "未找到系统提示词。在系统设置中添加一个。",
      },
      fileReference: {
        title: "@ 文件引用",
        setWorkspace: "设置工作区",
        noMatches: "未找到匹配的文件",
        emptyDirectory: "目录为空",
      },
    },

    // 组件
    components: {
      markdown: {
        codeCopiedSuccess: "代码已复制到剪贴板",
        copyFailed: "复制失败",
      },
      jsonSchema: {
        field: "字段",
        type: "类型",
        required: "必填",
        yes: "是",
        no: "否",
        default: "默认值",
        description: "描述",
        noProperties: "架构中无属性",
      },
    },

    // 验证
    validation: {
      workspaceRequired: "请输入工作区路径",
      invalidPath: "无效路径",
    },

    // 错误消息
    error: {
      saveWorkspaceFailed: "保存工作区路径失败",
      readFolderFailed: "无法读取文件夹",
      copyPromptFailed: "复制提示词内容失败",
    },

    // 成功消息
    success: {
      promptCopied: "已复制「{{name}}」提示词",
    },
  },
};
