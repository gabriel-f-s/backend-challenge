import { describe, expect, it } from "bun:test";
import { CanonicalPayloadHash } from "@shared/domain/services/canonical-payload-hash.service";

describe("CanonicalPayloadHash Service", () => {
  it("produces identical SHA-256 hashes for payloads with keys in different orders", () => {
    const payloadA = {
      providerId: "provider-a",
      externalTransactionId: "tx-123",
      money: { currency: "BRL", amount: "25.00" },
      kind: "BET",
      undefinedField: undefined,
    };

    const payloadB = {
      kind: "BET",
      money: { amount: "25.00", currency: "BRL" },
      externalTransactionId: "tx-123",
      providerId: "provider-a",
    };

    expect(CanonicalPayloadHash.serializeCanonicalJson(payloadA)).toBe(
      CanonicalPayloadHash.serializeCanonicalJson(payloadB),
    );
    expect(CanonicalPayloadHash.compute(payloadA)).toBe(CanonicalPayloadHash.compute(payloadB));
    expect(CanonicalPayloadHash.compute(payloadA)).toHaveLength(64);
  });

  it("produces different hashes when any business field changes", () => {
    const basePayload = {
      providerId: "provider-a",
      externalTransactionId: "tx-123",
      money: { amount: "25.00", currency: "BRL" },
      kind: "BET",
    };

    const modifiedAmountPayload = {
      ...basePayload,
      money: { amount: "25.01", currency: "BRL" },
    };

    expect(CanonicalPayloadHash.compute(basePayload)).not.toBe(
      CanonicalPayloadHash.compute(modifiedAmountPayload),
    );
  });
});

