import { describe, expect, it } from "vitest";

import { summarizeJsonSchema } from "../jsonSchema";

describe("summarizeJsonSchema", () => {
  it("summarizes object properties and required fields", () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      additionalProperties: false,
      properties: {
        includeStatic: {
          default: false,
          description: "Include static resources",
          type: "boolean",
        },
        filename: {
          description: "Filename to save to",
          type: "string",
        },
      },
      required: ["includeStatic"],
      type: "object",
    };

    const summary = summarizeJsonSchema(schema);
    expect(summary?.schemaUri).toContain("2020-12");
    expect(summary?.additionalProperties).toBe(false);
    expect(summary?.fields.map((f) => f.name)).toEqual([
      "includeStatic",
      "filename",
    ]);
    expect(summary?.fields[0]).toEqual(
      expect.objectContaining({
        name: "includeStatic",
        type: "boolean",
        required: true,
        defaultValue: false,
      }),
    );
  });

  it("summarizes array item type", () => {
    const schema = {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
        },
      },
      additionalProperties: false,
    };
    const summary = summarizeJsonSchema(schema);
    expect(summary?.fields[0]).toEqual(
      expect.objectContaining({
        name: "paths",
        type: "array<string>",
        required: false,
      }),
    );
  });

  it("summarizes oneOf types", () => {
    const schema = {
      type: "object",
      properties: {
        value: {
          oneOf: [{ type: "string" }, { type: "number" }],
        },
      },
    };
    const summary = summarizeJsonSchema(schema);
    expect(summary?.fields[0]).toEqual(
      expect.objectContaining({
        name: "value",
        type: "string | number",
        required: false,
      }),
    );
  });

  it("summarizes anyOf types", () => {
    const schema = {
      type: "object",
      properties: {
        data: {
          anyOf: [{ type: "boolean" }, { type: "null" }],
        },
      },
    };
    const summary = summarizeJsonSchema(schema);
    expect(summary?.fields[0]).toEqual(
      expect.objectContaining({
        name: "data",
        type: "boolean | null",
        required: false,
      }),
    );
  });

  it("summarizes allOf types", () => {
    const schema = {
      type: "object",
      properties: {
        merged: {
          allOf: [{ type: "object" }, { type: "object" }],
        },
      },
    };
    const summary = summarizeJsonSchema(schema);
    expect(summary?.fields[0]).toEqual(
      expect.objectContaining({
        name: "merged",
        type: "object & object",
        required: false,
      }),
    );
  });

  it("handles enum values", () => {
    const schema = {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["active", "inactive", "pending"],
          description: "Status of the item",
        },
      },
    };
    const summary = summarizeJsonSchema(schema);
    expect(summary?.fields[0]).toEqual(
      expect.objectContaining({
        name: "status",
        type: "string",
        required: false,
        description: "Status of the item",
        enumValues: ["active", "inactive", "pending"],
      }),
    );
  });

  it("handles array of types", () => {
    const schema = {
      type: "object",
      properties: {
        flexible: {
          type: ["string", "number", "boolean"],
        },
      },
    };
    const summary = summarizeJsonSchema(schema);
    expect(summary?.fields[0]).toEqual(
      expect.objectContaining({
        name: "flexible",
        type: "string | number | boolean",
        required: false,
      }),
    );
  });

  it("returns null for non-object schemas", () => {
    expect(summarizeJsonSchema(null)).toBeNull();
    expect(summarizeJsonSchema(undefined)).toBeNull();
    expect(summarizeJsonSchema("string")).toBeNull();
    expect(summarizeJsonSchema(123)).toBeNull();
    expect(summarizeJsonSchema([])).toBeNull();
  });

  it("handles empty properties", () => {
    const schema = {
      type: "object",
      properties: {},
    };
    const summary = summarizeJsonSchema(schema);
    expect(summary?.fields).toEqual([]);
  });

  it("handles schema without properties", () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "Empty Schema",
      description: "A schema with no properties",
    };
    const summary = summarizeJsonSchema(schema);
    expect(summary).toEqual({
      schemaUri: "https://json-schema.org/draft/2020-12/schema",
      title: "Empty Schema",
      description: "A schema with no properties",
      additionalProperties: undefined,
      fields: [],
    });
  });

  it("sorts fields with required first, then alphabetically", () => {
    const schema = {
      type: "object",
      properties: {
        zebra: { type: "string" },
        alpha: { type: "string" },
        beta: { type: "string" },
      },
      required: ["beta"],
    };
    const summary = summarizeJsonSchema(schema);
    expect(summary?.fields.map((f) => f.name)).toEqual([
      "beta",
      "alpha",
      "zebra",
    ]);
  });

  it("handles nested object type", () => {
    const schema = {
      type: "object",
      properties: {
        config: {
          type: "object",
          description: "Configuration object",
        },
      },
    };
    const summary = summarizeJsonSchema(schema);
    expect(summary?.fields[0]).toEqual(
      expect.objectContaining({
        name: "config",
        type: "object",
        required: false,
        description: "Configuration object",
      }),
    );
  });

  it("handles array without items type", () => {
    const schema = {
      type: "object",
      properties: {
        items: {
          type: "array",
        },
      },
    };
    const summary = summarizeJsonSchema(schema);
    expect(summary?.fields[0]).toEqual(
      expect.objectContaining({
        name: "items",
        type: "array<any>",
        required: false,
      }),
    );
  });

  it("handles non-record property nodes", () => {
    const schema = {
      type: "object",
      properties: {
        simple: "not an object",
      },
    };
    const summary = summarizeJsonSchema(schema);
    expect(summary?.fields[0]).toEqual(
      expect.objectContaining({
        name: "simple",
        type: "any",
        required: false,
        description: undefined,
        defaultValue: undefined,
        enumValues: undefined,
      }),
    );
  });

  it("extracts schema metadata", () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "Test Schema",
      description: "A test schema for validation",
      type: "object",
      properties: {
        name: { type: "string" },
      },
      additionalProperties: true,
    };
    const summary = summarizeJsonSchema(schema);
    expect(summary).toEqual(
      expect.objectContaining({
        schemaUri: "https://json-schema.org/draft/2020-12/schema",
        title: "Test Schema",
        description: "A test schema for validation",
        additionalProperties: true,
      }),
    );
  });

  it("handles empty oneOf/anyOf/allOf arrays", () => {
    const schema = {
      type: "object",
      properties: {
        emptyOneOf: { oneOf: [] },
        emptyAnyOf: { anyOf: [] },
        emptyAllOf: { allOf: [] },
      },
    };
    const summary = summarizeJsonSchema(schema);
    expect(summary?.fields[0].type).toBe("any");
    expect(summary?.fields[1].type).toBe("any");
    expect(summary?.fields[2].type).toBe("any");
  });

  it("handles array type in oneOf", () => {
    const schema = {
      type: "object",
      properties: {
        mixed: {
          oneOf: [{ type: "string" }, { type: "array", items: { type: "number" } }],
        },
      },
    };
    const summary = summarizeJsonSchema(schema);
    expect(summary?.fields[0]).toEqual(
      expect.objectContaining({
        name: "mixed",
        type: "string | array<number>",
        required: false,
      }),
    );
  });
});

