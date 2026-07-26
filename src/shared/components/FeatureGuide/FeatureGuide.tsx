import { useEffect, useMemo, useRef, useState } from "react";
import { Tour } from "antd";
import type { TourProps } from "antd";
import { useTranslation } from "react-i18next";
import { isOnboardingComplete, markOnboardingComplete } from "./onboardingStorage";

const TOUR_TARGETS = [
  "new-session",
  "task-templates",
  "model-picker",
  "sidebar",
  "open-settings",
] as const;

interface ResolvedTargets {
  "new-session": HTMLElement | null;
  "task-templates": HTMLElement | null;
  "model-picker": HTMLElement | null;
  sidebar: HTMLElement | null;
  "open-settings": HTMLElement | null;
}

const queryTargets = (): ResolvedTargets => {
  const result: Record<string, HTMLElement | null> = {};
  for (const id of TOUR_TARGETS) {
    result[id] = document.querySelector(`[data-tour-id="${id}"]`);
  }
  return result as unknown as ResolvedTargets;
};

interface FeatureGuideProps {
  disabled?: boolean;
}

export const FeatureGuide: React.FC<FeatureGuideProps> = ({ disabled = false }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<ResolvedTargets | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (disabled || isOnboardingComplete()) return;

    const timer = setTimeout(() => {
      setOpen(true);
    }, 800);

    return () => clearTimeout(timer);
  }, [disabled]);

  // Re-query targets each time the tour opens — the initial mount timer
  // fires before the layout settles (sidebar hidden on mobile etc.), so
  // targets resolved only once at mount can be stale (#167).
  useEffect(() => {
    if (!open) return;
    setTargets(queryTargets());

    // Move focus into the tour panel so keyboard/screen-reader users
    // notice the overlay; restore it on close.
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => {
      const panel = document.querySelector<HTMLElement>(".ant-tour");
      const focusable =
        panel?.querySelector<HTMLElement>(".ant-tour-close") ??
        panel?.querySelector<HTMLElement>("button, [href], [tabindex]") ??
        panel;
      focusable?.focus?.();
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    if (open) return;
    previousFocusRef.current?.focus?.();
  }, [open]);

  const steps: TourProps["steps"] = useMemo(
    () => [
      {
        title: t("onboarding.welcome.title"),
        description: t("onboarding.welcome.description"),
        target: null,
      },
      {
        title: t("onboarding.newSession.title"),
        description: t("onboarding.newSession.description"),
        target: targets?.["new-session"] ?? undefined,
      },
      {
        title: t("onboarding.taskTemplates.title"),
        description: t("onboarding.taskTemplates.description"),
        target: targets?.["task-templates"] ?? undefined,
      },
      {
        title: t("onboarding.modelPicker.title"),
        description: t("onboarding.modelPicker.description"),
        target: targets?.["model-picker"] ?? undefined,
      },
      {
        title: t("onboarding.sidebar.title"),
        description: t("onboarding.sidebar.description"),
        target: targets?.sidebar ?? undefined,
      },
      {
        title: t("onboarding.settings.title"),
        description: t("onboarding.settings.description"),
        target: targets?.["open-settings"] ?? undefined,
      },
    ],
    [t, targets],
  );

  const handleClose = () => {
    markOnboardingComplete();
    setOpen(false);
  };

  return <Tour open={open} onClose={handleClose} steps={steps} />;
};
