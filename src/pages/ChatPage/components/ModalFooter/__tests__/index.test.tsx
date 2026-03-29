import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import {
  ModalFooter,
  createCancelButton,
  createOkButton,
  createApplyButton,
  createSaveButton,
  createDeleteButton,
  type ModalFooterButton,
} from "../index";

describe("ModalFooter", () => {
  const mockOnClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("should render with buttons", () => {
      const buttons: ModalFooterButton[] = [
        { key: "cancel", text: "Cancel", onClick: mockOnClick },
        { key: "ok", text: "OK", onClick: mockOnClick },
      ];

      render(<ModalFooter buttons={buttons} />);

      expect(screen.getByText("Cancel")).toBeInTheDocument();
      expect(screen.getByText("OK")).toBeInTheDocument();
    });

    it("should render with empty buttons array", () => {
      render(<ModalFooter buttons={[]} />);

      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("should render with custom className", () => {
      const buttons: ModalFooterButton[] = [{ key: "ok", text: "OK", onClick: mockOnClick }];

      const { container } = render(<ModalFooter buttons={buttons} className="custom-class" />);

      expect(container.firstChild).toHaveClass("custom-class");
    });

    it("should render with custom style", () => {
      const buttons: ModalFooterButton[] = [{ key: "ok", text: "OK", onClick: mockOnClick }];

      const { container } = render(
        <ModalFooter buttons={buttons} style={{ backgroundColor: "red" }} />,
      );

      expect(container.firstChild).toBeInTheDocument();
    });
  });

  describe("alignment", () => {
    const buttons: ModalFooterButton[] = [{ key: "ok", text: "OK", onClick: mockOnClick }];

    it("should align right by default", () => {
      const { container } = render(<ModalFooter buttons={buttons} />);

      expect(container.firstChild).toHaveStyle({
        justifyContent: "flex-end",
      });
    });

    it("should align left when align='left'", () => {
      const { container } = render(<ModalFooter buttons={buttons} align="left" />);

      expect(container.firstChild).toHaveStyle({
        justifyContent: "flex-start",
      });
    });

    it("should align center when align='center'", () => {
      const { container } = render(<ModalFooter buttons={buttons} align="center" />);

      expect(container.firstChild).toHaveStyle({
        justifyContent: "center",
      });
    });

    it("should align right when align='right'", () => {
      const { container } = render(<ModalFooter buttons={buttons} align="right" />);

      expect(container.firstChild).toHaveStyle({
        justifyContent: "flex-end",
      });
    });
  });

  describe("button props", () => {
    it("should render button with type", () => {
      const buttons: ModalFooterButton[] = [
        { key: "primary", text: "Primary", type: "primary", onClick: mockOnClick },
      ];

      render(<ModalFooter buttons={buttons} />);

      const button = screen.getByText("Primary");
      expect(button).toBeInTheDocument();
    });

    it("should render disabled button", () => {
      const buttons: ModalFooterButton[] = [
        { key: "disabled", text: "Disabled", disabled: true, onClick: mockOnClick },
      ];

      render(<ModalFooter buttons={buttons} />);

      const button = screen.getByText("Disabled");
      expect(button).toBeInTheDocument();
    });

    it("should render loading button", () => {
      const buttons: ModalFooterButton[] = [
        { key: "loading", text: "Loading", loading: true, onClick: mockOnClick },
      ];

      render(<ModalFooter buttons={buttons} />);

      const button = screen.getByText("Loading");
      expect(button).toBeInTheDocument();
    });

    it("should render danger button", () => {
      const buttons: ModalFooterButton[] = [
        { key: "danger", text: "Danger", danger: true, onClick: mockOnClick },
      ];

      render(<ModalFooter buttons={buttons} />);

      const button = screen.getByText("Danger");
      expect(button).toBeInTheDocument();
    });

    it("should render button with icon", () => {
      const buttons: ModalFooterButton[] = [
        {
          key: "icon",
          text: "With Icon",
          icon: <span data-testid="icon">🔍</span>,
          onClick: mockOnClick,
        },
      ];

      render(<ModalFooter buttons={buttons} />);

      expect(screen.getByTestId("icon")).toBeInTheDocument();
    });
  });

  describe("button click handling", () => {
    it("should call onClick when button is clicked", () => {
      const onClick1 = vi.fn();
      const onClick2 = vi.fn();

      const buttons: ModalFooterButton[] = [
        { key: "cancel", text: "Cancel", onClick: onClick1 },
        { key: "ok", text: "OK", onClick: onClick2 },
      ];

      render(<ModalFooter buttons={buttons} />);

      fireEvent.click(screen.getByText("Cancel"));
      expect(onClick1).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByText("OK"));
      expect(onClick2).toHaveBeenCalledTimes(1);
    });

    it("should not call onClick when button is disabled", () => {
      const buttons: ModalFooterButton[] = [
        {
          key: "disabled",
          text: "Disabled",
          disabled: true,
          onClick: mockOnClick,
        },
      ];

      render(<ModalFooter buttons={buttons} />);

      fireEvent.click(screen.getByText("Disabled"));
      expect(mockOnClick).not.toHaveBeenCalled();
    });
  });

  describe("button size", () => {
    it("should render with default size middle", () => {
      const buttons: ModalFooterButton[] = [{ key: "ok", text: "OK", onClick: mockOnClick }];

      render(<ModalFooter buttons={buttons} />);

      const button = screen.getByText("OK");
      expect(button).toBeInTheDocument();
    });

    it("should render with size small", () => {
      const buttons: ModalFooterButton[] = [{ key: "ok", text: "OK", onClick: mockOnClick }];

      render(<ModalFooter buttons={buttons} size="small" />);

      const button = screen.getByText("OK");
      expect(button).toBeInTheDocument();
    });

    it("should render with size large", () => {
      const buttons: ModalFooterButton[] = [{ key: "ok", text: "OK", onClick: mockOnClick }];

      render(<ModalFooter buttons={buttons} size="large" />);

      const button = screen.getByText("OK");
      expect(button).toBeInTheDocument();
    });
  });

  describe("multiple buttons", () => {
    it("should render multiple buttons in order", () => {
      const buttons: ModalFooterButton[] = [
        { key: "cancel", text: "Cancel", onClick: mockOnClick },
        { key: "apply", text: "Apply", onClick: mockOnClick },
        { key: "ok", text: "OK", onClick: mockOnClick },
      ];

      render(<ModalFooter buttons={buttons} />);

      const allButtons = screen.getAllByRole("button");
      expect(allButtons).toHaveLength(3);
      expect(allButtons[0]).toHaveTextContent("Cancel");
      expect(allButtons[1]).toHaveTextContent("Apply");
      expect(allButtons[2]).toHaveTextContent("OK");
    });
  });
});

