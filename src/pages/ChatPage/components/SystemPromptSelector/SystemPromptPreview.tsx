import type { GlobalToken } from "antd/es/theme/interface";
import React from "react";
import { Card, Typography } from "antd";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { LazySyntaxHighlighter } from "@shared/components/Markdown/LazySyntaxHighlighter";
import { registeredLanguages } from "@shared/components/Markdown/markdownSyntax";

const { Text, Paragraph } = Typography;

type SystemPromptPreviewProps = {
  content: string;
  token: GlobalToken;
  showGradient: boolean;
  onClick: (event: React.MouseEvent) => void;
};

export const SystemPromptPreview: React.FC<SystemPromptPreviewProps> = ({
  content,
  token,
  showGradient,
  onClick,
}) => {
  return (
    <Card
      size="small"
      style={{
        marginLeft: token.marginLG,
        marginTop: token.marginXS,
        backgroundColor: token.colorBgLayout,
        borderColor: token.colorBorderSecondary,
      }}
      styles={{ body: { padding: token.paddingMD } }}
      onClick={onClick}
    >
      <div
        style={{
          maxHeight: "60vh",
          overflowY: "auto",
          position: "relative",
          paddingRight: token.paddingXS,
        }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p: ({ children }) => (
              <Paragraph style={{ marginBottom: token.marginSM }}>{children}</Paragraph>
            ),
            ol: ({ children }) => (
              <ol
                style={{
                  marginBottom: token.marginSM,
                  paddingLeft: token.paddingLG,
                }}
              >
                {children}
              </ol>
            ),
            ul: ({ children }) => (
              <ul
                style={{
                  marginBottom: token.marginSM,
                  paddingLeft: token.paddingLG,
                }}
              >
                {children}
              </ul>
            ),
            li: ({ children }) => <li style={{ marginBottom: token.marginXS }}>{children}</li>,
            h1: ({ children }) => (
              <Text
                strong
                style={{
                  fontSize: token.fontSizeHeading3,
                  marginBottom: token.marginSM,
                  display: "block",
                }}
              >
                {children}
              </Text>
            ),
            h2: ({ children }) => (
              <Text
                strong
                style={{
                  fontSize: token.fontSizeHeading4,
                  marginBottom: token.marginSM,
                  display: "block",
                }}
              >
                {children}
              </Text>
            ),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- react-markdown component signature
            code: ({ inline, className, children, ...props }: any) => {
              const match = /language-(\w+)/.exec(className || "");
              if (!inline) {
                const requestedLanguage = (match?.[1] || "text").toLowerCase();
                // Only the 10 languages registered in markdownSyntaxHighlighter
                // (issue #7/#82) get real highlighting off the lazy chunk;
                // anything else falls back to plain text rather than pulling
                // in the full ~300-language Prism build for a rare tag.
                const language = registeredLanguages.includes(requestedLanguage)
                  ? requestedLanguage
                  : "text";
                return (
                  <LazySyntaxHighlighter
                    language={language}
                    codeString={String(children).replace(/\n$/, "")}
                  />
                );
              }

              return (
                <code
                  className={className}
                  style={{
                    backgroundColor: token.colorFillTertiary,
                    padding: "0 4px",
                    borderRadius: token.borderRadiusSM,
                    fontSize: token.fontSizeSM,
                  }}
                  {...props}
                >
                  {children}
                </code>
              );
            },
          }}
        >
          {content || "No content available."}
        </ReactMarkdown>

        {showGradient ? (
          <div
            style={{
              position: "sticky",
              bottom: 0,
              height: 48,
              background: `linear-gradient(180deg, transparent, ${token.colorBgLayout})`,
              pointerEvents: "none",
              marginTop: -48,
            }}
          />
        ) : null}
      </div>
    </Card>
  );
};
