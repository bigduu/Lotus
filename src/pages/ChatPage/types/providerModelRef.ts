export interface ProviderModelRef {
  provider: string;
  model: string;
}

export interface ModelCapabilities {
  supports_tools: boolean;
  supports_vision: boolean;
  supports_reasoning: boolean;
  supports_streaming?: boolean;
  max_context_tokens?: number;
  max_output_tokens?: number;
}

export interface ProviderModelDescriptor {
  reference: ProviderModelRef;
  display_name: string;
  provider_display_name: string;
  capabilities: ModelCapabilities;
  source?: "upstream" | "static" | "manual";
  discovered_at?: string;
}

export interface ProviderDescriptor {
  id: string;
  display_name: string;
  enabled: boolean;
  authenticated: boolean;
}

export interface ProviderCatalog {
  providers: ProviderDescriptor[];
  models: ProviderModelDescriptor[];
  updated_at?: string;
}
