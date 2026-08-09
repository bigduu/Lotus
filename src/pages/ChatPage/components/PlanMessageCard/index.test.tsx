import { fireEvent, render, screen } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { describe, expect, it, vi } from "vitest";

import type { PlanMessage } from "@shared/types/chat";
import PlanMessageCard from "./index";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "components.plan.executionPlan": "Execution plan",
        "components.plan.goal": "Goal",
        "components.plan.steps": "Steps",
        "components.plan.reason": "Reason",
        "components.plan.tools": "Tools",
        "components.plan.estimated": "Estimated",
        "components.plan.totalEstimatedTime": "Total estimated time",
        "components.plan.prerequisites": "Prerequisites",
        "components.plan.refinePlan": "Refine plan",
        "components.plan.executePlan": "Execute plan",
        "components.plan.sendFeedback": "Send feedback",
        "components.plan.feedbackPlaceholder": "Describe the requested changes",
        "common.cancel": "Cancel",
      };
      if (key === "components.plan.stepTitle") return `Step ${String(options?.number)}`;
      if (key === "components.plan.potentialRisks") {
        return `Potential risks (${String(options?.count)})`;
      }
      return translations[key] ?? key;
    },
  }),
}));

const PLAN: PlanMessage = {
  goal: "Ship reliable chat coverage",
  steps: [
    {
      step_number: 1,
      action: "Inspect the current contract",
      reason: "Avoid stale assumptions",
      tools_needed: ["Read", "Vitest"],
      estimated_time: "10 minutes",
    },
    {
      step_number: 2,
      action: "Add interaction tests",
      reason: "Protect user-visible behavior",
      tools_needed: ["Testing Library"],
      estimated_time: "20 minutes",
    },
  ],
  estimated_total_time: "30 minutes",
  prerequisites: ["Clean worktree"],
  risks: ["Over-mocking the behavior under test"],
};

const renderCard = (onExecute = vi.fn(), onRefine = vi.fn()) => {
  render(
    <AntdApp>
      <PlanMessageCard
        plan={PLAN}
        contextId="session-1"
        timestamp="09:30"
        onExecute={onExecute}
        onRefine={onRefine}
      />
    </AntdApp>,
  );
  return { onExecute, onRefine };
};

describe("PlanMessageCard", () => {
  it("renders the plan details and exposes risk and execute interactions", () => {
    const { onExecute } = renderCard();

    expect(screen.getByText("Ship reliable chat coverage")).toBeInTheDocument();
    expect(screen.getByText(/Step 1.*Inspect the current contract/)).toBeInTheDocument();
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("Clean worktree")).toBeInTheDocument();
    expect(screen.getByText("30 minutes")).toBeInTheDocument();
    expect(screen.getByText("09:30")).toBeInTheDocument();

    expect(screen.queryByText("Over-mocking the behavior under test")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Potential risks (1)"));
    expect(screen.getByText("Over-mocking the behavior under test")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Execute plan/ }));
    expect(onExecute).toHaveBeenCalledTimes(1);
  });

  it("requires non-whitespace feedback, submits it, and exits refine mode", () => {
    const { onRefine } = renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Refine plan" }));
    const feedback = screen.getByPlaceholderText("Describe the requested changes");
    const send = screen.getByRole("button", { name: "Send feedback" });
    expect(send).toBeDisabled();

    fireEvent.change(feedback, { target: { value: "   " } });
    expect(send).toBeDisabled();

    fireEvent.change(feedback, { target: { value: "Add an explicit rollback step" } });
    expect(send).toBeEnabled();
    fireEvent.click(send);

    expect(onRefine).toHaveBeenCalledWith("Add an explicit rollback step");
    expect(screen.queryByPlaceholderText("Describe the requested changes")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refine plan" })).toBeInTheDocument();
  });
});
