import { storageDb } from "./StorageDb";
import type { ScrollAnchorV1 } from "../../pages/ChatPage/components/ChatView/scrollAnchorStorage";

export interface ModelOption {
  value: string;
  label: string;
}

export class StorageManager {
  private static instance: StorageManager;
  private db = storageDb;

  static getInstance(): StorageManager {
    if (!StorageManager.instance) {
      StorageManager.instance = new StorageManager();
    }
    return StorageManager.instance;
  }

  // ========== Scroll Anchors ==========
  async saveScrollAnchor(sessionId: string, anchor: ScrollAnchorV1): Promise<void> {
    try {
      await this.db.scrollAnchors.put({
        sessionId,
        anchorId: anchor.anchorId,
        offsetPx: anchor.offsetPx,
        ts: anchor.ts,
        indexHint: anchor.indexHint,
        createdAt: anchor.createdAt,
      });
    } catch (err) {
      console.warn("[StorageManager] IndexedDB save failed, falling back to localStorage", err);
      // fallback to v2 per-session localStorage
      try {
        localStorage.setItem(`chat_scroll_anchor_v2:${sessionId}`, JSON.stringify(anchor));
      } catch {
        // ignore
      }
    }
  }

  async loadScrollAnchor(sessionId: string): Promise<ScrollAnchorV1 | null> {
    try {
      const record = await this.db.scrollAnchors.get(sessionId);
      if (!record) return null;
      return {
        v: 1,
        anchorId: record.anchorId,
        offsetPx: record.offsetPx,
        ts: record.ts,
        indexHint: record.indexHint,
        createdAt: record.createdAt,
      };
    } catch {
      // fallback to localStorage
      try {
        const raw = localStorage.getItem(`chat_scroll_anchor_v2:${sessionId}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && parsed.v === 1 && typeof parsed.anchorId === "string") {
          return parsed as ScrollAnchorV1;
        }
      } catch {
        // ignore
      }
      return null;
    }
  }

  async clearScrollAnchor(sessionId: string): Promise<void> {
    try {
      await this.db.scrollAnchors.delete(sessionId);
    } catch {
      // ignore
    }
    try {
      localStorage.removeItem(`chat_scroll_anchor_v2:${sessionId}`);
    } catch {
      // ignore
    }
  }

  // ========== Tool Session Collapses ==========
  async saveToolSessionCollapse(
    sessionId: string,
    toolSessionId: string,
    state: { isExpanded: boolean; expandedTools: string[] },
  ): Promise<void> {
    try {
      await this.db.toolSessionCollapses.put({
        id: `${sessionId}:${toolSessionId}`,
        sessionId,
        toolSessionId,
        isExpanded: state.isExpanded,
        expandedTools: state.expandedTools,
        updatedAt: Date.now(),
      });
    } catch (err) {
      console.warn("[StorageManager] saveToolSessionCollapse failed", err);
      try {
        localStorage.setItem(
          `chat-session-tool-collapse:${sessionId}:${toolSessionId}`,
          JSON.stringify(state),
        );
      } catch {
        // ignore
      }
    }
  }

  async loadToolSessionCollapse(
    sessionId: string,
    toolSessionId: string,
  ): Promise<{ isExpanded: boolean; expandedTools: string[] } | null> {
    try {
      const record = await this.db.toolSessionCollapses.get(`${sessionId}:${toolSessionId}`);
      if (!record) return null;
      return { isExpanded: record.isExpanded, expandedTools: record.expandedTools };
    } catch {
      try {
        const raw = localStorage.getItem(
          `chat-session-tool-collapse:${sessionId}:${toolSessionId}`,
        );
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.isExpanded === "boolean") {
          return parsed;
        }
      } catch {
        // ignore
      }
      return null;
    }
  }

  // ========== Diff Collapses ==========
  async saveDiffCollapse(
    sessionId: string,
    state: { isExpanded: boolean; expandedFiles: string[] },
  ): Promise<void> {
    try {
      await this.db.diffCollapses.put({
        sessionId,
        isExpanded: state.isExpanded,
        expandedFiles: state.expandedFiles,
        updatedAt: Date.now(),
      });
    } catch (err) {
      console.warn("[StorageManager] saveDiffCollapse failed", err);
      try {
        localStorage.setItem(`chat-session-diff-collapse:${sessionId}`, JSON.stringify(state));
      } catch {
        // ignore
      }
    }
  }

  async loadDiffCollapse(
    sessionId: string,
  ): Promise<{ isExpanded: boolean; expandedFiles: string[] } | null> {
    try {
      const record = await this.db.diffCollapses.get(sessionId);
      if (!record) return null;
      return { isExpanded: record.isExpanded, expandedFiles: record.expandedFiles };
    } catch {
      try {
        const raw = localStorage.getItem(`chat-session-diff-collapse:${sessionId}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.isExpanded === "boolean") {
          return parsed;
        }
      } catch {
        // ignore
      }
      return null;
    }
  }

