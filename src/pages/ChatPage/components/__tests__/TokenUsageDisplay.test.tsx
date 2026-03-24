import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import i18n from "@shared/i18n";
import {
  TokenUsageBadge,
  TokenUsageDisplay,
} from "../TokenUsageDisplay";
import type { TokenUsage } from "../../types/tokenBudget";

vi.mock("antd", () => ({
  Progress: vi.fn((props: any) => (
    <div
      data-testid="progress"
      data-percent={String(props.percent)}
      data-stroke-color={String(props.strokeColor)}
      data-height={String(props.size?.height)}
      data-width={String(props.size?.width)}
    />
  )),
  Tooltip: vi.fn(({ title, children }: any) => (
    <div data-testid="tooltip">
      {children}
      <div data-testid="tooltip-title">{title}</div>
    </div>
  )),
  Space: vi.fn(({ children, className }: any) => (
    <div data-testid="space" className={className}>
      {children}
    </div>
  )),
}));

const makeUsage = (overrides?: Partial<TokenUsage>): TokenUsage => ({
  systemTokens: 100,
  summaryTokens: 0,
  windowTokens: 400,
  totalTokens: 500,
  budgetLimit: 1000,
  ...overrides,
});

describe("TokenUsageDisplay", () => {
  it("renders success color for low usage and hides summary row when summaryTokens is 0", () => {
    render(
      <TokenUsageDisplay usage={makeUsage({ totalTokens: 200, budgetLimit: 1000 })} />,
    );

    expect(screen.getByTestId("progress")).toHaveAttribute(
      "data-stroke-color",
      "#52c41a",
    );
    expect(screen.getByText("20%")).toBeInTheDocument();
    expect(screen.getByText("Token Usage")).toBeInTheDocument();
    expect(screen.queryByText(/Summary:/)).toBeNull();
  });

  it("renders warning color for usage >= 70%", () => {
    render(
      <TokenUsageDisplay usage={makeUsage({ totalTokens: 700, budgetLimit: 1000 })} />,
    );

    expect(screen.getByTestId("progress")).toHaveAttribute(
      "data-stroke-color",
      "#faad14",
    );
    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(
      screen.getByText(
        i18n.t("components.tokenUsage.usedPercent", { value: "70.0" }),
      ),
    ).toBeInTheDocument();
  });

  it("renders error color for usage >= 90%", () => {
    render(
      <TokenUsageDisplay usage={makeUsage({ totalTokens: 950, budgetLimit: 1000 })} />,
    );

    expect(screen.getByTestId("progress")).toHaveAttribute(
      "data-stroke-color",
      "#ff4d4f",
    );
    expect(screen.getByText("95%")).toBeInTheDocument();
  });

  it("caps progress at 100 while keeping percentage text uncapped", () => {
    render(
      <TokenUsageDisplay
        usage={makeUsage({ totalTokens: 1500, budgetLimit: 1000 })}
        size="default"
      />,
    );

    const progress = screen.getByTestId("progress");
    expect(progress).toHaveAttribute("data-percent", "100");
    expect(progress).toHaveAttribute("data-height", "8");
    expect(screen.getByText("150%")).toBeInTheDocument();
  });

  it("hides detailed section when showDetails is false", () => {
    render(
      <TokenUsageDisplay
        usage={makeUsage({ totalTokens: 400, budgetLimit: 1000, summaryTokens: 50 })}
        showDetails={false}
      />,
    );

    expect(screen.queryByText(/System:/)).toBeNull();
    expect(screen.queryByText(/Summary:/)).toBeNull();
    expect(screen.queryByText(/Messages:/)).toBeNull();
  });

  it("shows summary detail row when summaryTokens is positive", () => {
    render(
      <TokenUsageDisplay
        usage={makeUsage({ totalTokens: 450, budgetLimit: 1000, summaryTokens: 30 })}
      />,
    );

    expect(screen.getByText("Summary: 30")).toBeInTheDocument();
    expect(screen.getByText("System: 100")).toBeInTheDocument();
    expect(screen.getByText("Messages: 400")).toBeInTheDocument();
  });
});

describe("TokenUsageBadge", () => {
  it("uses default badge color path for low usage", () => {
    const { container } = render(
      <TokenUsageBadge
        usage={makeUsage({ totalTokens: 20, budgetLimit: 1000 })}
        className="custom-badge"
      />,
    );

    const badge = container.querySelector(".token-usage-badge") as HTMLElement;
    expect(badge).toHaveClass("custom-badge");
    expect(badge.textContent).toBe("2%");
    expect(badge.style.color).toBe("rgb(191, 191, 191)");
    expect(screen.getByText(/20 \/ 1,000 tokens/)).toBeInTheDocument();
  });

  it("uses success, warning and error badge colors based on usage", () => {
    const { rerender, container } = render(
      <TokenUsageBadge usage={makeUsage({ totalTokens: 500, budgetLimit: 1000 })} />,
    );
    let badge = container.querySelector(".token-usage-badge") as HTMLElement;
    expect(badge.style.color).toBe("rgb(82, 196, 26)");

    rerender(<TokenUsageBadge usage={makeUsage({ totalTokens: 750, budgetLimit: 1000 })} />);
    badge = container.querySelector(".token-usage-badge") as HTMLElement;
    expect(badge.style.color).toBe("rgb(250, 173, 20)");

    rerender(<TokenUsageBadge usage={makeUsage({ totalTokens: 950, budgetLimit: 1000 })} />);
    badge = container.querySelector(".token-usage-badge") as HTMLElement;
    expect(badge.style.color).toBe("rgb(255, 77, 79)");
  });
});
