import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConversationMetaStrip } from "./ConversationMetaStrip";

const storeState = {
  chats: [
    {
      id: "session-1",
      activeWorkflow: {
        id: "review",
        name: "Review",
        source: "project",
        revision: 12,
        version: "4",
        kind: "instruction",
        invokedBy: "model",
        activatedAt: "2026-08-23T08:00:00Z",
        status: "active",
      },
    },
  ],
};

vi.mock("@shared/store/appStore", () => ({
  useAppStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
  selectSessionById: (sessionId: string | null) => (state: typeof storeState) =>
    state.chats.find((chat) => chat.id === sessionId) ?? null,
}));

const translations: Record<string, string> = {
  "chat.workflowSelection.active": "Active Workflow",
  "chat.workflowSelection.invocationAutomatic": "Automatic",
  "chat.workflowSelection.invocationExplicit": "Explicit",
  "chat.workflowSelection.invokedByUser": "User",
  "chat.workflowSelection.invokedByModel": "Model",
  "chat.workflowSelection.invokedByApi": "API",
};

const renderStrip = () =>
  render(
    <ConversationMetaStrip
      sessionId="session-1"
      auxReady={false}
      maxWidth="960px"
      paddingLeft={16}
      paddingRight={16}
      workspaceState={{
        isEmbedded: false,
        leafCount: 1,
        isMultiPane: false,
        isMobileViewport: false,
        inspectorMode: "rail",
        inspectorTogglePlacement: "meta_strip",
      }}
      inspectorEligible={false}
      planMode={null}
      t={((key: string) => translations[key] ?? key) as any}
    />,
  );

describe("ConversationMetaStrip active Workflow", () => {
  it("shows model invocation as automatic", () => {
    renderStrip();
    expect(screen.getByText("Active Workflow: Review · Automatic")).toBeInTheDocument();
  });

  it("shows API invocation as explicit", () => {
    storeState.chats[0].activeWorkflow.invokedBy = "api";
    renderStrip();
    expect(screen.getByText("Active Workflow: Review · Explicit")).toBeInTheDocument();
    storeState.chats[0].activeWorkflow.invokedBy = "model";
  });
});
