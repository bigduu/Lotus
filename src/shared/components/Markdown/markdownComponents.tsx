import type { GlobalToken } from "antd/es/theme/interface";
import { Card, Typography } from "antd";
import type { Components } from "react-markdown";
import { renderCodeBlock, type MermaidRenderMode } from "./MarkdownCodeBlock";
import { openExternalLink } from "../../utils/openExternalLink";

const { Text } = Typography;

const BLOCK_MARGIN_PX = 8;
const INLINE_MARGIN_PX = 4;
const CELL_PADDING = "4px 8px";
const BLOCKQUOTE_BODY_PADDING = "4px 8px";

export const createMarkdownComponents = (
  _token?: Partial<GlobalToken>,
  options?: {
    onFixMermaid?: (chart: string, renderError?: string) => Promise<void> | void;
    mermaidRenderMode?: MermaidRenderMode;
  },
): Components => ({
  p: ({ children }) => (
    <Text
      style={{
        marginBottom: BLOCK_MARGIN_PX,
        display: "block",
      }}
    >
      {children}
    </Text>
  ),

  ol: ({ children }) => (
    <ol
      style={{
        marginBottom: BLOCK_MARGIN_PX,
        paddingLeft: 20,
      }}
    >
      {children}
    </ol>
  ),

  ul: ({ children }) => (
    <ul
      style={{
        marginBottom: BLOCK_MARGIN_PX,
        paddingLeft: 20,
      }}
    >
      {children}
    </ul>
  ),

  li: ({ children }) => (
    <li
      style={{
        marginBottom: INLINE_MARGIN_PX,
      }}
    >
      {children}
    </li>
  ),

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- react-markdown component signature
  code({ className, children, inline, ...props }: any) {
    const match = /language-([^\s]+)/i.exec(className || "");
    const language = match ? match[1] : "";
    const isInline = inline ?? (!match && !className);

    const codeString = children ? String(children).replace(/\n$/, "") : "";

    if (isInline) {
      return (
        <Text code className={className} {...props}>
          {children}
        </Text>
      );
    }

    if (!codeString.trim()) {
      return null;
    }

    return renderCodeBlock(
      language,
      codeString,
      undefined,
      options?.onFixMermaid,
      options?.mermaidRenderMode,
    );
  },

  blockquote: ({ children }) => (
    <Card
      size="small"
      styles={{ body: { padding: BLOCKQUOTE_BODY_PADDING } }}
      style={{
        borderLeft: "3px solid var(--ant-color-primary, #0d9488)",
        background: "var(--ant-color-primary-bg, rgba(13, 148, 136, 0.08))",
        margin: `${INLINE_MARGIN_PX}px 0`,
        color: "var(--ant-color-text-secondary, #64748b)",
        fontStyle: "italic",
      }}
    >
      {children}
    </Card>
  ),

  a: ({ children, href }) => {
    const link = typeof href === "string" ? href.trim() : "";
    if (!link) {
      return <>{children}</>;
    }

    return (
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => {
          event.preventDefault();
          // Avoid triggering card-level events when interacting with links.
          event.stopPropagation();
          void openExternalLink(link);
        }}
        style={{
          color: "var(--ant-color-link, #0d9488)",
          textDecoration: "underline",
          overflowWrap: "anywhere",
        }}
      >
        {children}
      </a>
    );
  },

  table: ({ children }) => (
    <Card
      size="small"
      styles={{ body: { padding: 0 } }}
      style={{ overflow: "auto", margin: `${BLOCK_MARGIN_PX}px 0` }}
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          border: "1px solid var(--ant-color-border, #d9d9d9)",
        }}
      >
        {children}
      </table>
    </Card>
  ),

  thead: ({ children }) => (
    <thead style={{ backgroundColor: "var(--ant-color-fill-tertiary, rgba(15, 23, 42, 0.04))" }}>
      {children}
    </thead>
  ),

  tbody: ({ children }) => <tbody>{children}</tbody>,

  tr: ({ children }) => (
    <tr style={{ borderBottom: "1px solid var(--ant-color-border, #d9d9d9)" }}>{children}</tr>
  ),

  th: ({ children }) => (
    <th
      style={{
        padding: CELL_PADDING,
        textAlign: "left",
        fontWeight: "bold",
        borderRight: "1px solid var(--ant-color-border, #d9d9d9)",
      }}
    >
      {children}
    </th>
  ),

  td: ({ children }) => (
    <td
      style={{
        padding: CELL_PADDING,
        borderRight: "1px solid var(--ant-color-border, #d9d9d9)",
      }}
    >
      {children}
    </td>
  ),

  input: ({ type, checked, disabled }) => {
    if (type === "checkbox") {
      return (
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          style={{
            marginRight: INLINE_MARGIN_PX,
            accentColor: "var(--ant-color-primary, #0d9488)",
          }}
          readOnly
        />
      );
    }
    return <input type={type} checked={checked} disabled={disabled} />;
  },
});

export default createMarkdownComponents;
