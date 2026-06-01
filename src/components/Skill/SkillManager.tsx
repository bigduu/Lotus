import { useState, useEffect, useCallback, useMemo } from "react";
import { App as AntApp, Card, Input, List, Spin, Empty, Row, Button } from "antd";
import { SearchOutlined, ReloadOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { skillService } from "../../services/skill/SkillService";
import type { SkillDefinition } from "@shared/types/skill";
import { useBambooConfigStore } from "../../shared/store/bambooConfigStore";
import { SkillCard } from "./SkillCard";

// Refresh interval in milliseconds (30 seconds)
const REFRESH_INTERVAL = 30000;

export const SkillManager = () => {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const bambooConfig = useBambooConfigStore((state) => state.config);
  const loadConfig = useBambooConfigStore((state) => state.loadConfig);
  const saveConfig = useBambooConfigStore((state) => state.saveConfig);

  const [skills, setSkills] = useState<SkillDefinition[]>([]);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [savingSkillId, setSavingSkillId] = useState<string | null>(null);

  // Local state
  const [searchQuery, setSearchQuery] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const disabledSkillIds = useMemo(
    () =>
      new Set((bambooConfig?.skills?.disabled ?? []).map((value) => value.trim()).filter(Boolean)),
    [bambooConfig],
  );

  const loadSkillSettings = useCallback(
    async (refresh = true) => {
      setIsLoadingSkills(true);
      setSkillsError(null);
      try {
        const [skillResponse] = await Promise.all([
          skillService.listSkills({ includeDisabled: true }, refresh),
          loadConfig({ force: refresh }),
        ]);
        setSkills(skillResponse.skills);
        setLastRefresh(new Date());
      } catch (error) {
        const messageText =
          error instanceof Error ? error.message : t("components.skillManager.loadFailed");
        setSkillsError(messageText);
      } finally {
        setIsLoadingSkills(false);
      }
    },
    [loadConfig, t],
  );

  // Load skills on mount and periodically (with refresh from disk)
  useEffect(() => {
    void loadSkillSettings(true);

    const intervalId = setInterval(() => {
      void loadSkillSettings(true);
    }, REFRESH_INTERVAL);

    return () => clearInterval(intervalId);
  }, [loadSkillSettings]);

  // Refresh when window regains focus
  useEffect(() => {
    const handleFocus = () => {
      void loadSkillSettings(true);
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [loadSkillSettings]);

  // Manual refresh handler
  const handleRefresh = useCallback(async () => {
    await loadSkillSettings(true);
    message.success(t("components.skillManager.skillsRefreshed"));
  }, [loadSkillSettings, t]);

  // Show error message
  useEffect(() => {
    if (skillsError) {
      message.error(skillsError);
      setSkillsError(null);
    }
  }, [skillsError]);

  const handleToggleDisabled = useCallback(
    async (skillId: string, nextDisabled: boolean) => {
      setSavingSkillId(skillId);
      try {
        const latestConfig = await loadConfig({ force: true });
        const currentDisabled = latestConfig?.skills?.disabled ?? [];
        const nextDisabledList = Array.from(
          new Set(
            (nextDisabled
              ? [...currentDisabled, skillId]
              : currentDisabled.filter((value) => value !== skillId)
            )
              .map((value) => value.trim())
              .filter(Boolean),
          ),
        ).sort();

        await saveConfig({
          ...(latestConfig ?? {}),
          skills: {
            ...(latestConfig?.skills ?? {}),
            disabled: nextDisabledList,
          },
        });
        message.success(t("components.skillManager.skillStateSaved"));
      } catch (error) {
        message.error(
          error instanceof Error ? error.message : t("components.skillManager.saveFailed"),
        );
      } finally {
        setSavingSkillId(null);
      }
    },
    [loadConfig, saveConfig, t],
  );

  // Filter skills
  const filteredSkills = skills.filter((skill) => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    if (normalizedSearch) {
      const searchableText = [
        skill.name,
        skill.description,
        skill.license ?? "",
        skill.compatibility ?? "",
        ...skill.tool_refs,
      ]
        .join(" ")
        .toLowerCase();

      if (!searchableText.includes(normalizedSearch)) {
        return false;
      }
    }

    return true;
  });

  // Format last refresh time
  const formatLastRefresh = () => {
    const now = new Date();
    const diff = now.getTime() - lastRefresh.getTime();
    const seconds = Math.floor(diff / 1000);

    if (seconds < 5) return t("components.skillManager.justNow");
    if (seconds < 60) return t("components.skillManager.secondsAgo", { count: seconds });
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return t("components.skillManager.minutesAgo", { count: minutes });
    return lastRefresh.toLocaleTimeString();
  };

  return (
    <div style={{ padding: "24px" }}>
      <Card
        className="lotus-settings-card"
        title={
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span>{t("components.skillManager.title")}</span>
            <Button
              icon={<ReloadOutlined spin={isLoadingSkills} />}
              onClick={handleRefresh}
              loading={isLoadingSkills}
              size="small"
            >
              {t("components.skillManager.refresh")}
            </Button>
            <span className="lotus-settings-note" style={{ fontSize: "12px", marginLeft: "auto" }}>
              {t("components.skillManager.lastUpdated", {
                value: formatLastRefresh(),
              })}
            </span>
          </div>
        }
      >
        <div className="lotus-settings-note" style={{ marginBottom: "16px" }}>
          {t("components.skillManager.readOnlyHint")}
        </div>
        <div className="lotus-settings-note" style={{ marginBottom: "16px" }}>
          {t("components.skillManager.disabledHint")}
        </div>
        {/* Filters */}
        <Row style={{ marginBottom: "24px" }}>
          <Input
            placeholder={t("components.skillManager.searchPlaceholder")}
            prefix={<SearchOutlined />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            allowClear
          />
        </Row>

        {/* Skills Grid */}
        <Spin spinning={isLoadingSkills}>
          {filteredSkills.length === 0 ? (
            <Empty
              description={
                searchQuery
                  ? t("components.skillManager.noMatch")
                  : t("components.skillManager.noSkillsFound")
              }
            />
          ) : (
            <List
              grid={{
                gutter: 16,
                xs: 1,
                sm: 2,
                md: 3,
                lg: 3,
                xl: 4,
              }}
              dataSource={filteredSkills}
              renderItem={(skill) => (
                <List.Item>
                  <SkillCard
                    skill={skill}
                    disabled={disabledSkillIds.has(skill.id)}
                    busy={savingSkillId === skill.id}
                    onToggleDisabled={handleToggleDisabled}
                  />
                </List.Item>
              )}
            />
          )}
        </Spin>
      </Card>
    </div>
  );
};