  // ========== Input State (Reasoning) ==========
  async saveInputReasoning(sessionId: string, reasoningEffort: string): Promise<void> {
    try {
      const existing = await this.db.inputStates.get(sessionId);
      await this.db.inputStates.put({
        sessionId,
        reasoningEffort,
        content: existing?.content,
        referenceText: existing?.referenceText,
        updatedAt: Date.now(),
      });
    } catch (err) {
      console.warn("[StorageManager] saveInputReasoning failed", err);
      try {
        const raw = localStorage.getItem("chat_input_reasoning_by_session_v1");
        const bySession = raw ? JSON.parse(raw) : {};
        bySession[sessionId] = reasoningEffort;
        localStorage.setItem("chat_input_reasoning_by_session_v1", JSON.stringify(bySession));
      } catch {
        // ignore
      }
    }
  }

  async loadInputReasoning(sessionId: string): Promise<string | null> {
    try {
      const record = await this.db.inputStates.get(sessionId);
      return record?.reasoningEffort ?? null;
    } catch {
      try {
        const raw = localStorage.getItem("chat_input_reasoning_by_session_v1");
        if (!raw) return null;
        const bySession = JSON.parse(raw);
        return bySession[sessionId] ?? null;
      } catch {
        return null;
      }
    }
  }

  async saveLastUsedReasoningEffort(reasoningEffort: string): Promise<void> {
    try {
      await this.db.inputStates.put({
        sessionId: "__last_used__",
        reasoningEffort,
        updatedAt: Date.now(),
      });
    } catch {
      try {
        localStorage.setItem("chat_input_reasoning_last_used_v1", reasoningEffort);
      } catch {
        // ignore
      }
    }
  }

  async loadLastUsedReasoningEffort(): Promise<string | null> {
    try {
      const record = await this.db.inputStates.get("__last_used__");
      return record?.reasoningEffort ?? null;
    } catch {
      try {
        return localStorage.getItem("chat_input_reasoning_last_used_v1");
      } catch {
        return null;
      }
    }
  }

  // ========== Model Options Cache ==========
  async saveModelOptionsCache(
    provider: string,
    options: ModelOption[],
    timestamp: number,
  ): Promise<void> {
    try {
      await this.db.modelOptionsCaches.put({ provider, options, timestamp });
    } catch (err) {
      console.warn("[StorageManager] saveModelOptionsCache failed", err);
      try {
        localStorage.setItem(
          `chat-model-options-cache-v1:${provider}`,
          JSON.stringify({ timestamp, options }),
        );
      } catch {
        // ignore
      }
    }
  }

  async loadModelOptionsCache(
    provider: string,
  ): Promise<{ options: ModelOption[]; timestamp: number } | null> {
    try {
      const record = await this.db.modelOptionsCaches.get(provider);
      if (!record) return null;
      return { options: record.options, timestamp: record.timestamp };
    } catch {
      try {
        const raw = localStorage.getItem(`chat-model-options-cache-v1:${provider}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.options)) {
          return { options: parsed.options, timestamp: parsed.timestamp };
        }
      } catch {
        // ignore
      }
      return null;
    }
  }

  // ========== Cleanup APIs ==========
  async clearSessionData(sessionId: string): Promise<void> {
    try {
      await Promise.all([
        this.db.scrollAnchors.delete(sessionId),
        this.db.diffCollapses.delete(sessionId),
        this.db.toolSessionCollapses.where("sessionId").equals(sessionId).delete(),
        this.db.inputStates.delete(sessionId),
      ]);
    } catch {
      // ignore
    }
  }

  async cleanupStaleData(maxAgeDays: number = 30): Promise<void> {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    try {
      await Promise.all([
        this.db.scrollAnchors.where("ts").below(cutoff).delete(),
        this.db.toolSessionCollapses.where("updatedAt").below(cutoff).delete(),
        this.db.diffCollapses.where("updatedAt").below(cutoff).delete(),
        this.db.inputStates.where("updatedAt").below(cutoff).delete(),
        this.db.modelOptionsCaches.where("timestamp").below(cutoff).delete(),
      ]);
    } catch {
      // ignore
    }
  }

  async getStats(): Promise<Record<string, number>> {
    try {
      const [scrollAnchors, toolSessionCollapses, diffCollapses, inputStates, modelOptionsCaches] =
        await Promise.all([
          this.db.scrollAnchors.count(),
          this.db.toolSessionCollapses.count(),
          this.db.diffCollapses.count(),
          this.db.inputStates.count(),
          this.db.modelOptionsCaches.count(),
        ]);
      return {
        scrollAnchors,
        toolSessionCollapses,
        diffCollapses,
        inputStates,
        modelOptionsCaches,
      };
    } catch {
      return {
        scrollAnchors: 0,
        toolSessionCollapses: 0,
        diffCollapses: 0,
        inputStates: 0,
        modelOptionsCaches: 0,
      };
    }
  }
}
