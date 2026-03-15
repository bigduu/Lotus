import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { resources as baseResources } from "./resources";
import {
  DEFAULT_APP_LOCALE,
  resolveInitialLocale,
  SUPPORTED_APP_LOCALES,
} from "./types";

const enTranslation = baseResources["en-US"].translation;
const zhCnTranslation = baseResources["zh-CN"].translation;

const frTranslation = {
  ...enTranslation,
  app: {
    ...enTranslation.app,
    loading: "Chargement...",
    retry: "Reessayer",
  },
  chat: {
    ...enTranslation.chat,
    sidebar: {
      ...enTranslation.chat.sidebar,
      newSession: "Nouvelle session",
    },
  },
  settings: {
    ...enTranslation.settings,
    page: {
      ...enTranslation.settings.page,
      back: "Retour",
      title: "Parametres Systeme",
      tabs: {
        ...enTranslation.settings.page.tabs,
        config: "Configuration",
        skills: "Competences",
        modelLimits: "Limites de Modele",
        metrics: "Metriques",
        schedules: "Planifications",
        app: "Application",
        provider: "Fournisseur",
      },
    },
    configTab: {
      ...enTranslation.settings.configTab,
      language: "Langue",
      languageEnglish: "Anglais",
      languageChinese: "Chinois simplifie",
      languageTraditionalChinese: "Chinois traditionnel",
      languageFrench: "Francais",
      languageJapanese: "Japonais",
    },
    appTab: {
      ...enTranslation.settings.appTab,
      language: "Langue",
      languageEnglish: "Anglais",
      languageChinese: "Chinois simplifie",
      languageTraditionalChinese: "Chinois traditionnel",
      languageFrench: "Francais",
      languageJapanese: "Japonais",
    },
  },
};

const jaTranslation = {
  ...enTranslation,
  app: {
    ...enTranslation.app,
    loading: "読み込み中...",
    retry: "再試行",
  },
  chat: {
    ...enTranslation.chat,
    sidebar: {
      ...enTranslation.chat.sidebar,
      newSession: "新しいセッション",
    },
  },
  settings: {
    ...enTranslation.settings,
    page: {
      ...enTranslation.settings.page,
      back: "戻る",
      title: "システム設定",
      tabs: {
        ...enTranslation.settings.page.tabs,
        config: "設定",
        prompts: "プロンプト",
        skills: "スキル",
        workflows: "ワークフロー",
        modelLimits: "モデル制限",
        metrics: "メトリクス",
        schedules: "スケジュール",
        sessions: "セッション",
        app: "アプリ",
        provider: "プロバイダー",
        masking: "マスキング",
      },
    },
    configTab: {
      ...enTranslation.settings.configTab,
      language: "言語",
      languageEnglish: "英語",
      languageChinese: "簡体字中国語",
      languageTraditionalChinese: "繁体字中国語",
      languageFrench: "フランス語",
      languageJapanese: "日本語",
    },
    appTab: {
      ...enTranslation.settings.appTab,
      language: "言語",
      languageEnglish: "英語",
      languageChinese: "簡体字中国語",
      languageTraditionalChinese: "繁体字中国語",
      languageFrench: "フランス語",
      languageJapanese: "日本語",
    },
  },
};

const zhTwTranslation = {
  ...zhCnTranslation,
  app: {
    ...zhCnTranslation.app,
    loading: "載入中...",
  },
  chat: {
    ...zhCnTranslation.chat,
    sidebar: {
      ...zhCnTranslation.chat.sidebar,
      newSession: "新建會話",
    },
  },
  settings: {
    ...zhCnTranslation.settings,
    page: {
      ...zhCnTranslation.settings.page,
      title: "系統設定",
      tabs: {
        ...zhCnTranslation.settings.page.tabs,
        config: "設定",
        modelLimits: "模型限制",
        metrics: "指標",
        sessions: "會話",
        app: "應用",
        provider: "供應商",
        masking: "脫敏",
      },
    },
    configTab: {
      ...zhCnTranslation.settings.configTab,
      loadConfigFailed: "載入配置失敗",
      invalidConfig: "配置無效",
      saveConfigSuccess: "配置保存成功",
      saveConfigFailed: "保存配置失敗",
      backendSaved: "後端地址已保存",
      backendResetDefault: "後端地址已重設為預設值",
      providerMovedTitle: "Provider 配置已遷移",
      providerMovedDescription:
        "GitHub Copilot 和其他 Provider 配置已遷移到 Provider Settings 分頁，請前往該頁面設定。",
      backendApiBaseUrlTitle: "後端 API 基礎位址",
      backendApiHint: "必須包含 /v1 路徑",
      resetToDefault: "恢復預設",
      save: "保存",
      language: "語言",
      languageEnglish: "English",
      languageChinese: "簡體中文",
      languageTraditionalChinese: "繁體中文",
      languageFrench: "Français",
      languageJapanese: "日本語",
    },
    appTab: {
      ...zhCnTranslation.settings.appTab,
      language: "語言",
      languageEnglish: "English",
      languageChinese: "簡體中文",
      languageTraditionalChinese: "繁體中文",
      languageFrench: "Français",
      languageJapanese: "日本語",
    },
  },
};

const resources = {
  ...baseResources,
  "fr-FR": {
    translation: frTranslation,
  },
  "ja-JP": {
    translation: jaTranslation,
  },
  "zh-TW": {
    translation: zhTwTranslation,
  },
};

if (!i18n.isInitialized) {
  i18n.use(initReactI18next);
  void i18n.init({
    resources,
    lng: resolveInitialLocale(),
    fallbackLng: DEFAULT_APP_LOCALE,
    supportedLngs: SUPPORTED_APP_LOCALES,
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
    returnNull: false,
  });
}

export default i18n;
