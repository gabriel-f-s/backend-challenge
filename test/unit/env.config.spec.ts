import { describe, expect, it } from "bun:test";
import { ExecutionContext } from "@nestjs/common";
import { NoopAuthGuard } from "@shared/adapters/inbound/http/guards/noop-auth.guard";
import { NoopProviderIdentityAdapter } from "@shared/adapters/outbound/auth/noop-provider-identity.adapter";
import { loadEnvironmentConfig } from "@shared/adapters/outbound/config/env.config";

describe("Environment Configuration & Auth Extension Port", () => {
  it("loads default configuration values when environment variables are omitted", () => {
    const config = loadEnvironmentConfig({});

    expect(config.nodeEnv).toBe("development");
    expect(config.port).toBe(3000);
    expect(config.database.host).toBe("localhost");
    expect(config.database.port).toBe(5433);
    expect(config.sqs.wagerTransactionsQueueName).toBe("wager-transactions.fifo");
    expect(config.sqs.wagerTransactionsDlqName).toBe("wager-transactions-dlq.fifo");
    expect(config.sqs.wagerTransactionsQueueUrl).toBe(
      "http://localhost:4566/000000000000/wager-transactions.fifo",
    );
  });

  it("throws when an invalid port number is provided", () => {
    expect(() => loadEnvironmentConfig({ PORT: "invalid" })).toThrow(
      'Invalid port value for PORT: "invalid"',
    );
    expect(() => loadEnvironmentConfig({ DB_PORT: "70000" })).toThrow(
      'Invalid port value for DB_PORT: "70000"',
    );
  });

  it("attaches provider principal via NoopAuthGuard extension point", async () => {
    const adapter = new NoopProviderIdentityAdapter();
    const guard = new NoopAuthGuard(adapter);
    const request: { headers?: Record<string, string | undefined>; principal?: unknown } = {
      headers: { authorization: "Bearer test-token" },
    };

    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;

    const allowed = await guard.canActivate(context);

    expect(allowed).toBe(true);
    expect(request.principal).toEqual({
      subject: "anonymous-provider",
      scopes: ["wagering:write", "wagering:read", "wallet:write", "wallet:read"],
    });
  });
});

