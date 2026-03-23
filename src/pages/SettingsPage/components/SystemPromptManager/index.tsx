import { useState } from "react";
import {
  Button,
  List,
  Modal,
  Form,
  Input,
  Popconfirm,
  message,
  Tag,
} from "antd";
import { EditOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../../ChatPage/store";
import { UserSystemPrompt } from "../../../ChatPage/types/chat";

const SystemPromptManager = () => {
  const { t } = useTranslation();
  const systemPrompts = useAppStore((state) => state.systemPrompts);
  const addSystemPrompt = useAppStore((state) => state.addSystemPrompt);
  const updateSystemPrompt = useAppStore((state) => state.updateSystemPrompt);
  const deleteSystemPrompt = useAppStore((state) => state.deleteSystemPrompt);

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<UserSystemPrompt | null>(
    null,
  );
  const [form] = Form.useForm();

  const showModal = (prompt: UserSystemPrompt | null = null) => {
    if (prompt?.isDefault) {
      message.warning(t("settings.systemPromptManager.defaultPromptLocked"));
      return;
    }

    setEditingPrompt(prompt);
    form.setFieldsValue(prompt || { name: "", description: "", content: "" });
    setIsModalVisible(true);
  };

  const handleCancel = () => {
    setIsModalVisible(false);
    setEditingPrompt(null);
    form.resetFields();
  };

  const handleOk = async () => {
    if (editingPrompt?.isDefault) {
      message.warning(t("settings.systemPromptManager.defaultPromptLocked"));
      return;
    }

    try {
      const values = await form.validateFields();
      if (editingPrompt) {
        await updateSystemPrompt({ ...editingPrompt, ...values });
        message.success(t("settings.systemPromptManager.updateSuccess"));
      } else {
        await addSystemPrompt(values);
        message.success(t("settings.systemPromptManager.addSuccess"));
      }
      handleCancel();
    } catch (error) {
      console.error("Failed to save prompt:", error);
      message.error(
        error instanceof Error
          ? error.message
          : t("settings.systemPromptManager.saveError"),
      );
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSystemPrompt(id);
      message.success(t("settings.systemPromptManager.deleteSuccess"));
    } catch (error) {
      console.error("Failed to delete prompt:", error);
      message.error(
        error instanceof Error
          ? error.message
          : t("settings.systemPromptManager.deleteError"),
      );
    }
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <h2>{t("settings.systemPromptManager.title")}</h2>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => showModal()}
        >
          {t("settings.systemPromptManager.addButton")}
        </Button>
      </div>
      <List
        itemLayout="horizontal"
        dataSource={systemPrompts}
        renderItem={(item) => (
          <List.Item
            actions={[
              item.isDefault ? null : (
                <Button
                  type="text"
                  icon={<EditOutlined />}
                  onClick={() => showModal(item)}
                />
              ),
              item.isDefault ? null : (
                <Popconfirm
                  title={t("settings.systemPromptManager.deleteConfirm")}
                  onConfirm={() => handleDelete(item.id)}
                  okText={t("common.yes")}
                  cancelText={t("common.no")}
                >
                  <Button type="text" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              ),
            ]}
          >
            <List.Item.Meta
              title={item.name}
              description={
                item.description ||
                item.content.substring(0, 200) +
                  (item.content.length > 200 ? "..." : "")
              }
            />
            {item.isDefault && (
              <Tag>{t("settings.systemPromptManager.defaultTag")}</Tag>
            )}
          </List.Item>
        )}
      />
      <Modal
        title={
          editingPrompt
            ? t("settings.systemPromptManager.editTitle")
            : t("settings.systemPromptManager.addTitle")
        }
        open={isModalVisible}
        onOk={handleOk}
        onCancel={handleCancel}
        width="60%"
      >
        <Form form={form} layout="vertical" name="system_prompt_form">
          <Form.Item
            name="name"
            label={t("settings.systemPromptManager.nameLabel")}
            rules={[
              {
                required: true,
                message: t("settings.systemPromptManager.nameRequired"),
              },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="description"
            label={t("settings.systemPromptManager.descriptionLabel")}
            rules={[
              {
                required: false,
                message: t("settings.systemPromptManager.descriptionRequired"),
              },
            ]}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item
            name="content"
            label={t("settings.systemPromptManager.contentLabel")}
            rules={[
              {
                required: true,
                message: t("settings.systemPromptManager.contentRequired"),
              },
            ]}
          >
            <Input.TextArea rows={10} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default SystemPromptManager;
