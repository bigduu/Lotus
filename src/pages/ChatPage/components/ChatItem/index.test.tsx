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

describe("ChatItem workspace badge (#134)", () => {
  it("shows the workspace basename with the full path as tooltip", () => {
    renderChatItem({ workspacePath: "/Users/alice/Workspace/zenith" });

    const badge = screen.getByTestId("chat-item-workspace");
    expect(badge).toHaveTextContent("zenith");
  });

  it("renders no badge when the session has no workspace", () => {
    renderChatItem({ workspacePath: null });

    expect(screen.queryByTestId("chat-item-workspace")).not.toBeInTheDocument();
  });

  it("renders no badge when workspacePath is omitted (legacy callers)", () => {
    renderChatItem();

    expect(screen.queryByTestId("chat-item-workspace")).not.toBeInTheDocument();
  });
});

describe("ChatItem unread state (#129)", () => {
  it("renders an accessible unread row with a decorative dot", () => {
    renderChatItem({ unread: true });

    expect(screen.getByRole("option", { name: "Original title, unread activity" })).toBeVisible();
    expect(screen.getByTestId("chat-item-unread")).toHaveAttribute("aria-hidden", "true");
  });

  it("removes the dot and accessible suffix when read", () => {
    const { rerender } = render(
      <AntdApp>
        <ChatItem
          chat={baseChat}
          unread
          isSelected={false}
          onSelect={noop}
          onDelete={noop}
          onPin={noop}
          onUnpin={noop}
        />
      </AntdApp>,
    );
    expect(screen.getByTestId("chat-item-unread")).toBeInTheDocument();

    rerender(
      <AntdApp>
        <ChatItem
          chat={baseChat}
          unread={false}
          isSelected={false}
          onSelect={noop}
          onDelete={noop}
          onPin={noop}
          onUnpin={noop}
        />
      </AntdApp>,
    );
    expect(screen.queryByTestId("chat-item-unread")).toBeNull();
    expect(screen.getByRole("option", { name: "Original title" })).toBeVisible();
  });
});

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

describe("ChatItem 'Schedule this' menu item (#100)", () => {
  async function openMenu() {
    const item = screen.getByTestId("chat-item");
    fireEvent.mouseEnter(item);
    const moreButton = await screen.findByLabelText("More actions");
    fireEvent.click(moreButton);
  }

  it("shows the 'Schedule this…' action and invokes onScheduleThis with the session id", async () => {
    const onScheduleThis = vi.fn();
    renderChatItem({ onScheduleThis });

    await openMenu();

    const scheduleItem = await screen.findByText("Schedule this…");
    fireEvent.click(scheduleItem);

    expect(onScheduleThis).toHaveBeenCalledWith("chat-1");
  });

  it("omits the 'Schedule this…' action when no onScheduleThis handler is provided", async () => {
    renderChatItem({ onScheduleThis: undefined });

    await openMenu();

    // The menu is open (Edit is visible) but the schedule action is absent.
    expect(await screen.findByText("Edit")).toBeInTheDocument();
    expect(screen.queryByText("Schedule this…")).toBeNull();
  });
});

describe("ChatItem 'Copy Session' menu item (#153)", () => {
  async function openMenu() {
    fireEvent.mouseEnter(screen.getByTestId("chat-item"));
    fireEvent.click(await screen.findByLabelText("More actions"));
  }

  it.each(["root", "child"] as const)(
    "offers copying for a %s session and passes the source id",
    async (kind) => {
      const onCopy = vi.fn();
      renderChatItem({ chat: { ...baseChat, kind }, onCopy });

      await openMenu();
      fireEvent.click(await screen.findByText("Copy Session"));

      expect(onCopy).toHaveBeenCalledOnce();
      expect(onCopy).toHaveBeenCalledWith("chat-1");
    },
  );

  it("shows a disabled pending item while that source is being copied", async () => {
    const onCopy = vi.fn();
    renderChatItem({ onCopy, isCopying: true });

    await openMenu();
    const pendingLabel = await screen.findByText("Copying session…");
    const menuItem = pendingLabel.closest("li");

    expect(menuItem).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(pendingLabel);
    expect(onCopy).not.toHaveBeenCalled();
  });

  it("omits the action when its owner does not provide a copy handler", async () => {
    renderChatItem({ onCopy: undefined });

    await openMenu();
    expect(await screen.findByText("Edit")).toBeInTheDocument();
    expect(screen.queryByText("Copy Session")).not.toBeInTheDocument();
  });
});
