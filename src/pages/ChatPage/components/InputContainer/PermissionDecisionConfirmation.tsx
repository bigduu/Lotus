import React, { useState } from "react";
import { Alert, Radio, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";

import {
  preferredPermissionMatcherId,
  type PermissionRequestContract,
} from "@shared/permissions/permissionContract";

const { Text } = Typography;

type DurablePermissionDecision = "allow_workspace" | "allow_global";

interface PermissionDecisionConfirmationProps {
  decision: DurablePermissionDecision;
  request: PermissionRequestContract;
  onMatcherChange: (matcherId: string) => void;
}

export const PermissionDecisionConfirmation: React.FC<PermissionDecisionConfirmationProps> = ({
  decision,
  request,
  onMatcherChange,
}) => {
  const { t } = useTranslation();
  const [matcherId, setMatcherId] = useState(() => preferredPermissionMatcherId(request) ?? "");
  const global = decision === "allow_global";

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Alert
        type={global ? "warning" : "info"}
        showIcon
        message={t(`components.questionDialog.confirmScopes.${decision}.description`)}
      />

      {!global && request.workspacePath ? (
        <Space direction="vertical" size={2}>
          <Text strong>{t("components.questionDialog.confirmScopes.workspace")}</Text>
          <Text code copyable>
            {request.workspacePath}
          </Text>
        </Space>
      ) : null}

      <Space direction="vertical" size="small" style={{ width: "100%" }}>
        <Text strong>{t("components.questionDialog.confirmScopes.matcher")}</Text>
        <Radio.Group
          value={matcherId}
          aria-label={t("components.questionDialog.confirmScopes.matcher")}
          onChange={(event) => {
            const nextMatcherId = String(event.target.value);
            setMatcherId(nextMatcherId);
            onMatcherChange(nextMatcherId);
          }}
        >
          <Space direction="vertical" style={{ width: "100%" }}>
            {request.suggestedMatchers.map((matcher) => (
              <Radio key={matcher.id} value={matcher.id}>
                <Space size="small" wrap>
                  <Text type="secondary">{matcher.kind}</Text>
                  <Text code style={{ overflowWrap: "anywhere" }}>
                    {matcher.value}
                  </Text>
                </Space>
              </Radio>
            ))}
          </Space>
        </Radio.Group>
      </Space>
    </Space>
  );
};

export default PermissionDecisionConfirmation;
