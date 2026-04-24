import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FeatureGuide,
  isOnboardingComplete,
  markOnboardingComplete,
  resetOnboarding,
} from "../FeatureGuide";

const STORAGE_KEY = "bodhi_onboarding_complete";

describe("FeatureGuide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("shows the tour when onboarding is not complete", async () => {
    render(<FeatureGuide />);

    await waitFor(() => {
      expect(screen.getByText("Welcome to Bodhi!")).toBeInTheDocument();
    });
  });

  it("does not show the tour when onboarding is already complete", () => {
    markOnboardingComplete();
    render(<FeatureGuide />);

    expect(screen.queryByText("Welcome to Bodhi!")).toBeNull();
  });

  it("does not show the tour when disabled prop is true", async () => {
    render(<FeatureGuide disabled={true} />);

    // Wait past the 800ms delay to be sure
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByText("Welcome to Bodhi!")).toBeNull();
  });
});

describe("onboarding storage helpers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("isOnboardingComplete returns false when no key exists", () => {
    expect(isOnboardingComplete()).toBe(false);
  });

  it("isOnboardingComplete returns true after markOnboardingComplete", () => {
    markOnboardingComplete();
    expect(isOnboardingComplete()).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("true");
  });

  it("resetOnboarding clears the storage key", () => {
    markOnboardingComplete();
    expect(isOnboardingComplete()).toBe(true);

    resetOnboarding();
    expect(isOnboardingComplete()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
