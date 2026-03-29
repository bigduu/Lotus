import React from "react";
import { Flex } from "antd";

import { InputContainer } from "../InputContainer";
import type { WorkflowDraft } from "../InputContainer";
import ActiveToolMessageCard, { type SessionDiffSummary } from "./ActiveToolMessageCard";
import EmptyTaskLauncher from "../EmptyTaskLauncher";

type ChatInputAreaProps = {
  sessionId: string | null;
  isCenteredLayout: boolean;
  maxWidth: string;
  onWorkflowDraftChange: (draft: WorkflowDraft | null) => void;
  showMessagesView: boolean;
  sessionDiffSummary: SessionDiffSummary | null;
  contextUsageIndicator?: React.ReactNode;
};

export const ChatInputArea: React.FC<ChatInputAreaProps> = ({
  sessionId,
  isCenteredLayout,
  maxWidth,
  onWorkflowDraftChange,
  showMessagesView,
  sessionDiffSummary,
  contextUsageIndicator,
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
          maxWidth: showMessagesView ? "clamp(720px, 68vw, 1240px)" : maxWidth,
          margin: showMessagesView ? "0 auto" : undefined,
          position: "relative",
          paddingBottom: showMessagesView ? 12 : 0,
          display: "flex",
          flexDirection: "column",
          gap: showMessagesView ? 0 : 24,
        }}
      >
        {showMessagesView && (
          <ActiveToolMessageCard sessionDiffSummary={sessionDiffSummary} sessionId={sessionId} />
        )}
        {!showMessagesView && sessionId && <EmptyTaskLauncher sessionId={sessionId} />}
        <InputContainer
          sessionId={sessionId}
          isCenteredLayout={isCenteredLayout}
          onWorkflowDraftChange={onWorkflowDraftChange}
          statusIndicator={contextUsageIndicator}
        />
      </div>
    </Flex>
  );
};
