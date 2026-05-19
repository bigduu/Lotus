import { ApiError } from "../api";
import { settingsService } from "../config/SettingsService";

export class ProxyAuthRequiredError extends Error {
  readonly code = "proxy_auth_required";

  constructor(message = "Proxy authentication required") {
    super(message);
    this.name = "ProxyAuthRequiredError";
  }
}

export class ModelService {
  private static instance: ModelService;

  private constructor() {}

  static getInstance(): ModelService {
    if (!ModelService.instance) {
      ModelService.instance = new ModelService();
    }
    return ModelService.instance;
  }

  async getModels(provider?: string): Promise<string[]> {
    try {
      const response = await settingsService.fetchCatalogModels(provider);

      // Flatten all models from all providers into a single list of IDs
      const modelIds: string[] = [];
      for (const result of response.fetched) {
        if (result.models && result.models.length > 0) {
          for (const model of result.models) {
            if (model.reference && model.reference.model) {
              modelIds.push(model.reference.model);
            }
          }
        }
      }

      // Remove duplicates and sort
      const uniqueModelIds = [...new Set(modelIds)].sort();
      return uniqueModelIds;
    } catch (error) {
      console.error("Failed to fetch models from Provider Catalog:", error);

      // Handle proxy auth error
      if (error instanceof ApiError) {
        if (error.status === 428) {
          throw new ProxyAuthRequiredError(error.message);
        }

        // Try to parse error code from body
        let body: unknown;
        if (error.body) {
          try {
            body = JSON.parse(error.body);
          } catch {
            // Ignore parse errors
          }
        }

        if (
          body &&
          typeof body === "object" &&
          "error" in body &&
          (body as { error?: { code?: string; message?: string } }).error?.code ===
            "proxy_auth_required"
        ) {
          throw new ProxyAuthRequiredError(
            (body as { error?: { message?: string } }).error?.message || error.message,
          );
        }
      }

      throw error;
    }
  }
}

export const modelService = ModelService.getInstance();
