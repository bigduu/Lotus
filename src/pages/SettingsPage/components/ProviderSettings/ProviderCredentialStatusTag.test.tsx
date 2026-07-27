import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProviderCredentialStatusTag } from "./ProviderCredentialStatusTag";

describe("ProviderCredentialStatusTag", () => {
  it("distinguishes configured, environment-owned, and missing credentials", () => {
    const { rerender } = render(
      <ProviderCredentialStatusTag
        status={{
          credential_ref: "provider.openai.api_key",
          configured: true,
          source: "user",
          updated_at: null,
        }}
      />,
    );
    expect(screen.getByText("Configured")).toBeInTheDocument();

    rerender(
      <ProviderCredentialStatusTag
        status={{
          credential_ref: null,
          configured: true,
          source: "environment",
          updated_at: null,
        }}
      />,
    );
    expect(screen.getByText("From env")).toBeInTheDocument();

    rerender(<ProviderCredentialStatusTag status={null} />);
    expect(screen.getByText("Missing")).toBeInTheDocument();
  });
});
