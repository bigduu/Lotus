import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App as AntdApp } from "antd";

import { ChatItem } from "./index";
import type { SidebarChatListItem } from "@shared/types/sidebarChat";

const baseChat: SidebarChatListItem = {
  id: "chat-1",
  title: "Original title",
  kind: "root",
  pinned: false,
};

const noop = () => {};

function renderChatItem(overrides: Partial<React.ComponentProps<typeof ChatItem>> = {}) {
  const props: React.ComponentProps<typeof ChatItem> = {
    chat: baseChat,
    isSelected: false,
    onSelect: noop,
    onDelete: noop,
    onPin: noop,
    onUnpin: noop,
    onEdit: vi.fn(),
    ...overrides,
  };

  render(
    <AntdApp>
      <ChatItem {...props} />
    </AntdApp>,
  );

  return props;
}

// Enters inline-edit mode via the dropdown "Edit" menu item, the same path a
// real user takes (hover -> "more actions" -> Edit). The "more actions"
// trigger only renders once the item is hovered.
async function startEditing() {
  const item = screen.getByTestId("chat-item");
  fireEvent.mouseEnter(item);

  const moreButton = await screen.findByLabelText("More actions");
  fireEvent.click(moreButton);
  const editItem = await screen.findByText("Edit");
  fireEvent.click(editItem);
}

describe("ChatItem inline title edit", () => {
  it("Escape cancels the edit, restores the original title, and does not save (#19)", async () => {
    const onEdit = vi.fn();
    renderChatItem({ onEdit });

    await startEditing();

    const input = screen.getByDisplayValue("Original title");
    fireEvent.change(input, { target: { value: "Draft title that should be discarded" } });
    expect(screen.getByDisplayValue("Draft title that should be discarded")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });

    expect(onEdit).not.toHaveBeenCalled();
    // Editing mode exited and the original title is shown again, not the draft.
    expect(screen.queryByDisplayValue("Draft title that should be discarded")).toBeNull();
    expect(screen.getByText("Original title")).toBeInTheDocument();
  });

  it("Enter still saves the edited title", async () => {
    const onEdit = vi.fn();
    renderChatItem({ onEdit });

    await startEditing();

    const input = screen.getByDisplayValue("Original title");
    fireEvent.change(input, { target: { value: "Updated title" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onEdit).toHaveBeenCalledWith("chat-1", "Updated title");
    expect(screen.queryByDisplayValue("Updated title")).toBeNull();
  });

  it("the Cancel button still restores the original title without saving", async () => {
    const onEdit = vi.fn();
    renderChatItem({ onEdit });

    await startEditing();

    const input = screen.getByDisplayValue("Original title");
    fireEvent.change(input, { target: { value: "Draft via button cancel" } });

    const cancelButton = screen.getByLabelText("Cancel");
    fireEvent.click(cancelButton);

    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByText("Original title")).toBeInTheDocument();
  });
});
