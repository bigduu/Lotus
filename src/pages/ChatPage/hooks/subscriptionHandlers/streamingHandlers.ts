import type { AgentEventHandlers } from "@services/chat/AgentService";
import { streamingMessageBus } from "../../utils/streamingMessageBus";
import {
  appendAssistantReasoningChunk,
  appendAssistantStreamingChunk,
} from "../../streaming/assistantStreamingAtoms";
import type { RunContext } from "../subscriptionContext";

/** Assistant text/reasoning token handlers. */
export function createStreamingHandlers(run: RunContext): Partial<AgentEventHandlers> {
  const { sessionId, generation, setStreamingStatus } = run;
  const { markStreamStartedOnce, streamingStateBySessionRef } = run.ctx;
  return {
    onToken: (tokenContent: string) => {
      markStreamStartedOnce(sessionId, generation);
      const state = streamingStateBySessionRef.current.get(sessionId);
      if (!state) return;
      setStreamingStatus(null);
      state.content += tokenContent;
      appendAssistantStreamingChunk(state.sessionId, tokenContent);
      streamingMessageBus.publish({
        sessionId: state.sessionId,
        messageId: state.messageId,
        content: tokenContent,
        transient: true,
      });
    },

    onReasoningToken: (tokenContent: string) => {
      markStreamStartedOnce(sessionId, generation);
      const state = streamingStateBySessionRef.current.get(sessionId);
      if (!state) return;
      state.reasoningContent += tokenContent;
      appendAssistantReasoningChunk(state.sessionId, tokenContent);
      streamingMessageBus.publish({
        sessionId: state.sessionId,
        messageId: state.reasoningMessageId,
        content: tokenContent,
        transient: true,
      });
    },
  };
}
