import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Alert, App as AntApp, Card, Input, List, Spin, Empty, Row, Button } from "antd";
import { SearchOutlined, ReloadOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { skillService } from "../../services/skill/SkillService";
import type { SkillDefinition } from "@shared/types/skill";
import { useConfigSectionStore } from "../../shared/store/configSectionStore";
import { configErrorMessage } from "../../shared/utils/configErrors";
import { SkillCard } from "./SkillCard";

// Refresh interval in milliseconds (30 seconds)
const REFRESH_INTERVAL = 30000;

export const SkillManager = () => {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const toolsSkills = useConfigSectionStore((state) => state.sections["tools-skills"]);
  const loadSection = useConfigSectionStore((state) => state.loadSection);
  const saveSection = useConfigSectionStore((state) => state.saveSection);

  const [skills, setSkills] = useState<SkillDefinition[]>([]);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [configLoadError, setConfigLoadError] = useState<string | null>(null);
  const [savingSkillId, setSavingSkillId] = useState<string | null>(null);
  const refreshGenerationRef = useRef(0);

  // Local state
  const [searchQuery, setSearchQuery] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const disabledSkillIds = useMemo(
    () =>
      new Set(
        (toolsSkills.envelope?.data.skills?.disabled ?? [])
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    [toolsSkills.envelope],
  );
  const configError = configLoadError ?? toolsSkills.error;
  const hasKnownSkillState = Boolean(toolsSkills.envelope);
  const canMutateSkillConfig =
    toolsSkills.envelope?.status === "healthy" && !configError && !toolsSkills.loading;

  const loadSkillSettings = useCallback(
    async (refresh = true, refreshConfig = false) => {
      const generation = ++refreshGenerationRef.current;
      setIsLoadingSkills(true);
      setSkillsError(null);
      const skillsPromise = skillService.listSkills({ includeDisabled: true }, refresh);
      const configResultPromise = refreshConfig
        ? loadSection("tools-skills", { force: true }).then(
            (envelope) => ({ ok: true as const, envelope }),
            (error: unknown) => ({ ok: false as const, error }),
          )
        : null;
      let skillsLoaded = false;

      try {
        const skillResponse = await skillsPromise;
        if (generation === refreshGenerationRef.current) {
          setSkills(skillResponse.skills);
          setLastRefresh(new Date());
          skillsLoaded = true;
        }
      } catch (error) {
        if (generation === refreshGenerationRef.current) {
          setSkillsError(configErrorMessage(error, t("components.skillManager.loadFailed")));
        }
      } finally {
        if (generation === refreshGenerationRef.current) {
          setIsLoadingSkills(false);
        }
      }

      if (configResultPromise) {
        const configResult = await configResultPromise;
        if (generation === refreshGenerationRef.current) {
          if (!configResult.ok) {
            setConfigLoadError(
              configErrorMessage(
                configResult.error,
                t("components.skillManager.configurationUnavailable"),
              ),
            );
          } else if (configResult.envelope.status === "healthy") {
            setConfigLoadError(null);
          } else {
            setConfigLoadError(
              configResult.envelope.last_error ??
                t("components.skillManager.configurationUnavailable"),
            );
          }
        }
      }

      return generation === refreshGenerationRef.current && skillsLoaded;
    },
    [loadSection, t],
  );

  useEffect(
    () => () => {
      refreshGenerationRef.current += 1;
    },
    [],
  );

  // Load skills on mount and periodically (with refresh from disk)
  useEffect(() => {
    void loadSkillSettings(true, true);

    const intervalId = setInterval(() => {
      // Skill files can change independently, but config is event-driven and
      // must not be polled with the catalog refresh.
      void loadSkillSettings(true, false);
    }, REFRESH_INTERVAL);

    return () => clearInterval(intervalId);
  }, [loadSkillSettings]);

  // Refresh when window regains focus
  useEffect(() => {
    const handleFocus = () => {
      void loadSkillSettings(true, true);
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [loadSkillSettings]);

  // Manual refresh handler
  const handleRefresh = useCallback(async () => {
    const loaded = await loadSkillSettings(true, true);
    if (loaded) message.success(t("components.skillManager.skillsRefreshed"));
  }, [loadSkillSettings, message, t]);

  useEffect(() => {
    if (toolsSkills.envelope?.status === "healthy" && !toolsSkills.error) {
      setConfigLoadError(null);
    }
  }, [toolsSkills.envelope?.status, toolsSkills.error]);

  const handleToggleDisabled = useCallback(
    async (skillId: string, nextDisabled: boolean) => {
      if (!canMutateSkillConfig) {
        message.error(t("components.skillManager.configurationUnavailable"));
        return;
      }
      setSavingSkillId(skillId);
      try {
        const latest = await loadSection("tools-skills", { force: true });
        if (latest.status !== "healthy") {
          const latestError =
            latest.last_error ?? t("components.skillManager.configurationUnavailable");
          setConfigLoadError(latestError);
          throw new Error(latestError);
        }
        setConfigLoadError(null);
        const currentDisabled = latest.data.skills?.disabled ?? [];
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

        await saveSection(
          "tools-skills",
          {
            ...latest.data,
            skills: {
              ...(latest.data.skills ?? {}),
              disabled: nextDisabledList,
            },
          },
          latest.revision,
        );
        message.success(t("components.skillManager.skillStateSaved"));
      } catch (error) {
        message.error(configErrorMessage(error, t("components.skillManager.saveFailed")));
      } finally {
        setSavingSkillId(null);
      }
    },
    [canMutateSkillConfig, loadSection, message, saveSection, t],
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
        {configError && (
          <Alert
            type="warning"
            showIcon
            message={t("components.skillManager.configurationUnavailable")}
            description={configError}
            style={{ marginBottom: "16px" }}
          />
        )}
        {skillsError && (
          <Alert
            type="error"
            showIcon
            message={t("components.skillManager.loadFailed")}
            description={skillsError}
            style={{ marginBottom: "16px" }}
          />
        )}
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
                    mutationDisabled={!canMutateSkillConfig}
                    onToggleDisabled={hasKnownSkillState ? handleToggleDisabled : undefined}
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
