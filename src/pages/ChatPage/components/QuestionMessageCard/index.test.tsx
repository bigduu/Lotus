import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { describe, expect, it, vi } from "vitest";

import type { QuestionMessage } from "@shared/types/chat";
import QuestionMessageCard from "./index";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "components.question.agentQuestion": "Agent question",
        "components.question.context": "Context",
        "components.question.chooseOption": "Choose an option",
        "components.question.recommended": "Recommended",
        "components.question.customAnswerHint": "You can provide a custom answer",
        "components.question.customAnswerPlaceholder": "Type a custom answer",
        "components.question.submitAnswer": "Submit answer",
      })[key] ?? key,
  }),
}));

const QUESTION: QuestionMessage = {
  type: "question",
  question: "How should the migration proceed?",
  context: "The existing data must remain available.",
  severity: "major",
  default: "safe",
  allow_custom: true,
  options: [
    {
      label: "Safe rollout",
      value: "safe",
      description: "Migrate in reversible stages.",
    },
    {
      label: "Fast rollout",
      value: "fast",
      description: "Migrate everything immediately.",
    },
  ],
};

const renderCard = (onAnswer = vi.fn(), disabled = false) =>
  render(
    <AntdApp>
      <QuestionMessageCard
        question={QUESTION}
        contextId="session-1"
        timestamp="10:15"
        disabled={disabled}
        onAnswer={onAnswer}
      />
    </AntdApp>,
  );

describe("QuestionMessageCard", () => {
  it("renders severity/context and submits the selected option", async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    renderCard(onAnswer);

    expect(screen.getByText("How should the migration proceed?")).toBeInTheDocument();
    expect(screen.getByText("The existing data must remain available.")).toBeInTheDocument();
    expect(screen.getByText("(major)")).toBeInTheDocument();
    expect(screen.getByText("Recommended")).toBeInTheDocument();
    expect(screen.getByText("10:15")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Safe rollout/ })).toBeChecked();

    fireEvent.click(screen.getByText("Fast rollout"));
    expect(screen.getByRole("radio", { name: /Fast rollout/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /Submit answer/ }));

    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith("fast"));
  });

  it("locks choices while an asynchronous answer is being submitted", async () => {
    let resolveAnswer!: () => void;
    const answerPromise = new Promise<void>((resolve) => {
      resolveAnswer = resolve;
    });
    const onAnswer = vi.fn(() => answerPromise);
    renderCard(onAnswer);

    fireEvent.click(screen.getByRole("button", { name: /Submit answer/ }));

    await waitFor(() => {
      expect(onAnswer).toHaveBeenCalledWith("safe");
      expect(screen.getByRole("radio", { name: /Safe rollout/ })).toBeDisabled();
      expect(screen.getByPlaceholderText("Type a custom answer")).toBeDisabled();
    });

    await act(async () => {
      resolveAnswer();
      await answerPromise;
    });

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: /Safe rollout/ })).toBeEnabled();
      expect(screen.getByPlaceholderText("Type a custom answer")).toBeEnabled();
    });
  });

  it("submits a custom answer and honors the disabled contract", async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderCard(onAnswer);

    fireEvent.change(screen.getByPlaceholderText("Type a custom answer"), {
      target: { value: "Roll out one workspace at a time" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Submit answer/ }));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith("Roll out one workspace at a time"));

    unmount();
    const disabledAnswer = vi.fn();
    renderCard(disabledAnswer, true);
    expect(screen.getByRole("radio", { name: /Safe rollout/ })).toBeDisabled();
    expect(screen.getByPlaceholderText("Type a custom answer")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Submit answer/ })).toBeDisabled();
    fireEvent.click(screen.getByText("Fast rollout"));
    expect(disabledAnswer).not.toHaveBeenCalled();
  });
});