describe("Button factory functions", () => {
  const mockOnClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createCancelButton", () => {
    it("should create cancel button with correct properties", () => {
      const button = createCancelButton(mockOnClick);

      expect(button.key).toBe("cancel");
      expect(button.text).toBe("Cancel");
      expect(button.type).toBe("default");
      expect(button.onClick).toBe(mockOnClick);
    });
  });

  describe("createOkButton", () => {
    it("should create OK button with default options", () => {
      const button = createOkButton(mockOnClick);

      expect(button.key).toBe("ok");
      expect(button.text).toBe("OK");
      expect(button.type).toBe("primary");
      expect(button.disabled).toBeUndefined();
      expect(button.loading).toBeUndefined();
    });

    it("should create OK button with custom text", () => {
      const button = createOkButton(mockOnClick, { text: "Confirm" });

      expect(button.text).toBe("Confirm");
    });

    it("should create OK button with disabled option", () => {
      const button = createOkButton(mockOnClick, { disabled: true });

      expect(button.disabled).toBe(true);
    });

    it("should create OK button with loading option", () => {
      const button = createOkButton(mockOnClick, { loading: true });

      expect(button.loading).toBe(true);
    });

    it("should create OK button with all options", () => {
      const button = createOkButton(mockOnClick, {
        text: "Confirm",
        disabled: true,
        loading: true,
      });

      expect(button.text).toBe("Confirm");
      expect(button.disabled).toBe(true);
      expect(button.loading).toBe(true);
    });
  });

  describe("createApplyButton", () => {
    it("should create Apply button with default options", () => {
      const button = createApplyButton(mockOnClick);

      expect(button.key).toBe("apply");
      expect(button.text).toBe("Apply");
      expect(button.type).toBe("primary");
    });

    it("should create Apply button with custom text", () => {
      const button = createApplyButton(mockOnClick, { text: "Submit" });

      expect(button.text).toBe("Submit");
    });

    it("should create Apply button with disabled and loading options", () => {
      const button = createApplyButton(mockOnClick, {
        disabled: true,
        loading: true,
      });

      expect(button.disabled).toBe(true);
      expect(button.loading).toBe(true);
    });
  });

  describe("createSaveButton", () => {
    it("should create Save button with default options", () => {
      const button = createSaveButton(mockOnClick);

      expect(button.key).toBe("save");
      expect(button.text).toBe("Save");
      expect(button.type).toBe("primary");
    });

    it("should create Save button with disabled option", () => {
      const button = createSaveButton(mockOnClick, { disabled: true });

      expect(button.disabled).toBe(true);
    });

    it("should create Save button with loading option", () => {
      const button = createSaveButton(mockOnClick, { loading: true });

      expect(button.loading).toBe(true);
    });
  });

  describe("createDeleteButton", () => {
    it("should create Delete button with default options", () => {
      const button = createDeleteButton(mockOnClick);

      expect(button.key).toBe("delete");
      expect(button.text).toBe("Delete");
      expect(button.type).toBe("primary");
      expect(button.danger).toBe(true);
    });

    it("should create Delete button with custom text", () => {
      const button = createDeleteButton(mockOnClick, { text: "Remove" });

      expect(button.text).toBe("Remove");
    });

    it("should create Delete button with disabled and loading options", () => {
      const button = createDeleteButton(mockOnClick, {
        disabled: true,
        loading: true,
      });

      expect(button.disabled).toBe(true);
      expect(button.loading).toBe(true);
    });
  });

  describe("integration with ModalFooter", () => {
    it("should render factory buttons correctly", () => {
      const buttons = [createCancelButton(mockOnClick), createOkButton(mockOnClick)];

      render(<ModalFooter buttons={buttons} />);

      expect(screen.getByText("Cancel")).toBeInTheDocument();
      expect(screen.getByText("OK")).toBeInTheDocument();
    });

    it("should handle click on factory buttons", () => {
      const onCancel = vi.fn();
      const onOk = vi.fn();

      const buttons = [createCancelButton(onCancel), createOkButton(onOk)];

      render(<ModalFooter buttons={buttons} />);

      fireEvent.click(screen.getByText("Cancel"));
      expect(onCancel).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByText("OK"));
      expect(onOk).toHaveBeenCalledTimes(1);
    });
  });
});
