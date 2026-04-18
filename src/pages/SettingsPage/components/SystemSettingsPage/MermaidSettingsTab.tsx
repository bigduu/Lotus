import React from "react";
import {
  Card,
  Form,
  InputNumber,
  Switch,
  Select,
  Divider,
  Space,
  Typography,
  Row,
  Col,
  Tooltip,
} from "antd";
import { Button } from "@/components/ui/button";
import { RestOutlined, InfoCircleOutlined } from "@ant-design/icons";
import { theme } from "antd";
import { useTranslation } from "react-i18next";
import {
  useMermaidSettings,
  useUpdateMermaidSettings,
  useResetMermaidSettings,
} from "../../../../shared/store/mermaidSettingsStore";

const { Title, Text } = Typography;
const { useToken } = theme;

export const MermaidSettingsTab: React.FC = () => {
  const { t } = useTranslation();
  const { token } = useToken();
  const settings = useMermaidSettings();
  const updateSettings = useUpdateMermaidSettings();
  const resetSettings = useResetMermaidSettings();
  const [form] = Form.useForm();

  // Sync form with store
  React.useEffect(() => {
    form.setFieldsValue(settings);
  }, [settings, form]);

  const handleValuesChange = (changedValues: Partial<Record<string, unknown>>) => {
    updateSettings(changedValues);
  };

  const handleReset = () => {
    resetSettings();
    form.resetFields();
  };

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      <Title level={3} style={{ marginBottom: "8px" }}>
        {t("settings.mermaidTab.title")}
      </Title>
      <Text type="secondary" style={{ display: "block", marginBottom: "24px" }}>
        {t("settings.mermaidTab.description")}
      </Text>

      <Form
        form={form}
        layout="vertical"
        initialValues={settings}
        onValuesChange={handleValuesChange}
      >
        {/* Theme Selection */}
        <Card
          title={t("settings.mermaidTab.themeCardTitle")}
          style={{ marginBottom: "16px" }}
          styles={{
            header: { backgroundColor: token.colorBgElevated },
          }}
        >
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item
                name="theme"
                label={
                  <Space>
                    {t("settings.mermaidTab.themeLabel")}
                    <Tooltip title={t("settings.mermaidTab.themeTooltip")}>
                      <InfoCircleOutlined style={{ color: token.colorTextSecondary }} />
                    </Tooltip>
                  </Space>
                }
              >
                <Select>
                  <Select.Option value="default">
                    {t("settings.mermaidTab.themeOptions.default")}
                  </Select.Option>
                  <Select.Option value="neutral">
                    {t("settings.mermaidTab.themeOptions.neutral")}
                  </Select.Option>
                  <Select.Option value="dark">
                    {t("settings.mermaidTab.themeOptions.dark")}
                  </Select.Option>
                  <Select.Option value="forest">
                    {t("settings.mermaidTab.themeOptions.forest")}
                  </Select.Option>
                  <Select.Option value="base">
                    {t("settings.mermaidTab.themeOptions.base")}
                  </Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Text type="secondary" style={{ display: "block", marginTop: "8px" }}>
            <strong>{t("settings.mermaidTab.themeDescriptionsTitle")}</strong>
            <br />• {t("settings.mermaidTab.themeDescriptions.default")}
            <br />• {t("settings.mermaidTab.themeDescriptions.neutral")}
            <br />• {t("settings.mermaidTab.themeDescriptions.dark")}
            <br />• {t("settings.mermaidTab.themeDescriptions.forest")}
            <br />• {t("settings.mermaidTab.themeDescriptions.base")}
          </Text>
        </Card>

        {/* Global Settings */}
        <Card
          title={t("settings.mermaidTab.globalCardTitle")}
          style={{ marginBottom: "16px" }}
          styles={{
            header: { backgroundColor: token.colorBgElevated },
          }}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="fontSize"
                label={
                  <Space>
                    {t("settings.mermaidTab.fontSizeLabel")}
                    <Tooltip title={t("settings.mermaidTab.fontSizeTooltip")}>
                      <InfoCircleOutlined style={{ color: token.colorTextSecondary }} />
                    </Tooltip>
                  </Space>
                }
              >
                <InputNumber min={10} max={32} step={1} style={{ width: "100%" }} addonAfter="px" />
              </Form.Item>
            </Col>

            <Col span={12}>
              <Form.Item
                name="defaultScale"
                label={
                  <Space>
                    {t("settings.mermaidTab.defaultZoomLabel")}
                    <Tooltip title={t("settings.mermaidTab.defaultZoomTooltip")}>
                      <InfoCircleOutlined style={{ color: token.colorTextSecondary }} />
                    </Tooltip>
                  </Space>
                }
              >
                <InputNumber min={0.1} max={3} step={0.1} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="useMaxWidth"
            label={
              <Space>
                {t("settings.mermaidTab.responsiveWidthLabel")}
                <Tooltip title={t("settings.mermaidTab.responsiveWidthTooltip")}>
                  <InfoCircleOutlined style={{ color: token.colorTextSecondary }} />
                </Tooltip>
              </Space>
            }
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Card>

        {/* Flowchart Settings */}
        <Card
          title={t("settings.mermaidTab.flowchartCardTitle")}
          style={{ marginBottom: "16px" }}
          styles={{
            header: { backgroundColor: token.colorBgElevated },
          }}
        >
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="flowchartNodeSpacing"
                label={
                  <Space>
                    {t("settings.mermaidTab.flowchartNodeSpacingLabel")}
                    <Tooltip title={t("settings.mermaidTab.flowchartNodeSpacingTooltip")}>
                      <InfoCircleOutlined style={{ color: token.colorTextSecondary }} />
                    </Tooltip>
                  </Space>
                }
              >
                <InputNumber min={20} max={200} step={10} style={{ width: "100%" }} />
              </Form.Item>
            </Col>

            <Col span={8}>
              <Form.Item
                name="flowchartRankSpacing"
                label={
                  <Space>
                    {t("settings.mermaidTab.flowchartRankSpacingLabel")}
                    <Tooltip title={t("settings.mermaidTab.flowchartRankSpacingTooltip")}>
                      <InfoCircleOutlined style={{ color: token.colorTextSecondary }} />
                    </Tooltip>
                  </Space>
                }
              >
                <InputNumber min={20} max={200} step={10} style={{ width: "100%" }} />
              </Form.Item>
            </Col>

            <Col span={8}>
              <Form.Item
                name="flowchartCurve"
                label={
                  <Space>
                    {t("settings.mermaidTab.flowchartCurveTypeLabel")}
                    <Tooltip title={t("settings.mermaidTab.flowchartCurveTypeTooltip")}>
                      <InfoCircleOutlined style={{ color: token.colorTextSecondary }} />
                    </Tooltip>
                  </Space>
                }
              >
                <Select>
                  <Select.Option value="basis">
                    {t("settings.mermaidTab.flowchartCurveOptions.basis")}
                  </Select.Option>
                  <Select.Option value="linear">
                    {t("settings.mermaidTab.flowchartCurveOptions.linear")}
                  </Select.Option>
                  <Select.Option value="cardinal">
                    {t("settings.mermaidTab.flowchartCurveOptions.cardinal")}
                  </Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* Sequence Diagram Settings */}
        <Card
          title={t("settings.mermaidTab.sequenceCardTitle")}
          style={{ marginBottom: "16px" }}
          styles={{
            header: { backgroundColor: token.colorBgElevated },
          }}
        >
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item
                name="sequenceActorMargin"
                label={
                  <Space>
                    {t("settings.mermaidTab.sequenceActorMarginLabel")}
                    <Tooltip title={t("settings.mermaidTab.sequenceActorMarginTooltip")}>
                      <InfoCircleOutlined style={{ color: token.colorTextSecondary }} />
                    </Tooltip>
                  </Space>
                }
              >
                <InputNumber min={20} max={200} step={10} style={{ width: "100%" }} />
              </Form.Item>
            </Col>

            <Col span={6}>
              <Form.Item
                name="sequenceMessageMargin"
                label={
                  <Space>
                    {t("settings.mermaidTab.sequenceMessageMarginLabel")}
                    <Tooltip title={t("settings.mermaidTab.sequenceMessageMarginTooltip")}>
                      <InfoCircleOutlined style={{ color: token.colorTextSecondary }} />
                    </Tooltip>
                  </Space>
                }
              >
                <InputNumber min={10} max={100} step={5} style={{ width: "100%" }} />
              </Form.Item>
            </Col>

            <Col span={6}>
              <Form.Item
                name="sequenceWidth"
                label={
                  <Space>
                    {t("settings.mermaidTab.sequenceActorWidthLabel")}
                    <Tooltip title={t("settings.mermaidTab.sequenceActorWidthTooltip")}>
                      <InfoCircleOutlined style={{ color: token.colorTextSecondary }} />
                    </Tooltip>
                  </Space>
                }
              >
                <InputNumber min={100} max={300} step={10} style={{ width: "100%" }} />
              </Form.Item>
            </Col>

            <Col span={6}>
              <Form.Item
                name="sequenceHeight"
                label={
                  <Space>
                    {t("settings.mermaidTab.sequenceActorHeightLabel")}
                    <Tooltip title={t("settings.mermaidTab.sequenceActorHeightTooltip")}>
                      <InfoCircleOutlined style={{ color: token.colorTextSecondary }} />
                    </Tooltip>
                  </Space>
                }
              >
                <InputNumber min={40} max={150} step={5} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* Gantt Chart Settings */}
        <Card
          title={t("settings.mermaidTab.ganttCardTitle")}
          style={{ marginBottom: "16px" }}
          styles={{
            header: { backgroundColor: token.colorBgElevated },
          }}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="ganttBarHeight"
                label={
                  <Space>
                    {t("settings.mermaidTab.ganttBarHeightLabel")}
                    <Tooltip title={t("settings.mermaidTab.ganttBarHeightTooltip")}>
                      <InfoCircleOutlined style={{ color: token.colorTextSecondary }} />
                    </Tooltip>
                  </Space>
                }
              >
                <InputNumber min={10} max={50} step={5} style={{ width: "100%" }} addonAfter="px" />
              </Form.Item>
            </Col>

            <Col span={12}>
              <Form.Item
                name="ganttTopPadding"
                label={
                  <Space>
                    {t("settings.mermaidTab.ganttTopPaddingLabel")}
                    <Tooltip title={t("settings.mermaidTab.ganttTopPaddingTooltip")}>
                      <InfoCircleOutlined style={{ color: token.colorTextSecondary }} />
                    </Tooltip>
                  </Space>
                }
              >
                <InputNumber min={20} max={100} step={10} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* Actions */}
        <Space>
          <Button icon={<RestOutlined />} onClick={handleReset}>
            {t("settings.mermaidTab.resetToDefaults")}
          </Button>
        </Space>

        <Divider />

        {/* Preview */}
        <Card
          title={t("settings.mermaidTab.previewTitle")}
          styles={{
            header: { backgroundColor: token.colorBgElevated },
          }}
        >
          <Text type="secondary">{t("settings.mermaidTab.previewDescription")}</Text>
        </Card>
      </Form>
    </div>
  );
};

export default MermaidSettingsTab;
