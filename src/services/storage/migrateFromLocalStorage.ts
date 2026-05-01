import { StorageManager } from "./StorageManager";

/**
 * 一次性迁移工具：将 localStorage 中的累积型数据迁移到 IndexedDB
 * 在 App 启动时调用一次
 */
export async function migrateFromLocalStorage(): Promise<void> {
  const manager = StorageManager.getInstance();

  // 迁移 Model Options Cache
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("chat-model-options-cache-v1:")) {
      const provider = key.split(":")[1];
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.options)) {
            await manager.saveModelOptionsCache(provider, parsed.options, parsed.timestamp);
            localStorage.removeItem(key);
          }
        }
      } catch {
        // 损坏的数据直接删除
        localStorage.removeItem(key);
      }
    }
  }

  // 迁移 Diff Collapse
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("chat-session-diff-collapse:")) {
      const sessionId = key.split(":")[1];
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.isExpanded === "boolean") {
            await manager.saveDiffCollapse(sessionId, {
              isExpanded: parsed.isExpanded,
              expandedFiles: parsed.expandedFiles || [],
            });
            localStorage.removeItem(key);
          }
        }
      } catch {
        localStorage.removeItem(key);
      }
    }
  }

  // 迁移 Tool Session Collapse
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("chat-session-tool-collapse:")) {
      const parts = key.split(":");
      if (parts.length >= 3) {
        const sessionId = parts[1];
        const toolSessionId = parts.slice(2).join(":"); // handle colons in toolSessionId
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.isExpanded === "boolean") {
              await manager.saveToolSessionCollapse(sessionId, toolSessionId, {
                isExpanded: parsed.isExpanded,
                expandedTools: parsed.expandedTools || [],
              });
              localStorage.removeItem(key);
            }
          }
        } catch {
          localStorage.removeItem(key);
        }
      }
    }
  }

  // 迁移 Input Reasoning
  try {
    const raw = localStorage.getItem("chat_input_reasoning_by_session_v1");
    if (raw) {
      const bySession = JSON.parse(raw);
      for (const [sessionId, effort] of Object.entries(bySession)) {
        if (typeof effort === "string") {
          await manager.saveInputReasoning(sessionId, effort);
        }
      }
      localStorage.removeItem("chat_input_reasoning_by_session_v1");
    }
  } catch {
    localStorage.removeItem("chat_input_reasoning_by_session_v1");
  }

  // 迁移 Last Used Reasoning
  try {
    const raw = localStorage.getItem("chat_input_reasoning_last_used_v1");
    if (raw && typeof raw === "string") {
      await manager.saveLastUsedReasoningEffort(raw);
      localStorage.removeItem("chat_input_reasoning_last_used_v1");
    }
  } catch {
    localStorage.removeItem("chat_input_reasoning_last_used_v1");
  }

  // 迁移 Scroll Anchors v2
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("chat_scroll_anchor_v2:")) {
      const sessionId = key.split(":")[1];
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.v === 1 && typeof parsed.anchorId === "string") {
            await manager.saveScrollAnchor(sessionId, parsed);
            localStorage.removeItem(key);
          }
        }
      } catch {
        localStorage.removeItem(key);
      }
    }
  }

  // 清理旧的全量 scroll anchor key
  localStorage.removeItem("chat_scroll_anchors_v1");
}
