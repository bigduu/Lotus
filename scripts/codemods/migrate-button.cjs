/**
 * Codemod: migrate antd <Button> → shadcn <Button> (our enhanced variant).
 *
 * Run with:
 *   npx jscodeshift -t scripts/codemods/migrate-button.cjs --extensions=tsx,ts --parser=tsx src/
 *
 * Transformations:
 *   - Splits `Button` out of antd named imports → adds `import { Button } from "@/components/ui/button"`.
 *   - type="primary"   → variant="default"
 *   - type="default"   → variant="outline"
 *   - type="dashed"    → variant="outline"
 *   - type="text"      → variant="ghost"
 *   - type="link"      → variant="link"
 *   - danger           → variant="destructive" (overrides previous variant)
 *   - size="small"     → size="sm"
 *   - size="middle"    → size="default"
 *   - size="large"     → size="lg"
 *   - htmlType=...     → type=...
 *   - Leaves `loading`, `icon`, `block` alone — our shadcn Button now supports them natively.
 */
module.exports = function transformer(file, api) {
  const j = api.jscodeshift;
  const root = j(file.source);
  let touched = false;

  // 1. Split Button out of antd imports
  root
    .find(j.ImportDeclaration, { source: { value: "antd" } })
    .forEach((path) => {
      const specifiers = path.node.specifiers || [];
      const buttonSpec = specifiers.find(
        (s) => s.type === "ImportSpecifier" && s.imported.name === "Button",
      );
      if (!buttonSpec) return;
      // remove Button from antd import
      path.node.specifiers = specifiers.filter((s) => s !== buttonSpec);
      touched = true;
      // add new import after this one
      const newImport = j.importDeclaration(
        [j.importSpecifier(j.identifier("Button"))],
        j.literal("@/components/ui/button"),
      );
      j(path).insertAfter(newImport);
      // if antd import is now empty, remove it
      if (path.node.specifiers.length === 0) {
        j(path).remove();
      }
    });

  // 2. Walk JSX <Button ...>
  root
    .find(j.JSXOpeningElement, { name: { name: "Button" } })
    .forEach((path) => {
      const attrs = path.node.attributes || [];
      let dangerPresent = false;

      const newAttrs = [];
      for (const attr of attrs) {
        if (attr.type !== "JSXAttribute" || !attr.name || attr.name.type !== "JSXIdentifier") {
          newAttrs.push(attr);
          continue;
        }
        const name = attr.name.name;

        // danger
        if (name === "danger") {
          dangerPresent = true;
          touched = true;
          continue;
        }

        // type="..." → variant="..."
        if (
          name === "type" &&
          attr.value &&
          (attr.value.type === "Literal" || attr.value.type === "StringLiteral")
        ) {
          const v = attr.value.value;
          const map = {
            primary: "default",
            default: "outline",
            dashed: "outline",
            text: "ghost",
            link: "link",
          };
          if (Object.prototype.hasOwnProperty.call(map, v)) {
            attr.name.name = "variant";
            attr.value = j.literal(map[v]);
            touched = true;
          }
          newAttrs.push(attr);
          continue;
        }

        // size="small|middle|large"
        if (
          name === "size" &&
          attr.value &&
          (attr.value.type === "Literal" || attr.value.type === "StringLiteral")
        ) {
          const v = attr.value.value;
          const map = { small: "sm", middle: "default", large: "lg" };
          if (Object.prototype.hasOwnProperty.call(map, v)) {
            attr.value = j.literal(map[v]);
            touched = true;
          }
          newAttrs.push(attr);
          continue;
        }

        // htmlType → type
        if (name === "htmlType") {
          attr.name.name = "type";
          touched = true;
          newAttrs.push(attr);
          continue;
        }

        newAttrs.push(attr);
      }

      // Mutate path.node.attributes in place (recast-friendly)
      path.node.attributes.length = 0;
      newAttrs.forEach((a) => path.node.attributes.push(a));

      // Apply danger AFTER, overriding any variant
      if (dangerPresent) {
        for (let i = path.node.attributes.length - 1; i >= 0; i--) {
          const a = path.node.attributes[i];
          if (
            a.type === "JSXAttribute" &&
            a.name &&
            a.name.type === "JSXIdentifier" &&
            a.name.name === "variant"
          ) {
            path.node.attributes.splice(i, 1);
          }
        }
        path.node.attributes.push(
          j.jsxAttribute(j.jsxIdentifier("variant"), j.literal("destructive")),
        );
      }
    });

  return touched ? root.toSource({ quote: "double" }) : null;
};
