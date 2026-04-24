const STORAGE_KEY = "bodhi_onboarding_complete";

export const isOnboardingComplete = (): boolean => localStorage.getItem(STORAGE_KEY) === "true";

export const markOnboardingComplete = (): void => localStorage.setItem(STORAGE_KEY, "true");

export const resetOnboarding = (): void => localStorage.removeItem(STORAGE_KEY);
