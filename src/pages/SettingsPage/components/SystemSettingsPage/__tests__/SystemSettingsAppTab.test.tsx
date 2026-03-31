import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App as AntdApp } from "antd";

import SystemSettingsAppTab from "../SystemSettingsAppTab";

describe("SystemSettingsAppTab", () => {
  it("shows the running app version", () => {
    render(
      <AntdApp>
        <SystemSettingsAppTab
          autoGenerateTitles={false}
          isUpdatingAutoTitlePreference={false}
          onAutoTitleToggle={() => undefined}
          themeMode="light"
          onThemeModeChange={() => undefined}
          onClearLocalStorage={() => undefined}
          onResetApp={() => undefined}
          isResetting={false}
          darkModeKey="bamboo_dark_mode"
        />
      </AntdApp>,
    );

    expect(screen.getByTestId("settings-app-version")).toHaveTextContent("2026.4.1");
  });
});
