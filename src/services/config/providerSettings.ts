import type { ProviderInstance, ProviderInstanceConfig } from "@shared/types/providerConfig";
import type { ProviderInstanceSettings, ProviderSection } from "./configSections";

export const providerInstanceSettingsToProviderInstance = (
  id: string,
  instance: ProviderInstanceSettings,
): ProviderInstance => {
  const { provider_type, label, enabled, ...config } = instance;
  return {
    id,
    type: provider_type,
    label: label?.trim() || provider_type,
    enabled,
    config: config as ProviderInstanceConfig,
  };
};

export const providerSectionToInstances = (section: ProviderSection): ProviderInstance[] =>
  Object.entries(section.provider_instances)
    .map(([id, instance]) => providerInstanceSettingsToProviderInstance(id, instance))
    .sort((left, right) => left.label.localeCompare(right.label));
