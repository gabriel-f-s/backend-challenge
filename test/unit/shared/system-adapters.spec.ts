import { describe, expect, it } from "bun:test";
import { SystemClockAdapter } from "@shared/adapters/outbound/system/system-clock.adapter";
import { UuidV7GeneratorAdapter } from "@shared/adapters/outbound/system/uuid-v7-generator.adapter";

const UUID_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("System Adapters (Clock & UUIDv7 Generator)", () => {
  it("generates valid RFC 9562 UUIDv7 strings", () => {
    const generator = new UuidV7GeneratorAdapter();
    const id1 = generator.generate();
    const id2 = generator.generate();

    expect(id1).toMatch(UUID_V7_REGEX);
    expect(id2).toMatch(UUID_V7_REGEX);
    expect(id1).not.toBe(id2);
  });

  it("returns current Date instance from SystemClockAdapter", () => {
    const clock = new SystemClockAdapter();
    const before = Date.now();
    const now = clock.now();
    const after = Date.now();

    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(after);
  });
});

