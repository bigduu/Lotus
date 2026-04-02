const VDI_SAFE_MODE_KEY = "lotus_vdi_safe_mode";

export const isVdiSafeModeEnabled = (): boolean => {
  try {
    return localStorage.getItem(VDI_SAFE_MODE_KEY) === "true";
  } catch {
    return false;
  }
};

export const setVdiSafeModeEnabled = (enabled: boolean): void => {
  try {
    localStorage.setItem(VDI_SAFE_MODE_KEY, enabled.toString());
  } catch (error) {
    console.error("[vdiSafeMode] Failed to persist setting:", error);
  }
};

export const getVdiSafeModeStorageKey = (): string => VDI_SAFE_MODE_KEY;
