import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, Input, Space, Typography } from "antd";

const { Title, Text } = Typography;

interface PasswordGatePageProps {
  onVerified: () => Promise<void> | void;
  verifyPassword: (password: string) => Promise<void>;
}

export const PasswordGatePage = ({ onVerified, verifyPassword }: PasswordGatePageProps) => {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    const trimmed = password.trim();
    if (!trimmed) {
      setErrorMessage(t("app.passwordGate.validation.required"));
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await verifyPassword(trimmed);
      await onVerified();
      setPassword("");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("app.passwordGate.validation.verifyFailed");
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <Card style={{ width: "100%", maxWidth: 480 }}>
        <Space direction="vertical" size={20} style={{ width: "100%" }}>
          <div>
            <Title level={3} style={{ marginBottom: 8 }}>
              {t("app.passwordGate.title")}
            </Title>
            <Text type="secondary">{t("app.passwordGate.description")}</Text>
          </div>

          {errorMessage ? <Alert type="error" showIcon message={errorMessage} /> : null}

          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Text strong>{t("app.passwordGate.passwordLabel")}</Text>
            <Input.Password
              value={password}
              autoFocus
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              onPressEnter={() => void handleSubmit()}
              placeholder={t("app.passwordGate.passwordPlaceholder")}
            />
          </Space>

          <Button type="primary" block loading={isSubmitting} onClick={() => void handleSubmit()}>
            {t("app.passwordGate.submit")}
          </Button>
        </Space>
      </Card>
    </div>
  );
};

export default PasswordGatePage;
