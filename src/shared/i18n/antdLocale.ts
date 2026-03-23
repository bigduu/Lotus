import type { Locale } from "antd/es/locale";
import enUS from "antd/locale/en_US";
import frFR from "antd/locale/fr_FR";
import hiIN from "antd/locale/hi_IN";
import jaJP from "antd/locale/ja_JP";
import zhCN from "antd/locale/zh_CN";
import zhTW from "antd/locale/zh_TW";
import type { AppLocale } from "./types";

export const getAntdLocale = (locale: AppLocale): Locale => {
  switch (locale) {
    case "zh-CN":
      return zhCN;
    case "zh-TW":
      return zhTW;
    case "fr-FR":
      return frFR;
    case "ja-JP":
      return jaJP;
    case "hi-IN":
      return hiIN;
    default:
      return enUS;
  }
};
