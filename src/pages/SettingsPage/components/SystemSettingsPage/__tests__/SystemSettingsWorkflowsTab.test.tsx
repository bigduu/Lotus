import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  LegacyWorkflowManagementClient,
  WorkflowCatalogAdapter,
  WorkflowCatalogInvalidationListener,
  WorkflowCatalogQuerySource,
  WorkflowCatalogView,
  WorkflowMigrationClient,
} from "../../../../../features/workflows";
import SystemSettingsWorkflowsTab from "../SystemSettingsWorkflowsTab";

const typedCatalog: WorkflowCatalogView = {
  revision: 12,
  capabilities: {
    mode: "typed",
    clone: false,
    edit: false,
    activate: false,
    run: false,
    cancel: false,
  },
  diagnostics: [{ itemId: "broken", message: "Invalid entry was skipped" }],
  items: [
    {
      id: "review",
      name: "Review",
      description: "Review a scoped change with evidence.",
      kind: "instruction",
      source: "builtin",
      status: "valid",
      invocationPolicy: "both",
      argumentHint: "[scope]",
      readOnly: true,
      revision: 7,
      version: "3",
      shadowedCandidates: [{ source: "project", status: "invalid", lastError: "Bad override" }],
    },
    {
      id: "release",
      name: "Release",
      description: "Prepare a project release.",
      kind: "orchestration",
      source: "project",
      status: "valid",
      invocationPolicy: "manual",
      readOnly: false,
      revision: 5,
    },
    {
      id: "personal-review",
      name: "Personal review",
      description: "A user workflow with an invalid local definition.",
      kind: "orchestration",
      source: "user",
      status: "invalid",
      invocationPolicy: "automatic",
      readOnly: false,
      revision: 4,
      lastError: "Invalid argument schema",
      lastKnownGood: true,
    },
    {
      id: "plugin-release",
      name: "Plugin release",
      description: "A degraded plugin workflow.",
      kind: "orchestration",
      source: "plugin",
      status: "degraded",
      invocationPolicy: "manual",
      readOnly: true,
      revision: 2,
    },
    {
      id: "legacy-repo-review",
      name: "Repository legacy review",
      description: "A workspace legacy workflow ready to migrate.",
      kind: "orchestration",
      source: "workspace",
      status: "valid",
      legacy: true,
      migrationStatus: "available",
      invocationPolicy: "manual",
      readOnly: false,
      revision: 6,
      shadowedCandidates: [
        { source: "plugin", status: "valid", legacy: true, migrationStatus: "available" },
      ],
    },
  ],
};

const adapterWith = (result: WorkflowCatalogView): WorkflowCatalogAdapter => ({
  load: vi.fn().mockResolvedValue(result),
});

