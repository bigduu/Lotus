import { useEffect, useMemo } from "react";
import { Select, Tag, Space } from "antd";
import { useTranslation } from "react-i18next";
import { useProviderStore } from "../../../ChatPage/store/slices/providerSlice";

const { Option } = Select;

interface CatalogModelSelectProps {
  provider: string;
  value?: string;
  onChange?: (value: string | undefined) => void;
  disabled?: boolean;
  placeholder?: string;
}

export const CatalogModelSelect: React.FC<CatalogModelSelectProps> = ({
  provider,
  value,
  onChange,
  disabled,
  placeholder,
}) => {
  const { t } = useTranslation();
  const catalog = useProviderStore((s) => s.catalog);

  useEffect(() => {
    if (!catalog) {
      useProviderStore.getState().loadCatalog();
    }
  }, [catalog]);

  const models = useMemo(() => {
    if (!catalog?.models) return [];
    return catalog.models.filter((m) => m.reference.provider === provider);
  }, [catalog, provider]);

  return (
    <Select
      value={value}
      onChange={onChange}
      disabled={disabled}
      placeholder={placeholder}
      allowClear
      showSearch
      notFoundContent={
        models.length === 0 ? <span>{t("settings.providerTab.noCatalogModels")}</span> : null
      }
    >
      {models.map((model) => (
        <Option key={model.reference.model} value={model.reference.model}>
          <Space size={4}>
            <span>{model.display_name}</span>
            {model.capabilities.supports_vision && (
              <Tag color="blue" style={{ fontSize: 11, lineHeight: "18px", padding: "0 4px" }}>
                {t("settings.providerTab.capabilityVision")}
              </Tag>
            )}
            {model.capabilities.supports_tools && (
              <Tag color="green" style={{ fontSize: 11, lineHeight: "18px", padding: "0 4px" }}>
                {t("settings.providerTab.capabilityTools")}
              </Tag>
            )}
            {model.capabilities.supports_reasoning && (
              <Tag color="orange" style={{ fontSize: 11, lineHeight: "18px", padding: "0 4px" }}>
                {t("settings.providerTab.capabilityReasoning")}
              </Tag>
            )}
          </Space>
        </Option>
      ))}
    </Select>
  );
};
