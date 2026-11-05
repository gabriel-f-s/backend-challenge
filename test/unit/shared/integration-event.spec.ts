import { describe, expect, it } from "bun:test";
import {
  IntegrationEvent,
  type IntegrationEventProps,
} from "@shared/domain/events/integration-event.base";

interface SampleEventData {
  readonly walletId: string;
  readonly amount: string;
}

class SampleIntegrationEvent extends IntegrationEvent<SampleEventData> {
  readonly eventType = "SampleIntegrationEvent";
  readonly version = 1;

  static create(props: IntegrationEventProps<SampleEventData>): SampleIntegrationEvent {
    return new SampleIntegrationEvent(props);
  }
}

describe("IntegrationEvent Base Class", () => {
  it("serializes event envelope to stable JSON with ISO-8601 occurredAt", () => {
    const occurredAt = new Date("2026-07-29T15:00:00.000Z");
    const event = SampleIntegrationEvent.create({
      eventId: "0192f298-345e-7e38-af88-e43f851a819d",
      aggregateId: "0192f291-27dd-7d3f-8071-5f8685deef37",
      correlationId: "corr-123",
      causationId: "cause-456",
      occurredAt,
      data: {
        walletId: "0192f291-27dd-7d3f-8071-5f8685deef37",
        amount: "25.00",
      },
    });

    expect(Object.isFrozen(event.data)).toBe(true);
    expect(event.toJSON()).toEqual({
      eventId: "0192f298-345e-7e38-af88-e43f851a819d",
      eventType: "SampleIntegrationEvent",
      aggregateId: "0192f291-27dd-7d3f-8071-5f8685deef37",
      correlationId: "corr-123",
      causationId: "cause-456",
      occurredAt: "2026-07-29T15:00:00.000Z",
      version: 1,
      data: {
        walletId: "0192f291-27dd-7d3f-8071-5f8685deef37",
        amount: "25.00",
      },
    });
  });
});

