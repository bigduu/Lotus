import { useState, useEffect, useCallback } from "react";
import {
  Card,
  Input,
  List,
  message,
  Spin,
  Empty,
  Row,
  Button,
} from "antd";
import { SearchOutlined, ReloadOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../pages/ChatPage/store";
import { SkillCard } from "./SkillCard";

// Refresh interval in milliseconds (30 seconds)
const REFRESH_INTERVAL = 30000;

export const SkillManager = () => {
  const { t } = useTranslation();
  // State from store
  const skills = useAppStore((state) => state.skills);
  const isLoadingSkills = useAppStore((state) => state.isLoadingSkills);
  const skillsError = useAppStore((state) => state.skillsError);

  // Actions from store
  const loadSkills = useAppStore((state) => state.loadSkills);
  const clearSkillsError = useAppStore((state) => state.clearSkillsError);

  // Local state
  const [searchQuery, setSearchQuery] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  // Load skills on mount and periodically (with refresh from disk)
  useEffect(() => {
    loadSkills(undefined, true);

    // Set up periodic refresh
    const intervalId = setInterval(() => {
      loadSkills(undefined, true);
      setLastRefresh(new Date());
    }, REFRESH_INTERVAL);

    return () => clearInterval(intervalId);
  }, [loadSkills]);

  // Refresh when window regains focus
  useEffect(() => {
    const handleFocus = () => {
      loadSkills(undefined, true);
      setLastRefresh(new Date());
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [loadSkills]);

  // Manual refresh handler
  const handleRefresh = useCallback(async () => {
    await loadSkills(undefined, true);
    setLastRefresh(new Date());
    message.success(t("components.skillManager.skillsRefreshed"));
  }, [loadSkills, t]);

  // Show error message
  useEffect(() => {
    if (skillsError) {
      message.error(skillsError);
      clearSkillsError();
    }
  }, [skillsError, clearSkillsError]);

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
            <span
              style={{ fontSize: "12px", color: "#8c8c8c", marginLeft: "auto" }}
            >
              {t("components.skillManager.lastUpdated", {
                value: formatLastRefresh(),
              })}
            </span>
          </div>
        }
      >
        <div style={{ marginBottom: "16px", color: "#8c8c8c" }}>
          {t("components.skillManager.readOnlyHint")}
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
                  <SkillCard skill={skill} />
                </List.Item>
              )}
            />
          )}
        </Spin>
      </Card>
    </div>
  );
};
