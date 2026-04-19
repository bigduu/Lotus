import type { GlobalToken } from "antd/es/theme/interface";
import React from "react";
import { Alert, Space } from "antd";
import { Typography } from "@/components/ui/typography";
import { useTranslation } from "react-i18next";
import type { WorkspaceValidationResult } from "../../utils/workspaceValidator";

const { Text } = Typography;

interface WorkspacePickerValidationStatusProps {
  result: WorkspaceValidationResult | null;
  token: GlobalToken;
}

const WorkspacePickerValidationStatus: React.FC<WorkspacePickerValidationStatusProps> = ({
  result,
  token,
}) => {
  const { t } = useTranslation();
  if (!result) return null;

  return (
    <div style={{ marginTop: token.marginXS }}>
      {result.is_valid ? (
        <Alert
          type="success"
          message={
            <Space>
              <span>{t("chat.workspace.validWorkspace")}</span>
              {result.workspace_name && <Text type="secondary">({result.workspace_name})</Text>}
              {result.file_count !== undefined && (
                <Text type="secondary">
                  {t("chat.workspace.fileCount", { count: result.file_count })}
                </Text>
              )}
            </Space>
          }
          showIcon
        />
      ) : (
        <Alert
          type="error"
          message={result.error_message || t("validation.invalidPath")}
          showIcon
        />
      )}
    </div>
  );
};

export default WorkspacePickerValidationStatus;
