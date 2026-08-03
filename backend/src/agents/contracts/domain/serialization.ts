import type { z } from "zod";
import type { JsonValue } from "./common.js";

const UNSAFE_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function assertJsonValue(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): asserts value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} contains a non-finite number`);
    }
    return;
  }

  if (typeof value !== "object") {
    throw new TypeError(`${path} contains a non-JSON value of type ${typeof value}`);
  }

  if (ancestors.has(value)) {
    throw new TypeError(`${path} contains a circular reference`);
  }

  ancestors.add(value);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new TypeError(`${path}[${index}] is an array hole`);
      }
      assertJsonValue(value[index], `${path}[${index}]`, ancestors);
    }
    ancestors.delete(value);
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be a plain JSON object`);
  }

  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${path} contains symbol keys`);
  }

  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (UNSAFE_JSON_KEYS.has(key)) {
      throw new TypeError(`${path}.${key} uses an unsafe JSON key`);
    }
    if (descriptor.get || descriptor.set) {
      throw new TypeError(`${path}.${key} uses an accessor property`);
    }
    if (descriptor.enumerable) {
      assertJsonValue(descriptor.value, `${path}.${key}`, ancestors);
    }
  }

  ancestors.delete(value);
}

export function assertJsonSerializable(value: unknown): asserts value is JsonValue {
  assertJsonValue(value, "$", new Set());
}

export function serializeContract<T>(
  schema: z.ZodType<T>,
  value: unknown,
): string {
  // Guard before parsing so accessors, cycles, and custom prototypes cannot be
  // traversed or normalized by a schema before they are rejected.
  assertJsonSerializable(value);
  const parsed = schema.parse(value);
  assertJsonSerializable(parsed);
  return JSON.stringify(parsed);
}

export function deserializeContract<T>(
  schema: z.ZodType<T>,
  serialized: string,
): T {
  let decoded: unknown;

  try {
    decoded = JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new TypeError("Contract payload is not valid JSON", { cause: error });
  }

  // JSON.parse can still produce unsafe own keys such as `__proto__`.
  assertJsonSerializable(decoded);
  const parsed = schema.parse(decoded);
  assertJsonSerializable(parsed);
  return parsed;
}

export function roundTripContract<T>(
  schema: z.ZodType<T>,
  value: unknown,
): T {
  return deserializeContract(schema, serializeContract(schema, value));
}
