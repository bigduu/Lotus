import { renderHook, act, screen, fireEvent, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { useMessageCardActions } from "./useMessageCardActions";

const wrapper = ({ children }: { children: ReactNode }) => <AntdApp>{children}</AntdApp>;

const setup = (onDelete = vi.fn()) => {
  const { result } = renderHook(
    () =>
      useMessageCardActions({
        messageText: "hello",
        messageId: "msg-1",
        currentSessionId: "s1",
        onDelete,
        cardRef: { current: null },
      }),
    { wrapper },
  );
  const deleteItem = result.current.contextMenuItems.find(
    (item) => item && "key" in item && item.key === "delete",
  );
  return { onDelete, deleteItem };
};

describe("useMessageCardActions — delete confirmation (#165)", () => {
  it("asks for confirmation before deleting instead of deleting directly", async () => {
    const { onDelete, deleteItem } = setup();

    act(() => {
      (deleteItem as { onClick: () => void }).onClick();
    });

    // The confirm dialog shows; no delete has happened yet.
    expect(await screen.findByText("Delete this message?")).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("msg-1"));
  });

  it("does not delete when the dialog is cancelled", async () => {
    const { onDelete, deleteItem } = setup();

    act(() => {
      (deleteItem as { onClick: () => void }).onClick();
    });

    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("Delete this message?")).not.toBeInTheDocument());
    expect(onDelete).not.toHaveBeenCalled();
  });
});
