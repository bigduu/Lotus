import type { ProviderCredentialStatus } from "@services/config/configSections";

export const isEnvironmentCredential = (
  status: ProviderCredentialStatus | null | undefined,
): boolean => Boolean(status?.configured && status.source === "environment");
