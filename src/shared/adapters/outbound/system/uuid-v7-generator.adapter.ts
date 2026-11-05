import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { IdGeneratorPort } from "@shared/application/ports/outbound/id-generator.port";

@Injectable()
export class UuidV7GeneratorAdapter implements IdGeneratorPort {
  generate(): string {
    const timestampMs = BigInt(Date.now());
    const bytes = randomBytes(16);

    bytes[0] = Number((timestampMs >> 40n) & 0xffn);
    bytes[1] = Number((timestampMs >> 32n) & 0xffn);
    bytes[2] = Number((timestampMs >> 24n) & 0xffn);
    bytes[3] = Number((timestampMs >> 16n) & 0xffn);
    bytes[4] = Number((timestampMs >> 8n) & 0xffn);
    bytes[5] = Number(timestampMs & 0xffn);

    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }
}

