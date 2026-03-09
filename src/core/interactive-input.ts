import { CliError, EXIT_CODES } from "../cli/errors.js";

type PromptFn = (message: string, options?: { allowEmpty?: boolean }) => Promise<string>;

function schemaType(schema: Record<string, unknown> | undefined): string | undefined {
  const type = schema?.type;
  return typeof type === "string" ? type : undefined;
}

function describe(path: string, schema: Record<string, unknown> | undefined, required: boolean): string {
  const type = schemaType(schema);
  const enumValues = Array.isArray(schema?.enum) ? ` [${schema.enum.map(String).join(", ")}]` : "";
  return `${path}${type ? ` (${type})` : ""}${required ? " [required]" : " [optional]"}${enumValues}`;
}

async function promptScalar(
  prompt: PromptFn,
  path: string,
  schema: Record<string, unknown> | undefined,
  required: boolean
): Promise<unknown> {
  const type = schemaType(schema);
  const raw = await prompt(`${describe(path, schema, required)}: `, { allowEmpty: !required });
  if (!raw) return undefined;
  if (Array.isArray(schema?.enum) && !schema.enum.map(String).includes(raw)) {
    throw new CliError("input.invalid_enum", `${path} must be one of: ${schema.enum.map(String).join(", ")}`, EXIT_CODES.usage);
  }
  if (type === "number" || type === "integer") {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      throw new CliError("input.invalid_number", `${path} must be a number.`, EXIT_CODES.usage);
    }
    return type === "integer" ? Math.trunc(parsed) : parsed;
  }
  if (type === "boolean") {
    const normalized = raw.toLowerCase();
    if (["true", "t", "yes", "y", "1"].includes(normalized)) return true;
    if (["false", "f", "no", "n", "0"].includes(normalized)) return false;
    throw new CliError("input.invalid_boolean", `${path} must be true or false.`, EXIT_CODES.usage);
  }
  return raw;
}

async function promptArray(
  prompt: PromptFn,
  path: string,
  schema: Record<string, unknown> | undefined,
  required: boolean
): Promise<unknown[] | undefined> {
  const items = schema?.items && typeof schema.items === "object" && !Array.isArray(schema.items)
    ? schema.items as Record<string, unknown>
    : undefined;
  const countRaw = await prompt(`${describe(path, schema, required)} count: `, { allowEmpty: !required });
  if (!countRaw) return undefined;
  const count = Number(countRaw);
  if (!Number.isInteger(count) || count < 0) {
    throw new CliError("input.invalid_array_count", `${path} count must be a non-negative integer.`, EXIT_CODES.usage);
  }
  const values: unknown[] = [];
  for (let index = 0; index < count; index += 1) {
    values.push(await promptBySchema(prompt, `${path}[${index}]`, items, true));
  }
  return values;
}

async function promptObject(
  prompt: PromptFn,
  path: string,
  schema: Record<string, unknown> | undefined,
  required: boolean
): Promise<Record<string, unknown> | undefined> {
  const properties = typeof schema?.properties === "object" && schema.properties
    ? schema.properties as Record<string, Record<string, unknown>>
    : {};
  const requiredFields = Array.isArray(schema?.required)
    ? schema.required.filter((value): value is string => typeof value === "string")
    : [];

  if (!required && !requiredFields.length && Object.keys(properties).length) {
    const include = await prompt(`Include ${path} object? [y/N]: `, { allowEmpty: true });
    if (!include || ["n", "no"].includes(include.toLowerCase())) return undefined;
  }

  const result: Record<string, unknown> = {};
  for (const [name, childSchema] of Object.entries(properties)) {
    const childRequired = requiredFields.includes(name);
    const value = await promptBySchema(prompt, `${path}.${name}`, childSchema, childRequired);
    if (value !== undefined) {
      result[name] = value;
    }
  }
  if (!required && Object.keys(result).length === 0) return undefined;
  return result;
}

export async function promptBySchema(
  prompt: PromptFn,
  path: string,
  schema: Record<string, unknown> | undefined,
  required: boolean
): Promise<unknown> {
  const type = schemaType(schema);
  if (type === "object" || (!type && schema?.properties)) {
    return await promptObject(prompt, path, schema, required);
  }
  if (type === "array") {
    return await promptArray(prompt, path, schema, required);
  }
  return await promptScalar(prompt, path, schema, required);
}

export async function promptObjectBySchema(
  prompt: PromptFn,
  toolName: string,
  schema: Record<string, unknown> | undefined
): Promise<Record<string, unknown>> {
  const properties = typeof schema?.properties === "object" && schema.properties
    ? schema.properties as Record<string, Record<string, unknown>>
    : {};
  const requiredFields = Array.isArray(schema?.required)
    ? schema.required.filter((value): value is string => typeof value === "string")
    : [];

  if (requiredFields.length) {
    // Stronger guidance before prompting starts.
    // Users should know exactly which values cannot be skipped.
    process.stderr.write(`Required fields for ${toolName}: ${requiredFields.join(", ")}\n`);
  }

  const result: Record<string, unknown> = {};
  for (const [name, childSchema] of Object.entries(properties)) {
    const value = await promptBySchema(prompt, name, childSchema, requiredFields.includes(name));
    if (value !== undefined) {
      result[name] = value;
    }
  }
  return result;
}
