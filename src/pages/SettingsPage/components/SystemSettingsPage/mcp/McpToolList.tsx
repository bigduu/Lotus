import { Card, Collapse, Empty, List, Space, Typography } from "antd";
import type { McpServer, McpToolInfo } from "../../../../../services/mcp";
import JsonSchemaViewer from "../../../../../shared/components/JsonSchemaViewer";
import { useTranslation } from "react-i18next";

const { Text } = Typography;

interface McpToolListProps {
  server: McpServer | null;
  tools: McpToolInfo[];
  loading?: boolean;
}

const buildExpectedAlias = (serverId: string, toolName: string): string =>
  `mcp__${serverId}__${toolName}`;

export const McpToolList: React.FC<McpToolListProps> = ({
  server,
  tools,
  loading = false,
}) => {
  const { t } = useTranslation();
  return (
    <Card title={t("settings.mcpToolList.title")} size="small">
      {!server ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("settings.mcpToolList.selectServerHint")}
        />
      ) : (
        <List
          loading={loading}
          dataSource={tools}
          locale={{ emptyText: t("settings.mcpToolList.empty") }}
          renderItem={(tool) => {
            const expectedAlias = buildExpectedAlias(
              tool.server_id,
              tool.original_name,
            );
            return (
              <List.Item>
                <Space direction="vertical" size={2} style={{ width: "100%" }}>
                  <Text strong>{tool.original_name}</Text>
                  <Text type="secondary">
                    {tool.description || t("settings.mcpToolList.noDescription")}
                  </Text>
                  <Text code>{tool.alias}</Text>
                  <Text type="secondary">
                    {t("settings.mcpToolList.aliasMapping")}:{" "}
                    <Text code>{expectedAlias}</Text>
                  </Text>
                  {tool.parameters !== undefined && (
                    <Collapse
                      size="small"
                      items={[
                        {
                          key: "schema",
                          label: t("settings.mcpToolList.parametersSchema"),
                          children: (
                            <JsonSchemaViewer schema={tool.parameters} />
                          ),
                        },
                      ]}
                    />
                  )}
                </Space>
              </List.Item>
            );
          }}
        />
      )}
    </Card>
  );
};
