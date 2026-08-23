import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SessionInspectorPane } from "./SessionInspectorPane";

const chat = {
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
  config: {},
};
const appState = { chats: [chat], setInputContent: vi.fn() };

vi.mock("@shared/store/appStore", () => ({
  useAppStore: (selector: (state: typeof appState) => unknown) => selector(appState),
  selectSessionById: (sessionId: string | null) => (state: typeof appState) =>
    state.chats.find((item) => item.id === sessionId) ?? null,
}));

vi.mock("@shared/store/uiLayoutStore", () => ({
  useUILayoutStore: (selector: (state: any) => unknown) =>
    selector({ inspector: { widthPx: 360, minWidthPx: 280, maxWidthPx: 640 } }),
}));

vi.mock("@shared/hooks/useMediaQuery", () => ({ useIsMobile: () => false }));
vi.mock("@shared/store/experienceModeStore", () => ({
  useExperienceModeStore: (selector: (state: any) => unknown) => selector({ isAdvanced: false }),
}));
vi.mock("@shared/store/appStore/slices/providerSlice", () => ({
  useProviderStore: (selector: (state: any) => unknown) => selector({ providerInstances: [] }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "inspector.title": "Inspector",
        "inspector.activeWorkflow": "Active Workflow",
        "chat.workflowSelection.invocationAutomatic": "Automatic",
        "chat.workflowSelection.invocationExplicit": "Explicit",
        "chat.workflowSelection.invokedByUser": "User",
        "chat.workflowSelection.invokedByModel": "Model",
        "chat.workflowSelection.invokedByApi": "API",
      })[key] ?? key,
  }),
}));

describe("SessionInspectorPane active Workflow", () => {
  it("shows the full public receipt and automatic/model invocation source", () => {
    render(
      <SessionInspectorPane
        sessionId="session-1"
        auxReady={false}
        mode="rail"
        open
        onOpenChange={vi.fn()}
        showMessagesView={false}
        shouldShowTaskPanel={false}
        hasSubAgents={false}
        sessionDiffSummary={null}
      />,
    );

    expect(screen.getByTestId("active-workflow-card")).toBeInTheDocument();
    expect(screen.getByText("Active Workflow")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByText("instruction")).toBeInTheDocument();
    expect(screen.getByText("project")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Automatic · Model")).toBeInTheDocument();
  });
});
