import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockOpenAIConstructor, mockBackendBaseUrl, state } = vi.hoisted(() => ({
  mockOpenAIConstructor: vi.fn(),
  mockBackendBaseUrl: vi.fn(),
  state: {
    backendBaseUrl: "http://127.0.0.1:9562/v1",
  },
}));

vi.mock("openai", () => {
  class MockOpenAI {
    constructor(config: unknown) {
      mockOpenAIConstructor(config);
    }
  }

  return {
    default: MockOpenAI,
  };
});

vi.mock("@shared/utils/backendBaseUrl", () => ({
  getBackendBaseUrlSync: () => mockBackendBaseUrl(),
}));

const loadModule = async () => import("../openaiClient");

describe("openaiClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    state.backendBaseUrl = "http://127.0.0.1:9562/v1";
    mockBackendBaseUrl.mockImplementation(() => state.backendBaseUrl);
  });

  it("maps backend /v1 base URL to /openai/v1", async () => {
    state.backendBaseUrl = "http://localhost:9562/v1";

    const { getOpenAIClient } = await loadModule();
    getOpenAIClient();

    expect(mockOpenAIConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "local",
        baseURL: "http://localhost:9562/openai/v1",
      }),
    );
  });

  it("keeps /openai/v1 base URL unchanged after trimming", async () => {
    state.backendBaseUrl = "  http://localhost:9562/openai/v1/   ";

    const { getOpenAIClient } = await loadModule();
    getOpenAIClient();

    expect(mockOpenAIConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: "http://localhost:9562/openai/v1",
      }),
    );
  });

  it("appends /openai/v1 when backend base URL does not end with /v1", async () => {
    state.backendBaseUrl = "http://localhost:9562";

    const { getOpenAIClient } = await loadModule();
    getOpenAIClient();

    expect(mockOpenAIConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: "http://localhost:9562/openai/v1",
      }),
    );
  });

  it("reuses the same client for equivalent normalized base URLs", async () => {
    const { getOpenAIClient } = await loadModule();

    state.backendBaseUrl = "http://localhost:9562/v1/";
    const firstClient = getOpenAIClient();

    state.backendBaseUrl = "  http://localhost:9562/v1   ";
    const secondClient = getOpenAIClient();

    expect(secondClient).toBe(firstClient);
    expect(mockOpenAIConstructor).toHaveBeenCalledTimes(1);
  });

  it("creates a new client when normalized base URL changes", async () => {
    const { getOpenAIClient } = await loadModule();

    state.backendBaseUrl = "http://localhost:9562/v1";
    const firstClient = getOpenAIClient();

    state.backendBaseUrl = "http://localhost:8888/v1";
    const secondClient = getOpenAIClient();

    expect(secondClient).not.toBe(firstClient);
    expect(mockOpenAIConstructor).toHaveBeenCalledTimes(2);
    expect(mockOpenAIConstructor).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        baseURL: "http://localhost:8888/openai/v1",
      }),
    );
  });

  it("always enables browser mode for local proxy usage", async () => {
    const { getOpenAIClient } = await loadModule();

    getOpenAIClient();

    expect(mockOpenAIConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        dangerouslyAllowBrowser: true,
      }),
    );
  });
});
