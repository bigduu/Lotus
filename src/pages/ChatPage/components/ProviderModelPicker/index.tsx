import { useMemo, useCallback, useEffect, useState } from "react";
import { Dropdown, Button, Input, Space, Tag, theme } from "antd";
import { DownOutlined, SearchOutlined } from "@ant-design/icons";
import i18n from "i18next";
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice";
import type { ProviderModelRef } from "@shared/types/providerModelRef";
import type { MenuProps } from "antd";

const normalizeSearchText = (value: string) =>
  value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[\s\-_.:/]+/g, "");

const fuzzyMatch = (query: string, candidate: string) => {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  const normalizedCandidate = normalizeSearchText(candidate);
  if (normalizedCandidate.includes(normalizedQuery)) return true;

  let queryIndex = 0;
  for (const character of normalizedCandidate) {
    if (character === normalizedQuery[queryIndex]) {
      queryIndex += 1;
      if (queryIndex === normalizedQuery.length) return true;
    }
  }

  return false;
};

export function ProviderModelPicker({
  value,
  onChange,
  disabled,
  dataTestId,
  appearance = "default",
}: {
  value?: ProviderModelRef | null;
  onChange: (ref: ProviderModelRef) => void | Promise<void>;
  disabled?: boolean;
  dataTestId?: string;
  appearance?: "default" | "contrast";
}) {
  const { token } = theme.useToken();
  const [searchQuery, setSearchQuery] = useState("");
  const catalog = useProviderStore((s) => s.catalog);
  const getProviderDisplayLabel = useProviderStore((s) => s.getProviderDisplayLabel);

  useEffect(() => {
    if (!catalog) {
      void useProviderStore.getState().loadCatalog();
    }
  }, [catalog]);

  const menuItems = useMemo(() => {
    if (!catalog?.models) return [];

    const grouped: Record<string, { display: string; models: typeof catalog.models }> = {};
    for (const model of catalog.models) {
      const searchText = [
        model.reference.provider,
        model.provider_display_name,
        model.reference.model,
        model.display_name,
      ].join(" ");
      if (!fuzzyMatch(searchQuery, searchText)) continue;

      const provider = model.reference.provider;
      if (!grouped[provider]) {
        grouped[provider] = { display: model.provider_display_name, models: [] };
      }
      grouped[provider].models.push(model);
    }

    const items: MenuProps["items"] = [];
    Object.values(grouped).forEach((group, index) => {
      if (index > 0) {
        items.push({ type: "divider" });
      }
      items.push({
        type: "group",
        label: group.display,
        children: group.models.map((model) => ({
          key: `${model.reference.provider}/${model.reference.model}`,
          label: (
            <Space size={4}>
              <span>{model.display_name}</span>
              {model.capabilities.supports_vision && (
                <Tag color="blue" style={{ fontSize: 10, lineHeight: "16px", padding: "0 3px" }}>
                  Vision
                </Tag>
              )}
            </Space>
          ),
        })),
      });
    });

    if (items.length === 0) {
      items.push({
        key: "__no_results__",
        disabled: true,
        label: i18n.t("chat.model.noModelsAvailable"),
      });
    }

    return items;
  }, [catalog, searchQuery]);

  const selectedKey = value ? `${value.provider}/${value.model}` : undefined;
  const selectedProviderLabel = value ? getProviderDisplayLabel(value.provider) : undefined;
  const selectedButtonLabel = value
    ? `${selectedProviderLabel || value.provider}/${value.model}`
    : i18n.t("chat.model.selectModel");

  const handleSelect = useCallback(
    (info: { key: string }) => {
      if (info.key === "__no_results__") return;

      const [provider, ...rest] = info.key.split("/");
      const model = rest.join("/");
      if (provider && model) {
        onChange({ provider, model });
      }
    },
    [onChange],
  );

  const buttonStyle =
    appearance === "contrast"
      ? {
          minWidth: 220,
          width: "100%",
          justifyContent: "space-between",
          padding: "0 12px",
          height: 36,
          borderRadius: token.borderRadiusLG,
          background: token.colorBgElevated,
          border: `1px solid ${token.colorBorder}`,
          boxShadow: "none",
        }
      : {
          minWidth: 146,
          padding: "0 12px",
          height: 36,
          borderRadius: 18,
        };

  const labelStyle =
    appearance === "contrast"
      ? {
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: 13,
          textAlign: "left" as const,
        }
      : {
          maxWidth: 150,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: 13,
        };

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
        dropdownRender={(menu) => (
          <div
            onKeyDownCapture={(event) => {
              if (event.key !== "Enter" || !(event.target instanceof HTMLElement)) return;

              const focusedItem = event.target.closest<HTMLElement>(
                ".ant-dropdown-menu-item:not(.ant-dropdown-menu-item-disabled)",
              );
              if (!focusedItem) return;

              event.preventDefault();
              focusedItem.click();
            }}
            style={{
              minWidth: 260,
              maxWidth: "calc(100vw - 32px)",
              background: token.colorBgElevated,
              borderRadius: token.borderRadiusLG,
            }}
          >
            <div style={{ padding: token.paddingXS }}>
              <Input
                autoFocus
                allowClear
                data-testid="provider-model-search"
                prefix={<SearchOutlined />}
                placeholder={i18n.t("chat.model.selectModel")}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") return;

                  event.stopPropagation();
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    event.currentTarget
                      .closest(".ant-dropdown")
                      ?.querySelector<HTMLElement>(
                        ".ant-dropdown-menu-item:not(.ant-dropdown-menu-item-disabled)",
                      )
                      ?.focus();
                  }
                }}
              />
            </div>
            {menu}
          </div>
        )}
        onOpenChange={(open) => {
          if (!open) setSearchQuery("");
        }}
        disabled={disabled}
      >
        <Button
          data-testid={dataTestId}
          type={appearance === "contrast" ? "default" : "text"}
          size="small"
          block={appearance === "contrast"}
          disabled={disabled}
          style={buttonStyle}
          title={selectedButtonLabel}
        >
          <Space size={4} style={{ width: "100%", justifyContent: "space-between" }}>
            <span style={labelStyle}>{selectedButtonLabel}</span>
            <DownOutlined style={{ fontSize: 10 }} />
          </Space>
        </Button>
      </Dropdown>
    </Space>
  );
}
