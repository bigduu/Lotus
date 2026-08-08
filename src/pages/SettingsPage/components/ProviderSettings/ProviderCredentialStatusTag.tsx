import { Tag } from "antd";
import { useTranslation } from "react-i18next";

import type { ProviderCredentialStatus } from "@services/config/configSections";
import { isEnvironmentCredential } from "./providerCredentialStatus";

export const ProviderCredentialStatusTag = ({
  status,
  pendingReplacement = false,
}: {
  status?: ProviderCredentialStatus | null;
  pendingReplacement?: boolean;
}) => {
  const { t } = useTranslation();

  if (isEnvironmentCredential(status)) {
    return <Tag color="processing">{t("settings.providerTab.credentialFromEnv")}</Tag>;
  }
  if (status?.configured || pendingReplacement) {
    return <Tag color="success">{t("settings.providerTab.credentialConfigured")}</Tag>;
  }
  return <Tag color="warning">{t("settings.providerTab.credentialMissing")}</Tag>;
};
