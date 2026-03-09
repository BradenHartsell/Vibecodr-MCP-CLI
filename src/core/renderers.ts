export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function summarizeToolSchema(inputSchema: Record<string, unknown> | undefined): {
  required: string[];
  optional: string[];
  skeleton: Record<string, unknown>;
} {
  const required = Array.isArray(inputSchema?.required)
    ? inputSchema.required.filter((value): value is string => typeof value === "string")
    : [];
  const properties = typeof inputSchema?.properties === "object" && inputSchema.properties
    ? inputSchema.properties as Record<string, Record<string, unknown>>
    : {};
  const skeleton = Object.fromEntries(
    Object.entries(properties).map(([name, schema]) => [name, schema.type === "number" || schema.type === "integer" ? 0 : schema.type === "boolean" ? false : ""])
  );
  const optional = Object.keys(properties).filter((name) => !required.includes(name));
  return { required, optional, skeleton };
}

export function renderToolResult(result: unknown): string {
  const typed = typeof result === "object" && result ? result as {
    content?: unknown[];
    structuredContent?: unknown;
    isError?: boolean;
  } : {};
  const lines: string[] = [];
  if (Array.isArray(typed.content)) {
    for (const item of typed.content) {
      if (item && typeof item === "object" && "type" in item && (item as { type?: string }).type === "text") {
        const text = (item as { text?: unknown }).text;
        if (typeof text === "string" && text.trim()) lines.push(text);
      }
    }
  }
  if (lines.length) return lines.join("\n\n");
  if (typed.structuredContent !== undefined) return formatJson(typed.structuredContent);
  return formatJson(result);
}
