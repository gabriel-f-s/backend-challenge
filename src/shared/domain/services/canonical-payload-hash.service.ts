import { createHash } from "node:crypto";

export class CanonicalPayloadHash {
  private constructor() {}

  static serializeCanonicalJson(value: unknown): string {
    return JSON.stringify(CanonicalPayloadHash.normalizeValue(value));
  }

  static compute(payload: unknown): string {
    const canonicalJson = CanonicalPayloadHash.serializeCanonicalJson(payload);
    return createHash("sha256").update(canonicalJson, "utf8").digest("hex");
  }

  private static normalizeValue(value: unknown): unknown {
    if (value === null || typeof value !== "object") {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => CanonicalPayloadHash.normalizeValue(item));
    }

    const record = value as Record<string, unknown>;
    const sortedKeys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort((a, b) => a.localeCompare(b));

    const normalizedObject: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      normalizedObject[key] = CanonicalPayloadHash.normalizeValue(record[key]);
    }
    return normalizedObject;
  }
}

