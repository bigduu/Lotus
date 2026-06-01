import { useEffect, useState } from "react";
import {
  clearBackendBaseUrlOverride,
  getBackendBaseUrlSync,
  getDefaultBackendBaseUrl,
  hasBackendBaseUrlOverride,
  normalizeBackendBaseUrl,
  setBackendBaseUrl,
} from "@shared/utils/backendBaseUrl";
import i18n from "@shared/i18n";

interface UseSystemSettingsBackendProps {
  msgApi: {
    error: (content: string) => void;
    success: (content: string) => void;
  };
  refreshModels: () => Promise<void>;
}

export const useSystemSettingsBackend = ({
  msgApi,
  refreshModels,
}: UseSystemSettingsBackendProps) => {
  const [backendBaseUrl, setBackendBaseUrlState] = useState(getBackendBaseUrlSync());
  const [hasBackendOverride, setHasBackendOverride] = useState(hasBackendBaseUrlOverride());

  useEffect(() => {
    setBackendBaseUrlState(getBackendBaseUrlSync());
    setHasBackendOverride(hasBackendBaseUrlOverride());
  }, []);

  const validateBackendUrl = (value: string): string | null => {
    const normalized = normalizeBackendBaseUrl(value);
    if (!normalized) {
      return i18n.t("settings.configTab.backendUrlEmpty");
    }

    try {
      const parsed = new URL(normalized);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return i18n.t("settings.configTab.backendUrlInvalidProtocol");
      }
    } catch {
      return i18n.t("settings.configTab.backendUrlInvalidUrl");
    }

    if (!normalized.endsWith("/v1")) {
      return i18n.t("settings.configTab.backendUrlMustEndWithV1");
    }

    return null;
  };

  const handleSaveBackendBaseUrl = async () => {
    const error = validateBackendUrl(backendBaseUrl);
    if (error) {
      msgApi.error(error);
      return;
    }

    const normalized = normalizeBackendBaseUrl(backendBaseUrl);
    setBackendBaseUrl(normalized);
    setBackendBaseUrlState(normalized);
    setHasBackendOverride(true);
    msgApi.success(i18n.t("settings.configTab.backendSaved"));

    try {
      await refreshModels();
    } catch {}
  };

  const handleResetBackendBaseUrl = async () => {
    clearBackendBaseUrlOverride();
    setBackendBaseUrlState(getDefaultBackendBaseUrl());
    setHasBackendOverride(false);
    msgApi.success(i18n.t("settings.configTab.backendResetDefault"));

    try {
      await refreshModels();
    } catch {}
  };

  return {
    backendBaseUrl,
    setBackendBaseUrlState,
    hasBackendOverride,
    handleSaveBackendBaseUrl,
    handleResetBackendBaseUrl,
  };
};
