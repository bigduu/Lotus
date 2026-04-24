import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, Typography } from "antd";
import { SettingOutlined, RocketOutlined } from "@ant-design/icons";
import { ServiceFactory } from "../../services/common/ServiceFactory";

import "./SetupPage.css";

const OPEN_PROVIDER_FLAG = "bodhi_open_provider_on_entry";

const { Title, Paragraph } = Typography;

export const SetupPage = () => {
  const { t } = useTranslation();
  const [isComplete, setIsComplete] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const completeSetup = async (openProviderOnEntry: boolean) => {
    try {
      setErrorMessage(null);
      setIsSaving(true);
      const serviceFactory = ServiceFactory.getInstance();
      await serviceFactory.markSetupComplete();
      if (openProviderOnEntry) {
        localStorage.setItem(OPEN_PROVIDER_FLAG, "true");
      }
      setIsComplete(true);
    } catch (error) {
      console.error("Failed to complete setup:", error);
      setErrorMessage(t("setup.error.completeFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  if (isComplete) {
    return (
      <div data-testid="setup-complete" className="setup-complete">
        <Title level={2}>{t("setup.complete.title")}</Title>
        <Paragraph>{t("setup.complete.restartMessage")}</Paragraph>
        <Button data-testid="setup-restart" onClick={() => window.location.reload()}>
          {t("setup.complete.restartMessage")}
        </Button>
      </div>
    );
  }

  return (
    <div className="setup-page">
      <Card className="setup-page__card">
        <div className="setup-page__hero">
          <div className="setup-page__hero-icon">
            <RocketOutlined />
          </div>
          <Title level={2} style={{ marginTop: 0 }}>
            {t("setup.welcome.heading")}
          </Title>
          <Paragraph type="secondary">{t("setup.welcome.description")}</Paragraph>
        </div>

        <Alert
          message={t("setup.welcome.providerHint")}
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />

        <Alert
          message={t("setup.welcome.proxyHint")}
          type="info"
          showIcon
          style={{ marginBottom: 24 }}
        />

        {errorMessage ? (
          <Alert message={errorMessage} type="error" showIcon style={{ marginBottom: 16 }} />
        ) : null}

        <div className="setup-page__actions">
          <Button
            data-testid="setup-configure-provider"
            icon={<SettingOutlined />}
            onClick={() => void completeSetup(true)}
            loading={isSaving}
          >
            {t("setup.button.configureProvider")}
          </Button>
          <Button
            data-testid="setup-get-started"
            type="primary"
            icon={<RocketOutlined />}
            onClick={() => void completeSetup(false)}
            loading={isSaving}
          >
            {t("setup.button.getStarted")}
          </Button>
        </div>
      </Card>
    </div>
  );
};
