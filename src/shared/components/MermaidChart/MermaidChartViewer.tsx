import type { GlobalToken } from "antd/es/theme/interface";
import React, { useCallback, useMemo, useState } from "react";
import { DownloadOutlined } from "@ant-design/icons";
import { App as AntApp, Button, Tooltip } from "antd";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { useTranslation } from "react-i18next";
import { FileOperationsService } from "@shared/services/FileOperationsService";
import { sanitizeSvgMarkup } from "./sanitizeSvg";

interface MermaidChartViewerProps {
  svg: string;
  height: number;
  isLoading: boolean;
  initialScale: number;
  chartKey?: string;
  className?: string;
  style?: React.CSSProperties;
  token: GlobalToken;
  containerRef: React.RefObject<HTMLDivElement>;
}

const normalizeSvgMarkup = (svgMarkup: string): string => {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(svgMarkup, "image/svg+xml");
  const svgElement = xmlDoc.querySelector("svg");
  if (!svgElement) {
    return svgMarkup;
  }

  if (!svgElement.getAttribute("xmlns")) {
    svgElement.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  if (!svgElement.getAttribute("xmlns:xlink")) {
    svgElement.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  }

  const serialized = new XMLSerializer().serializeToString(svgElement);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`;
};

const MermaidChartViewer: React.FC<MermaidChartViewerProps> = ({
  svg,
  height,
  isLoading,
  initialScale,
  chartKey,
  className,
  style,
  token,
  containerRef,
}) => {
  const { t } = useTranslation();
  const { message: appMessage } = AntApp.useApp();
  const [isExporting, setIsExporting] = useState(false);

  const sanitizedSvg = useMemo(() => {
    if (!svg) return "";
    return sanitizeSvgMarkup(svg).replace(
      /<svg([^>]*)>/,
      '<svg$1 style="display: block; max-width: 100%; max-height: 100%;">',
    );
  }, [svg]);

  const handleExportSvg = useCallback(async () => {
    if (!svg || isExporting) {
      return;
    }

    setIsExporting(true);
    try {
      const normalizedSvg = normalizeSvgMarkup(svg);
      const bytes = new TextEncoder().encode(normalizedSvg);
      const prefix = chartKey ? `mermaid-${chartKey.slice(0, 8)}` : "mermaid-graph";
      const defaultPath = FileOperationsService.generateTimestampedFilename(prefix, "svg");

      const result = await FileOperationsService.saveBinaryFile(
        bytes,
        FileOperationsService.FILTERS.SVG,
        defaultPath,
      );

      if (result.success) {
        appMessage.success(t("chat.messageActions.savedFile", { filename: result.filename }));
        return;
      }

      if (result.error?.toLowerCase().includes("cancel")) {
        return;
      }

      appMessage.error(result.error || t("chat.messageActions.exportFailed"));
    } catch (error) {
      const exportError =
        error instanceof Error ? error.message : t("components.mermaid.exportFailed");
      appMessage.error(exportError);
    } finally {
      setIsExporting(false);
    }
  }, [appMessage, chartKey, isExporting, svg, t]);

  const exportDisabled = isLoading || !svg || isExporting;

  return (
    <div
      ref={containerRef}
      data-mermaid-loading={isLoading ? "true" : "false"}
      className={className}
      style={{
        textAlign: "center",
        margin: `${token.marginXS}px 0`,
        padding: token.padding,
        background: token.colorBgContainer,
        borderRadius: token.borderRadiusSM,
        border: `1px solid ${token.colorBorder}`,
        overflow: "hidden",
        height: `${Math.min(height, 800)}px`,
        minHeight: "300px",
        maxHeight: "80vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        willChange: "auto",
        contain: "layout style paint",
        ...style,
      }}
    >
      {isLoading && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            color: token.colorTextSecondary,
            fontSize: token.fontSizeSM,
            zIndex: 2,
          }}
        >
          {t("components.mermaid.renderingDiagram")}
        </div>
      )}
      <div
        style={{
          width: "100%",
          height: "100%",
          opacity: isLoading ? 0 : 1,
          position: "relative",
        }}
      >
        <TransformWrapper
          initialScale={initialScale}
          minScale={0.1}
          maxScale={10}
          centerOnInit={true}
          limitToBounds={false}
          wheel={{ step: 0.1 }}
          panning={{ disabled: false }}
          pinch={{ disabled: false }}
          doubleClick={{ disabled: false, mode: "zoomIn", step: 0.5 }}
        >
          {({ zoomIn, zoomOut, resetTransform }) => (
            <>
              <div
                data-mermaid-controls="true"
                style={{
                  position: "absolute",
                  top: 8,
                  right: 8,
                  zIndex: 10,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  background: token.colorBgContainer,
                  borderRadius: token.borderRadiusSM,
                  border: `1px solid ${token.colorBorder}`,
                  padding: 4,
                  boxShadow: token.boxShadowSecondary,
                }}
              >
                <Button
                  size="small"
                  type="text"
                  onClick={() => zoomIn()}
                  style={{ fontSize: 12, padding: "2px 6px" }}
                >
                  +
                </Button>
                <Button
                  size="small"
                  type="text"
                  onClick={() => zoomOut()}
                  style={{ fontSize: 12, padding: "2px 6px" }}
                >
                  -
                </Button>
                <Button
                  size="small"
                  type="text"
                  onClick={() => resetTransform()}
                  style={{ fontSize: 10, padding: "2px 6px" }}
                >
                  ⌂
                </Button>
                <Tooltip title={t("components.mermaid.exportSvg")}>
                  <Button
                    size="small"
                    type="text"
                    icon={<DownloadOutlined />}
                    aria-label={t("components.mermaid.downloadChartAriaLabel")}
                    disabled={exportDisabled}
                    loading={isExporting}
                    onClick={() => {
                      void handleExportSvg();
                    }}
                    style={{ fontSize: 11, padding: "2px 6px" }}
                  />
                </Tooltip>
              </div>

              <TransformComponent
                wrapperStyle={{
                  width: "100%",
                  height: "100%",
                }}
                contentStyle={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "100%",
                  height: "100%",
                }}
              >
                <div
                  style={{
                    display: "inline-block",
                    lineHeight: 0,
                  }}
                  dangerouslySetInnerHTML={{
                    __html: sanitizedSvg,
                  }}
                />
              </TransformComponent>
            </>
          )}
        </TransformWrapper>
      </div>
    </div>
  );
};

export default MermaidChartViewer;