describe("SystemSettingsWorkflowsTab", () => {
  it("renders typed workflow metadata and keeps unsupported actions disabled", async () => {
    const adapter = adapterWith(typedCatalog);
    render(<SystemSettingsWorkflowsTab catalogAdapter={adapter} sessionId="session-125" />);

    expect(await screen.findByText("Review")).toBeInTheDocument();
    expect(screen.getAllByText("Orchestration")).toHaveLength(4);
    expect(screen.getByText("Instruction")).toBeInTheDocument();
    const realWorkflow = screen.getByRole("article", { name: "Release" });
    expect(within(realWorkflow).getByText("Orchestration")).toBeInTheDocument();
    expect(within(realWorkflow).queryByText("Legacy")).not.toBeInTheDocument();
    const legacyWorkflow = screen.getByRole("article", { name: "Repository legacy review" });
    expect(within(legacyWorkflow).getByText("Legacy")).toBeInTheDocument();
    expect(within(legacyWorkflow).getByText("Orchestration")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filter by workflow kind" })).toBeInTheDocument();
    expect(screen.getByText("Built-in")).toBeInTheDocument();
    expect(screen.getByText("Manual + automatic")).toBeInTheDocument();
    expect(screen.getAllByText("Read-only")).toHaveLength(2);
    expect(screen.getByText("Version 3 · Revision 7")).toBeInTheDocument();
    expect(screen.getByText("User")).toBeInTheDocument();
    expect(screen.getByText("Invalid")).toBeInTheDocument();
    expect(screen.getByText("Invalid argument schema")).toBeInTheDocument();
    expect(screen.getByText("Last-known-good metadata")).toBeInTheDocument();
    expect(screen.getByText("Plugin")).toBeInTheDocument();
    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(screen.getAllByText("Shadowed candidates:")).toHaveLength(2);
    expect(screen.getByText("Project · Invalid · Bad override")).toBeInTheDocument();
    expect(screen.getAllByText("Winner")).toHaveLength(2);
    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.getByText("Migration available")).toBeInTheDocument();
    expect(screen.getByText("Plugin · Valid · Legacy · Migration available")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Migrate Repository legacy review" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Clone Review" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit Review" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run Review" })).toBeDisabled();
    expect(adapter.load).toHaveBeenCalledWith({ sessionId: "session-125" });
  });

  it("migrates an available legacy workflow through the trusted session and refreshes", async () => {
    const load = vi.fn<WorkflowCatalogAdapter["load"]>().mockResolvedValue(typedCatalog);
    const migrate = vi.fn<WorkflowMigrationClient["migrate"]>().mockResolvedValue({
      workflow_id: "legacy-repo-review",
      outcome: "migrated",
      source_preserved: true,
      catalog_revision: 13,
    });
    render(
      <SystemSettingsWorkflowsTab
        catalogAdapter={{ load }}
        migrationClient={{ migrate }}
        sessionId=" session-561 "
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Migrate Repository legacy review" }),
    );

    await waitFor(() => expect(migrate).toHaveBeenCalledWith("legacy-repo-review", "session-561"));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText("Workflow migrated; the legacy source was preserved"),
    ).toBeInTheDocument();
  });

  it("shows migration failure without fabricating a refresh", async () => {
    const load = vi.fn<WorkflowCatalogAdapter["load"]>().mockResolvedValue(typedCatalog);
    const migrate = vi
      .fn<WorkflowMigrationClient["migrate"]>()
      .mockRejectedValue(new Error("Target Skill already exists"));
    render(
      <SystemSettingsWorkflowsTab
        catalogAdapter={{ load }}
        migrationClient={{ migrate }}
        sessionId="session-561"
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Migrate Repository legacy review" }),
    );

    expect(await screen.findByText("Target Skill already exists")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("preserves usable entries when the typed catalog contains invalid records", async () => {
    render(<SystemSettingsWorkflowsTab catalogAdapter={adapterWith(typedCatalog)} />);

    expect(await screen.findByText("Review")).toBeInTheDocument();
    expect(screen.getByText("1 catalog entry could not be displayed")).toBeInTheDocument();
    expect(screen.getByText("Invalid entry was skipped")).toBeInTheDocument();
    expect(screen.getByText("Release")).toBeInTheDocument();
  });

  it("keeps stale metadata visible on a degraded refresh and recovers on the next event", async () => {
    let listener: WorkflowCatalogInvalidationListener | undefined;
    const load = vi
      .fn<WorkflowCatalogQuerySource["load"]>()
      .mockResolvedValueOnce(typedCatalog)
      .mockRejectedValueOnce(new Error("Catalog refresh unavailable"))
      .mockResolvedValueOnce({
        ...typedCatalog,
        revision: 13,
        items: typedCatalog.items.map((item) =>
          item.id === "review" ? { ...item, description: "Recovered catalog metadata." } : item,
        ),
      });
    const query: WorkflowCatalogQuerySource = {
      load,
      subscribe: (nextListener) => {
        listener = nextListener;
        return () => {
          listener = undefined;
        };
      },
      invalidate: (event) => {
        listener?.(event);
        return true;
      },
    };
    render(<SystemSettingsWorkflowsTab catalogQuery={query} sessionId="session-230" />);
    expect(await screen.findByText("Review a scoped change with evidence.")).toBeInTheDocument();

    act(() => {
      query.invalidate({
        type: "workflow_invalid",
        workflowId: "review",
        revision: 12,
        scope: "builtin",
      });
    });
    expect(await screen.findByText("Catalog refresh unavailable")).toBeInTheDocument();
    expect(screen.getByText("Review a scoped change with evidence.")).toBeInTheDocument();
    expect(
      screen.getByText("Catalog refresh failed; showing the last usable metadata"),
    ).toBeInTheDocument();

    act(() => {
      query.invalidate({
        type: "workflow_recovered",
        workflowId: "review",
        revision: 13,
        scope: "builtin",
      });
    });
    expect(await screen.findByText("Recovered catalog metadata.")).toBeInTheDocument();
    expect(screen.queryByText("Catalog refresh unavailable")).not.toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("filters the library without mutating the loaded catalog", async () => {
    const adapter = adapterWith(typedCatalog);
    render(<SystemSettingsWorkflowsTab catalogAdapter={adapter} />);
    await screen.findByText("Review");

    fireEvent.change(screen.getByRole("searchbox", { name: "Search workflow catalog" }), {
      target: { value: "release" },
    });

    expect(screen.queryByText("Review")).not.toBeInTheDocument();
    expect(screen.getByText("Release")).toBeInTheDocument();
    expect(adapter.load).toHaveBeenCalledTimes(1);
  });

  it("renders the same id from separate catalog namespaces as distinct rows", async () => {
    const duplicateCatalog: WorkflowCatalogView = {
      ...typedCatalog,
      diagnostics: [],
      items: [
        { ...typedCatalog.items[0], id: "review", name: "Instruction review" },
        {
          ...typedCatalog.items[4],
          id: "review",
          name: "Preserved orchestration review",
          revision: 8,
        },
      ],
    };

    render(<SystemSettingsWorkflowsTab catalogAdapter={adapterWith(duplicateCatalog)} />);

    const instruction = await screen.findByRole("article", { name: "Instruction review" });
    const orchestration = screen.getByRole("article", {
      name: "Preserved orchestration review",
    });
    expect(within(instruction).getByText("Instruction")).toBeInTheDocument();
    expect(within(orchestration).getByText("Orchestration")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("cannot let an older session request overwrite the current catalog", async () => {
    let resolveA!: (catalog: WorkflowCatalogView) => void;
    let resolveB!: (catalog: WorkflowCatalogView) => void;
    const load = vi.fn<WorkflowCatalogAdapter["load"]>(({ sessionId } = {}) => {
      return new Promise<WorkflowCatalogView>((resolve) => {
        if (sessionId === "session-a") resolveA = resolve;
        else resolveB = resolve;
      });
    });
    const catalogFor = (id: string): WorkflowCatalogView => ({
      ...typedCatalog,
      diagnostics: [],
      items: [{ ...typedCatalog.items[0], id, name: id }],
    });

    const { rerender } = render(
      <SystemSettingsWorkflowsTab catalogAdapter={{ load }} sessionId="session-a" />,
    );
    rerender(<SystemSettingsWorkflowsTab catalogAdapter={{ load }} sessionId="session-b" />);

    await act(async () => resolveB(catalogFor("Session B workflow")));
    expect(await screen.findByText("Session B workflow")).toBeInTheDocument();

    await act(async () => resolveA(catalogFor("Session A workflow")));
    expect(screen.queryByText("Session A workflow")).not.toBeInTheDocument();
    expect(screen.getByText("Session B workflow")).toBeInTheDocument();
  });

  it("labels fallback data as legacy without inventing revision metadata", async () => {
    const legacyCatalog: WorkflowCatalogView = {
      capabilities: {
        mode: "legacy",
        clone: false,
        edit: true,
        activate: false,
        run: false,
        cancel: false,
      },
      diagnostics: [],
      items: [
        {
          id: "old-review",
          name: "Old Review",
          description: "Legacy workflow metadata.",
          kind: "orchestration",
          source: "legacy",
          status: "valid",
          legacy: true,
          invocationPolicy: "manual",
          readOnly: false,
        },
      ],
    };

    render(<SystemSettingsWorkflowsTab catalogAdapter={adapterWith(legacyCatalog)} />);

    expect(await screen.findByText("Old Review")).toBeInTheDocument();
    expect(screen.getAllByText("Legacy")).toHaveLength(2);
    expect(
      within(screen.getByRole("article", { name: "Old Review" })).getByText("Orchestration"),
    ).toBeInTheDocument();
    expect(screen.getByText("Catalog source: Legacy adapter")).toBeInTheDocument();
    expect(screen.queryByText(/Revision/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Version/)).not.toBeInTheDocument();
  });

  it("preserves real create, edit, and delete behavior in legacy mode", async () => {
    const legacyCatalog: WorkflowCatalogView = {
      capabilities: {
        mode: "legacy",
        clone: false,
        edit: true,
        activate: false,
        run: false,
        cancel: false,
      },
      diagnostics: [],
      items: [
        {
          id: "old-review",
          name: "Old Review",
          description: "Legacy workflow metadata.",
          kind: "orchestration",
          source: "legacy",
          status: "valid",
          legacy: true,
          invocationPolicy: "manual",
          readOnly: false,
        },
      ],
    };
    const legacyManager: LegacyWorkflowManagementClient = {
      getWorkflow: vi.fn().mockResolvedValue({ name: "old-review", content: "Old content" }),
      saveWorkflow: vi.fn().mockResolvedValue(undefined),
      deleteWorkflow: vi.fn().mockResolvedValue(undefined),
    };

    render(
      <SystemSettingsWorkflowsTab
        catalogAdapter={adapterWith(legacyCatalog)}
        legacyManager={legacyManager}
        sessionId={null}
      />,
    );
    await screen.findByText("Old Review");

    fireEvent.click(screen.getByRole("button", { name: "New workflow" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Workflow name" }), {
      target: { value: "triage" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Describe the workflow steps here/), {
      target: { value: "Triage content" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(legacyManager.saveWorkflow).toHaveBeenCalledWith("triage", "Triage content"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit Old Review" }));
    expect(await screen.findByDisplayValue("Old content")).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("Old content"), {
      target: { value: "Updated content" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(legacyManager.saveWorkflow).toHaveBeenCalledWith("old-review", "Updated content"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete Old Review" }));
    await waitFor(() => expect(legacyManager.deleteWorkflow).toHaveBeenCalledWith("old-review"));
  });

  it("renders a recoverable error and retries through the adapter", async () => {
    const load = vi
      .fn<WorkflowCatalogAdapter["load"]>()
      .mockRejectedValueOnce(new Error("Catalog unavailable"))
      .mockResolvedValueOnce({ ...typedCatalog, diagnostics: [] });

    render(<SystemSettingsWorkflowsTab catalogAdapter={{ load }} />);
    expect(await screen.findByText("Catalog unavailable")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Review")).toBeInTheDocument();
  });
});
