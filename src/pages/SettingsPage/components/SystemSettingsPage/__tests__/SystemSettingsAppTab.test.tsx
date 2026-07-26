import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App as AntdApp } from "antd";

import SystemSettingsAppTab from "../SystemSettingsAppTab";
import { APP_VERSION } from "@shared/constants/appVersion";

describe("SystemSettingsAppTab", () => {
  it("shows the running app version", () => {
    render(
      <AntdApp>
        <SystemSettingsAppTab
          themeMode="light"
          onThemeModeChange={() => undefined}
          vdiSafeMode={false}
          onVdiSafeModeToggle={() => undefined}
          onClearLocalStorage={() => undefined}
          onResetApp={() => undefined}
          isResetting={false}
          resetSectionResults={[]}
          darkModeKey="bamboo_dark_mode"
        />
      </AntdApp>,
    );

    // Assert the component renders the running version (whatever it is —
    // `0.0.0` placeholder locally / in CI, real date version at publish). The
    // "must be a real version" check is the publish refuse-0.0.0 guard's job.
    expect(screen.getByTestId("settings-app-version")).toHaveTextContent(`v${APP_VERSION}`);
    expect(screen.getByTestId("vdi-safe-mode-toggle")).toBeInTheDocument();
  });

  it("shows each typed section failure instead of reporting overall success", () => {
    render(
      <AntdApp>
        <SystemSettingsAppTab
          themeMode="light"
          onThemeModeChange={() => undefined}
          vdiSafeMode={false}
          onVdiSafeModeToggle={() => undefined}
          onClearLocalStorage={() => undefined}
          onResetApp={() => undefined}
          isResetting={false}
          resetSectionResults={[
            { section: "core", status: "success" },
            { section: "credentials", status: "failed", error: "revision conflict" },
          ]}
          darkModeKey="bamboo_dark_mode"
        />
      </AntdApp>,
    );

    expect(screen.getByTestId("reset-result-core")).toHaveTextContent("core: success");
    expect(screen.getByTestId("reset-result-credentials")).toHaveTextContent(
      "credentials: failed — revision conflict",
    );
  });
});
