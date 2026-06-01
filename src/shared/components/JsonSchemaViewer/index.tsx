import React, { useMemo } from "react";
import { Descriptions, Table, Typography, theme } from "antd";
import type { DescriptionsProps, TableProps } from "antd";
import { useTranslation } from "react-i18next";

import { safeStringify } from "@shared/utils/resultFormatters";
import { summarizeJsonSchema, type JsonSchemaField } from "../../utils/jsonSchema";

const { Text } = Typography;

type JsonSchemaViewerProps = {
  schema: unknown;
};

const renderValue = (value: unknown): string => {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  return safeStringify(value, 0);
};

export const JsonSchemaViewer: React.FC<JsonSchemaViewerProps> = ({ schema }) => {
  const { token } = theme.useToken();
  const { t } = useTranslation();

  const summary = useMemo(() => summarizeJsonSchema(schema), [schema]);

  if (!summary) {
    return (
      <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {safeStringify(schema, 2)}
      </pre>
    );
  }

  const columns = [
    {
      title: t("components.jsonSchema.field"),
      dataIndex: "name",
      key: "name",
      width: 180,
      render: (name: string) => <Text code>{name}</Text>,
    },
    {
      title: t("components.jsonSchema.type"),
      dataIndex: "type",
      key: "type",
      width: 140,
      render: (t: string) => <Text>{t}</Text>,
    },
    {
      title: t("components.jsonSchema.required"),
      dataIndex: "required",
      key: "required",
      width: 110,
      render: (req: boolean) =>
        req ? (
          <Text strong style={{ color: token.colorError }}>
            {t("components.jsonSchema.yes")}
          </Text>
        ) : (
          <Text type="secondary">{t("components.jsonSchema.no")}</Text>
        ),
    },
    {
      title: t("components.jsonSchema.default"),
      dataIndex: "defaultValue",
      key: "default",
      width: 160,
      render: (v: unknown) =>
        v === undefined ? <Text type="secondary">-</Text> : <Text>{renderValue(v)}</Text>,
    },
    {
      title: t("components.jsonSchema.description"),
      dataIndex: "description",
      key: "description",
      render: (d?: string) =>
        d ? <Text style={{ whiteSpace: "pre-wrap" }}>{d}</Text> : <Text type="secondary">-</Text>,
    },
  ] as const;

  const dataSource = (summary.fields ?? []).map((f: JsonSchemaField) => ({
    ...f,
    key: f.name,
  }));

  return (
    <div style={{ width: "100%" }}>
      <Descriptions
        size="small"
        column={1}
        items={
          [
            summary.schemaUri
              ? {
                  key: "schema",
                  label: "$schema",
                  children: <Text code>{summary.schemaUri}</Text>,
                }
              : null,
            typeof summary.additionalProperties === "boolean"
              ? {
                  key: "additionalProperties",
                  label: "additionalProperties",
                  children: <Text>{summary.additionalProperties ? "true" : "false"}</Text>,
                }
              : null,
          ].filter(Boolean) as DescriptionsProps["items"]
        }
      />

      <Table
        size="small"
        pagination={false}
        columns={columns as unknown as TableProps["columns"]}
        dataSource={dataSource}
        locale={{ emptyText: t("components.jsonSchema.noProperties") }}
        style={{ marginTop: token.marginSM }}
      />
    </div>
  );
};

export default JsonSchemaViewer;
