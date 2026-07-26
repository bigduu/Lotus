import type {
  ProviderInstance,
  ProviderInstanceConfig,
  ProviderInstancesConfig,
  ProviderConfig,
} from "@shared/types/providerConfig";
import type {
  ProviderInstanceSettings,
  ProviderSection,
} from "./configSections";

export const providerInstanceSettingsToLegacy = (
  id: string,
  instance: ProviderInstanceSettings,
): ProviderInstance => {
  const {
    provider_type,
    label,
    enabled,
    ...config
  } = instance;
  return {
    id,
    type: provider_type,
    label: label?.trim() || provider_type,
    enabled,
    config: config as ProviderInstanceConfig,
  };
};

export const providerSectionToInstances = (
  section: ProviderSection,
): ProviderInstance[] =>
  Object.entries(section.provider_instances)
    .map(([id, instance]) => providerInstanceSettingsToLegacy(id, instance))
    .sort((left, right) => left.label.localeCompare(right.label));

export const providerSectionToLegacyConfig = (
  section: ProviderSection,
): ProviderConfig => ({
  provider: section.default_provider_instance_id ?? section.provider,
  defaults: section.defaults ?? undefined,
  providers: section.providers as ProviderConfig["providers"],
  features: section.features,
});

export const providerSectionToInstancesConfig = (
  section: ProviderSection,
): ProviderInstancesConfig => ({
  instances: providerSectionToInstances(section),
  default_provider_instance_id: section.default_provider_instance_id ?? undefined,
  defaults: section.defaults ?? undefined,
  features: section.features,
});
