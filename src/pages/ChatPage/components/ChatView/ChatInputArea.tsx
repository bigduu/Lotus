import React from "react";
import { Flex } from "antd";

import { InputContainer } from "../InputContainer";
import type { WorkflowDraft } from "../InputContainer";
import ActiveToolMessageCard, {
  type SessionDiffSummary,
} from "./ActiveToolMessageCard";

type ChatInputAreaProps = {
  sessionId: string | null;
  isCenteredLayout: boolean;
  maxWidth: string;
  onWorkflowDraftChange: (draft: WorkflowDraft | null) => void;
  showMessagesView: boolean;
  sessionDiffSummary: SessionDiffSummary | null;
};

export const ChatInputArea: React.FC<ChatInputAreaProps> = ({
  sessionId,
  isCenteredLayout,
  maxWidth,
  onWorkflowDraftChange,
  showMessagesView,
  sessionDiffSummary,
}) => {
  return (
    <Flex
      justify="center"
      className={`chat-view-input-container-wrapper ${
        showMessagesView ? "messages-view" : "centered-view"
      }`}
    >
      <div
        style={{
          width: "100%",
          maxWidth,
          margin: showMessagesView ? "0 auto" : undefined,
          position: "relative",
        }}
      >
        {showMessagesView && (
          <ActiveToolMessageCard
            sessionDiffSummary={sessionDiffSummary}
            sessionId={sessionId}
          />
        )}
        <InputContainer
          sessionId={sessionId}
          isCenteredLayout={isCenteredLayout}
          onWorkflowDraftChange={onWorkflowDraftChange}
        />
      </div>
    </Flex>
  );
};
