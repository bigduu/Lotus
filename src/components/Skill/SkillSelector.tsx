import React, { useEffect, useMemo } from "react";
import { Alert, Select, Space } from "antd";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@shared/store/appStore";
import { useConfigSectionStore } from "../../shared/store/configSectionStore";

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
  const toolsSkills = useConfigSectionStore((state) => state.sections["tools-skills"]);
  const loadSection = useConfigSectionStore((state) => state.loadSection);

  useEffect(() => {
    if (skills.length === 0) {
      loadSkills();
    }
    void loadSection("tools-skills").catch(() => undefined);
  }, [skills.length, loadSkills, loadSection]);

  const disabledSkillIds = useMemo(
    () =>
      new Set(
        (toolsSkills.envelope?.data.skills?.disabled ?? [])
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    [toolsSkills.envelope],
  );

  const disabledSelectedSkillIds = useMemo(
    () => selectedSkillIds.filter((skillId) => disabledSkillIds.has(skillId)),
    [disabledSkillIds, selectedSkillIds],
  );

  const visibleSelectedSkillIds = useMemo(
    () => selectedSkillIds.filter((skillId) => !disabledSkillIds.has(skillId)),
    [disabledSkillIds, selectedSkillIds],
  );

  useEffect(() => {
    if (
      disabledSelectedSkillIds.length > 0 &&
      visibleSelectedSkillIds.length !== selectedSkillIds.length
    ) {
      onChange(visibleSelectedSkillIds);
    }
  }, [disabledSelectedSkillIds.length, onChange, selectedSkillIds.length, visibleSelectedSkillIds]);

  const options = useMemo(
    () =>
      skills
        .filter((skill) => !disabledSkillIds.has(skill.id))
        .map((skill) => {
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
    [disabledSkillIds, skills],
  );

  return (
    <Space direction="vertical" size="small" style={{ width: "100%" }}>
      {disabledSelectedSkillIds.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message={t("components.skillSelector.disabledSkillsHint", {
            count: disabledSelectedSkillIds.length,
          })}
        />
      )}
      <Select
        mode="multiple"
        placeholder={t("components.skillSelector.placeholder")}
        value={visibleSelectedSkillIds}
        onChange={onChange}
        options={options}
        loading={isLoadingSkills}
        style={{ width: "100%" }}
        filterOption={(input, option) =>
          (option as { searchText?: string })?.searchText?.includes(input.toLowerCase()) ?? false
        }
        allowClear
      />
    </Space>
  );
};
