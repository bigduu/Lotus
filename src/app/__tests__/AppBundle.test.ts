// @vitest-environment node
import { build, loadConfigFromFile, mergeConfig, type ConfigEnv } from "vite";
import { describe, expect, it } from "vitest";

const runBundleCheck = async () => {
  const configEnv: ConfigEnv = {
    command: "build",
    mode: "development",
    isSsrBuild: false,
    isPreview: false,
  };
  const loadedConfig = await loadConfigFromFile(configEnv, undefined, process.cwd());

  if (!loadedConfig) {
    throw new Error("Failed to load Vite config for bundle check");
  }

  const result = await build(
    mergeConfig(loadedConfig.config, {
      logLevel: "silent",
      mode: "development",
      build: {
        ...loadedConfig.config.build,
        write: false,
        emptyOutDir: false,
      },
    }),
  );

  const outputs = Array.isArray(result)
    ? result.flatMap((item) => item.output)
    : result.output;
  const code = outputs
    .filter((item) => item.type === "chunk")
    .map((item) => item.code)
    .join("\n");

  return {
    hasConfigProvider: /(?:\.|\b)jsx(?:s|DEV)?\(\s*ConfigProvider\b/.test(code),
    hasAntApp: /(?:\.|\b)jsx(?:s|DEV)?\(\s*AntApp\b/.test(code),
  };
};

describe("App bundle", () => {
  it("does not leave ConfigProvider or AntApp as free identifiers", async () => {
    const { hasConfigProvider, hasAntApp } = await runBundleCheck();
    expect(hasConfigProvider).toBe(false);
    expect(hasAntApp).toBe(false);
  }, 60000); // Increased timeout for CI environment
});
