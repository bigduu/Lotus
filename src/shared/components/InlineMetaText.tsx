import React from "react";
import { Typography } from "antd";

const { Text } = Typography;

export type InlineMetaItem = React.ReactNode | null | undefined | false;

export interface InlineMetaTextProps {
  items: InlineMetaItem[];
  separator?: React.ReactNode;
  nowrap?: boolean;
  block?: boolean;
  style?: React.CSSProperties;
  className?: string;
  ellipsis?: boolean | { tooltip?: React.ReactNode };
  "data-testid"?: string;
}

const normalizeItems = (items: InlineMetaItem[]): React.ReactNode[] =>
  items.filter(
    (item): item is React.ReactNode =>
      item !== null &&
      item !== undefined &&
      item !== false &&
      !(typeof item === "string" && item.trim() === ""),
  );

const buildInlineMetaNodes = (
  items: React.ReactNode[],
  separator: React.ReactNode,
): React.ReactNode[] =>
  items.flatMap((item, index) =>
    index === 0
      ? [<React.Fragment key={`item-${index}`}>{item}</React.Fragment>]
      : [
          <React.Fragment key={`sep-${index}`}>{separator}</React.Fragment>,
          <React.Fragment key={`item-${index}`}>{item}</React.Fragment>,
        ],
  );

/**
 * Lightweight dot-separated meta text for dense compact UI sections.
 */
export const InlineMetaText: React.FC<InlineMetaTextProps> = ({
  items,
  separator = " · ",
  nowrap = false,
  block = false,
  style,
  className,
  ellipsis,
  ...rest
}) => {
  const normalizedItems = normalizeItems(items);
  if (normalizedItems.length === 0) return null;

  return (
    <Text
      type="secondary"
      className={className}
      ellipsis={ellipsis}
      style={{
        fontSize: 11,
        lineHeight: 1.35,
        whiteSpace: nowrap ? "nowrap" : undefined,
        display: block ? "block" : undefined,
        ...style,
      }}
      {...rest}
    >
      {buildInlineMetaNodes(normalizedItems, separator)}
    </Text>
  );
};

export default InlineMetaText;
