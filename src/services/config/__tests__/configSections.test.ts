import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient, ApiError } from "@services/api";
import {
  ConfigConflictError,
  configSectionsService,
  type NotificationSection,
  type ProviderSection,
} from "../configSections";

const notificationResponse = (revision: number) => ({
  revision,
  status: "healthy" as const,
  source: "file",
  last_error: null,
  data: {
    desktop: { enabled: true },
    ntfy: {
      enabled: true,
      base_url: "https://ntfy.sh",
      topic: "topic",
      credential: {
        credential_ref: "notification.ntfy.token",
        configured: true,
        source: "user",
        updated_at: null,
      },
    },
    bark: {
      enabled: false,
      base_url: "https://api.day.app",
      credential: {
        credential_ref: null,
        configured: false,
        source: null,
        updated_at: null,
      },
    },
  } satisfies NotificationSection,
});

const providerResponse = (revision: number) => ({
  data: {
    provider: "openai",
    providers: { openai: { model: "gpt-4o" } },
    defaults: { chat: { provider: "openai", model: "gpt-4o" } },
    features: { provider_model_ref: true },
    provider_instances: {},
    default_provider_instance_id: null,
    available_providers: ["copilot", "openai", "anthropic", "gemini", "bodhi"],
    credential_status: {
      providers: {
        openai: {
          credential_ref: "provider.openai.api_key",
          configured: true,
          source: "user",
          updated_at: null,
        },
      },
      provider_instances: {},
    },
  } satisfies ProviderSection,
  revision,
  loaded_at: "2026-07-24T00:00:00Z",
  source_path: "/tmp/providers.json",
  source_kind: "file" as const,
  status: "healthy" as const,
  last_error: null,
});

describe("configSectionsService", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("uses the canonical provider settings route for reads", async () => {
    const response = providerResponse(2);
    const get = vi.spyOn(apiClient, "get").mockResolvedValue(response);

    await expect(configSectionsService.getSection("providers")).resolves.toEqual(response);
    expect(get).toHaveBeenCalledWith("/bamboo/config/provider-settings");
  });

  it("keeps provider metadata secret-free and sends replace intent explicitly", async () => {
    const response = providerResponse(3);
    const put = vi.spyOn(apiClient, "put").mockResolvedValue(response);

    await configSectionsService.putProviderSettings(2, response.data, {
      providers: {
        openai: { action: "replace", value: "new-provider-secret" },
      },
    });

    expect(put).toHaveBeenCalledWith("/bamboo/config/provider-settings", {
      expected_revision: 2,
      data: response.data,
      credential_changes: {
        providers: {
          openai: { action: "replace", value: "new-provider-secret" },
        },
      },
    });
    expect(JSON.stringify(response.data)).not.toContain("new-provider-secret");
    expect(JSON.stringify(response.data)).not.toContain("****");
  });

  it("omits untouched notification secrets instead of sending masks", async () => {
    const post = vi.spyOn(apiClient, "post").mockResolvedValue({});
    vi.spyOn(apiClient, "get").mockResolvedValue(notificationResponse(2));

    await configSectionsService.putNotifications(1, {
      desktop: { enabled: true },
      ntfy: { enabled: true, base_url: "https://ntfy.sh", topic: "topic" },
      bark: { enabled: false, base_url: "https://api.day.app" },
    });

    expect(post).toHaveBeenCalledWith("/bamboo/config", {
      expected_revision: 1,
      notifications: {
        desktop: { enabled: true },
        ntfy: { enabled: true, base_url: "https://ntfy.sh", topic: "topic" },
        bark: { enabled: false, base_url: "https://api.day.app" },
      },
    });
    expect(JSON.stringify(post.mock.calls[0])).not.toContain("****");
  });

  it("sends null only for an explicit credential clear", async () => {
    const post = vi.spyOn(apiClient, "post").mockResolvedValue({});
    vi.spyOn(apiClient, "get").mockResolvedValue(notificationResponse(3));

    await configSectionsService.putNotifications(2, {
      desktop: { enabled: true },
      ntfy: {
        enabled: true,
        base_url: "https://ntfy.sh",
        topic: "topic",
        token: null,
      },
      bark: { enabled: false, base_url: "https://api.day.app" },
    });

    expect(post.mock.calls[0]?.[1]).toMatchObject({
      notifications: { ntfy: { token: null } },
    });
  });

  it("maps a 409 response to a typed revision conflict", async () => {
    vi.spyOn(apiClient, "put").mockRejectedValue(
      new ApiError(
        "revision conflict",
        409,
        "Conflict",
        JSON.stringify({ error: { actual: 8 } }),
      ),
    );

    await expect(
      configSectionsService.putSection("core", 7, { http_proxy: "http://proxy" }),
    ).rejects.toMatchObject<ConfigConflictError>({
      conflict: { expectedRevision: 7, currentRevision: 8, message: "revision conflict" },
    });
  });

  it("resets a section with CAS and adopts the returned envelope", async () => {
    const resetEnvelope = {
      data: { http_proxy: "" },
      revision: 12,
      loaded_at: "2026-07-23T00:00:00Z",
      source_path: "/tmp/core.json",
      source_kind: "default" as const,
      status: "healthy" as const,
      last_error: null,
    };
    const post = vi.spyOn(apiClient, "post").mockResolvedValue(resetEnvelope);

    await expect(configSectionsService.resetSection("core", 11)).resolves.toEqual(resetEnvelope);
    expect(post).toHaveBeenCalledWith("/bamboo/config/sections/core/reset", {
      expected_revision: 11,
    });
  });

  it("reconciles notification reset through the credential-aware projection", async () => {
    const post = vi.spyOn(apiClient, "post").mockResolvedValue({
      data: {},
      revision: 4,
      status: "healthy",
    });
    const get = vi.spyOn(apiClient, "get").mockResolvedValue(notificationResponse(4));

    const result = await configSectionsService.resetSection("notifications", 3);

    expect(post).toHaveBeenCalledWith("/bamboo/config/sections/notifications/reset", {
      expected_revision: 3,
    });
    expect(get).toHaveBeenCalledWith("/bamboo/config/notifications");
    expect(result.data.ntfy.credential.configured).toBe(true);
  });

  it("replaces proxy credentials with the credential revision and no mask round-trip", async () => {
    const response = {
      configured: true,
      credential_ref: "proxy.default.auth",
      source: "user",
      updated_at: "2026-07-23T00:00:00Z",
      revision: 7,
      status: "healthy" as const,
      source_kind: "file",
      last_error: null,
    };
    const post = vi.spyOn(apiClient, "post").mockResolvedValue(response);

    await expect(
      configSectionsService.replaceProxyAuth(6, { username: "alice", password: "secret" }),
    ).resolves.toEqual(response);
    expect(post).toHaveBeenCalledWith("/bamboo/proxy-auth", {
      expected_revision: 6,
      username: "alice",
      password: "secret",
    });
  });
});
