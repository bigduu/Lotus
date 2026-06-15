import { ChatItem } from "@shared/types/chat";

export const parseTimestampMs = (value?: string): number | null => {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const areModelRefsEqual = (
  a: ChatItem["config"]["model_ref"],
  b: ChatItem["config"]["model_ref"],
): boolean => {
  if (a === b) return true;
  if (!a || !b) return a == null && b == null;
  return a.provider === b.provider && a.model === b.model;
};

const areTokenUsagesEqual = (
  a: ChatItem["config"]["tokenUsage"],
  b: ChatItem["config"]["tokenUsage"],
): boolean => {
  if (a === b) return true;
  if (!a || !b) return a == null && b == null;
  return (
    a.systemTokens === b.systemTokens &&
    a.summaryTokens === b.summaryTokens &&
    a.windowTokens === b.windowTokens &&
    a.totalTokens === b.totalTokens &&
    (a.maxContextTokens ?? 0) === (b.maxContextTokens ?? 0) &&
    a.budgetLimit === b.budgetLimit &&
    (a.promptCachedToolOutputs ?? 0) === (b.promptCachedToolOutputs ?? 0) &&
    (a.promptCachedToolTokensSaved ?? 0) === (b.promptCachedToolTokensSaved ?? 0) &&
    (a.thinkingTokens ?? 0) === (b.thinkingTokens ?? 0) &&
    (a.cacheReadInputTokens ?? 0) === (b.cacheReadInputTokens ?? 0)
  );
};

const areCompressionEventsEqual = (
  a: ChatItem["config"]["compressionEvents"],
  b: ChatItem["config"]["compressionEvents"],
): boolean => {
  if (a === b) return true;
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  return left.every((event, index) => {
    const other = right[index];
    return (
      Boolean(other) &&
      event.id === other.id &&
      event.createdAt === other.createdAt &&
      event.messagesCompressed === other.messagesCompressed &&
      event.segmentsRemoved === other.segmentsRemoved
    );
  });
};

const areSyncCursorsEqual = (
  a: ChatItem["config"]["syncCursor"],
  b: ChatItem["config"]["syncCursor"],
): boolean => {
  if (a === b) return true;
  if (!a || !b) return a == null && b == null;
  return (
    a.messageCount === b.messageCount &&
    a.lastMessageId === b.lastMessageId &&
    a.hasPendingQuestion === b.hasPendingQuestion &&
    a.pendingQuestionToolCallId === b.pendingQuestionToolCallId
  );
};

const areChatConfigsEquivalent = (a: ChatItem["config"], b: ChatItem["config"]): boolean => {
  if (a === b) return true;
  return (
    a.systemPromptId === b.systemPromptId &&
    a.baseSystemPrompt === b.baseSystemPrompt &&
    a.lastUsedEnhancedPrompt === b.lastUsedEnhancedPrompt &&
    a.agentRole === b.agentRole &&
    a.workspacePath === b.workspacePath &&
    a.model === b.model &&
    areModelRefsEqual(a.model_ref, b.model_ref) &&
    a.reasoningEffort === b.reasoningEffort &&
    JSON.stringify(a.goldConfig ?? null) === JSON.stringify(b.goldConfig ?? null) &&
    JSON.stringify(a.goalState ?? null) === JSON.stringify(b.goalState ?? null) &&
    areTokenUsagesEqual(a.tokenUsage, b.tokenUsage) &&
    a.truncationOccurred === b.truncationOccurred &&
    a.segmentsRemoved === b.segmentsRemoved &&
    areCompressionEventsEqual(a.compressionEvents, b.compressionEvents) &&
    areSyncCursorsEqual(a.syncCursor, b.syncCursor)
  );
};

export const canReuseSessionListChat = (prev: ChatItem, next: ChatItem): boolean => {
  return (
    prev.id === next.id &&
    prev.kind === next.kind &&
    prev.parentSessionId === next.parentSessionId &&
    prev.rootSessionId === next.rootSessionId &&
    prev.spawnDepth === next.spawnDepth &&
    prev.createdByScheduleId === next.createdByScheduleId &&
    prev.isRunning === next.isRunning &&
    prev.updatedAt === next.updatedAt &&
    prev.lastActivityAt === next.lastActivityAt &&
    prev.messageCount === next.messageCount &&
    prev.hasAttachments === next.hasAttachments &&
    prev.lastRunStatus === next.lastRunStatus &&
    prev.lastRunError === next.lastRunError &&
    prev.planMode === next.planMode &&
    prev.subagentType === next.subagentType &&
    prev.title === next.title &&
    prev.titleVersion === next.titleVersion &&
    prev.createdAt === next.createdAt &&
    prev.pinned === next.pinned &&
    prev.messages === next.messages &&
    areChatConfigsEquivalent(prev.config, next.config)
  );
};
