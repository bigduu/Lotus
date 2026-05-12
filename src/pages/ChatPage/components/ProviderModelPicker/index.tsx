import { useMemo, useCallback, useEffect } from "react";
import { Dropdown, Button, Space, Tag } from "antd";
import { DownOutlined } from "@ant-design/icons";
import i18n from "i18next";
import { useProviderStore } from "../../store/slices/providerSlice";
import type { ProviderModelRef } from "../../types/providerModelRef";
import type { MenuProps } from "antd";

export function ProviderModelPicker({
  value,
  onChange,
  disabled,
}: {
  value?: ProviderModelRef | null;
  onChange: (ref: ProviderModelRef) => void | Promise<void>;
  disabled?: boolean;
}) {
  const catalog = useProviderStore((s) => s.catalog);

  useEffect(() => {
    if (!catalog) {
      void useProviderStore.getState().loadCatalog();
    }
  }, [catalog]);

  const menuItems = useMemo(() => {
    if (!catalog?.models) return [];

    const grouped: Record<string, { display: string; models: typeof catalog.models }> = {};
    for (const model of catalog.models) {
      const provider = model.reference.provider;
      if (!grouped[provider]) {
        grouped[provider] = { display: model.provider_display_name, models: [] };
      }
      grouped[provider].models.push(model);
    }

    const items: MenuProps["items"] = [];
    const providerKeys = Object.keys(grouped);
    providerKeys.forEach((provider, index) => {
      const group = grouped[provider];
      if (index > 0) {
        items.push({ type: "divider" });
      }
      items.push({
        type: "group",
        label: group.display,
        children: group.models.map((m) => ({
          key: `${m.reference.provider}/${m.reference.model}`,
          label: (
            <Space size={4}>
              <span>{m.display_name}</span>
              {m.capabilities.supports_vision && (
                <Tag color="blue" style={{ fontSize: 10, lineHeight: "16px", padding: "0 3px" }}>
                  Vision
                </Tag>
              )}
            </Space>
          ),
        })),
      });
    });

    return items;
  }, [catalog]);

  const selectedKey = value ? `${value.provider}/${value.model}` : undefined;

  const handleSelect = useCallback(
    (info: { key: string }) => {
      const [provider, ...rest] = info.key.split("/");
      const model = rest.join("/");
      if (provider && model) {
        onChange({ provider, model });
      }
    },
    [onChange],
  );

  return (
    <Space size={4} data-tour-id="model-picker">
      <Dropdown
        trigger={["click"]}
        placement="topLeft"
        menu={{
          selectable: true,
          selectedKeys: selectedKey ? [selectedKey] : [],
          items: menuItems,
          style: { maxHeight: "50vh", overflowY: "auto" },
          onClick: handleSelect,
        }}
        disabled={disabled}
      >
        <Button
          type="text"
          size="small"
          disabled={disabled}
          style={{ minWidth: 146, padding: "0 12px", height: 36, borderRadius: 18 }}
          title={value ? `${value.provider}/${value.model}` : i18n.t("chat.model.selectModel")}
        >
          <Space size={4}>
            <span
              style={{
                maxWidth: 150,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: 13,
              }}
            >
              {value ? `${value.provider}/${value.model}` : i18n.t("chat.model.selectModel")}
            </span>
            <DownOutlined style={{ fontSize: 10 }} />
          </Space>
        </Button>
      </Dropdown>
    </Space>
  );
}
