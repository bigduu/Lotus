import React, { useEffect, useMemo } from "react";
import { Select, Space } from "antd";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../pages/ChatPage/store";

interface SkillSelectorProps {
  selectedSkillIds: string[];
  onChange: (skillIds: string[]) => void;
  sessionId?: string;
}

export const SkillSelector: React.FC<SkillSelectorProps> = ({ selectedSkillIds, onChange }) => {
  const { t } = useTranslation();
  const skills = useAppStore((state) => state.skills);
  const isLoadingSkills = useAppStore((state) => state.isLoadingSkills);
  const loadSkills = useAppStore((state) => state.loadSkills);

  useEffect(() => {
    if (skills.length === 0) {
      loadSkills();
    }
  }, [skills.length, loadSkills]);

  const options = useMemo(
    () =>
      skills.map((skill) => {
        return {
          value: skill.id,
          label: (
            <Space size="small">
              <span>{skill.name}</span>
            </Space>
          ),
          searchText: [
            skill.name,
            skill.description,
            skill.license ?? "",
            skill.compatibility ?? "",
            ...skill.tool_refs,
          ]
            .join(" ")
            .toLowerCase(),
        };
      }),
    [skills],
  );

  return (
    <Select
      mode="multiple"
      placeholder={t("components.skillSelector.placeholder")}
      value={selectedSkillIds}
      onChange={onChange}
      options={options}
      loading={isLoadingSkills}
      style={{ width: "100%" }}
      filterOption={(input, option) =>
        (option as { searchText?: string })?.searchText?.includes(input.toLowerCase()) ?? false
      }
      allowClear
    />
  );
};
