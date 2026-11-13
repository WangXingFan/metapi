import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
  formatLocalDate,
  formatUtcSqlDateTime,
} from "../../services/localTimeService.js";

type DbModule = typeof import("../../db/index.js");

describe("accounts snapshot v2", () => {
  let app: FastifyInstance;
  let db: DbModule["db"];
  let schema: DbModule["schema"];
  let closeDbConnections: DbModule["closeDbConnections"];
  let dataDir = "";
  let previousDataDir: string | undefined;

  beforeAll(async () => {
    previousDataDir = process.env.DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), "metapi-accounts-snapshot-v2-"));
    process.env.DATA_DIR = dataDir;

    await import("../../db/migrate.js");
    const dbModule = await import("../../db/index.js");
    const routesModule = await import("./accounts.js");
    db = dbModule.db;
    schema = dbModule.schema;
    closeDbConnections = dbModule.closeDbConnections;

    app = Fastify();
    await app.register(routesModule.accountsRoutes);
  });

  beforeEach(async () => {
    await db.delete(schema.adminSnapshots).run();
    await db.delete(schema.proxyLogs).run();
    await db.delete(schema.checkinLogs).run();
    await db.delete(schema.routeChannels).run();
    await db.delete(schema.tokenRoutes).run();
    await db.delete(schema.tokenModelAvailability).run();
    await db.delete(schema.modelAvailability).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  afterAll(async () => {
    await app.close();
    await closeDbConnections();
    if (previousDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = previousDataDir;
    }
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("reads current credentials directly from the account instead of a cached snapshot", async () => {
    const site = await db.insert(schema.sites).values({ name: "credentials", url: "https://credentials.example", platform: "new-api" }).returning().get();
    const account = await db.insert(schema.accounts).values({ siteId: site.id, accessToken: "old-session" }).returning().get();
    await app.inject({ method: "GET", url: "/api/accounts" });
    await db.update(schema.accounts).set({ accessToken: "current-session", apiToken: "sk-current-key", extraConfig: JSON.stringify({ platformUserId: 7788 }) }).where(eq(schema.accounts.id, account.id)).run();
    const response = await app.inject({ method: "GET", url: `/api/accounts/${account.id}/credentials` });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({ id: account.id, accessToken: "current-session", apiToken: "sk-current-key", platformUserId: 7788 });
    expect((await app.inject({ method: "GET", url: "/api/accounts/0/credentials" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/accounts/999999/credentials" })).statusCode).toBe(404);
  });

  it("returns safe current lists after updates and deletes with production caching behavior", async () => {
    const previousVitest = process.env.VITEST;
    delete process.env.VITEST;
    try {
      const site = await db.insert(schema.sites).values({ name: "safe-list", url: "https://safe.example", platform: "new-api", customHeaders: '{"Authorization":"site-secret"}' }).returning().get();
      const account = await db.insert(schema.accounts).values({ siteId: site.id, accessToken: "session-secret", apiToken: "key-secret", extraConfig: '{"passwordCipher":"cipher-secret"}' }).returning().get();
      const first = await app.inject({ method: "GET", url: "/api/accounts" });
      expect(first.headers['cache-control']).toBe('no-store');
      for (const secret of ['session-secret', 'key-secret', 'cipher-secret', 'site-secret']) expect(first.body).not.toContain(secret);
      expect(first.json().accounts[0]).toMatchObject({ id: account.id, hasApiToken: true });
      expect(first.json().accounts[0]).not.toHaveProperty('extraConfig');
      const updated = await app.inject({ method: 'PUT', url: `/api/accounts/${account.id}`, payload: { status: 'disabled' } });
      expect(updated.statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/api/accounts' })).json().accounts[0].status).toBe('disabled');
      expect((await db.select().from(schema.adminSnapshots).all())).toHaveLength(0);
      expect((await app.inject({ method: 'DELETE', url: `/api/accounts/${account.id}` })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/api/accounts' })).json().accounts).toEqual([]);
    } finally {
      if (previousVitest === undefined) delete process.env.VITEST;
      else process.env.VITEST = previousVitest;
    }
  });

  it("returns accounts and sites in one snapshot payload", async () => {
    const today = formatLocalDate(new Date());
    const site = await db
      .insert(schema.sites)
      .values({
        name: "snapshot-site",
        url: "https://snapshot-site.example.com",
        platform: "new-api",
      })
      .returning()
      .get();

    const account = await db
      .insert(schema.accounts)
      .values({
        siteId: site.id,
        username: "snapshot-user",
        accessToken: "snapshot-token",
        status: "active",
        balance: 18.5,
        extraConfig: JSON.stringify({
          todayIncomeSnapshot: {
            day: today,
            baseline: 3.2,
            latest: 3.2,
            updatedAt: `${today}T08:00:00.000Z`,
          },
          usage24hSnapshot: {
            spend: 0.75,
            startAt: new Date(Date.now() - 86_400_000).toISOString(),
            endAt: new Date().toISOString(),
            fetchedAt: new Date().toISOString(),
          },
        }),
      })
      .returning()
      .get();

    await db
      .insert(schema.proxyLogs)
      .values({
        accountId: account.id,
        status: "success",
        estimatedCost: 1.25,
        createdAt: formatUtcSqlDateTime(new Date()),
      })
      .run();

    await db
      .insert(schema.checkinLogs)
      .values({
        accountId: account.id,
        status: "success",
        reward: "",
        message: "checkin success",
        createdAt: `${today} 09:00:00`,
      })
      .run();

    const response = await app.inject({
      method: "GET",
      url: "/api/accounts",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-accounts-snapshot-cache"]).toBeTruthy();
    const body = response.json() as {
      generatedAt: string;
      accounts: Array<{
        id: number;
        site: { id: number; name: string };
        todaySpend: number;
        last24hSpend: number | null;
        canReadUsageLogs: boolean;
        todayReward: number;
      }>;
      sites: Array<{ id: number; name: string }>;
    };

    expect(Date.parse(body.generatedAt)).not.toBeNaN();
    expect(body.sites).toEqual([
      expect.objectContaining({ id: site.id, name: "snapshot-site" }),
    ]);
    expect(body.accounts).toEqual([
      expect.objectContaining({
        id: account.id,
        site: expect.objectContaining({ id: site.id, name: "snapshot-site" }),
        todaySpend: 1.25,
        last24hSpend: 0.75,
        canReadUsageLogs: true,
        todayReward: 3.2,
      }),
    ]);
  });

  it("returns sites and accounts in configured sort order", async () => {
    const laterSite = await db
      .insert(schema.sites)
      .values({
        name: "later-site",
        url: "https://later-site.example.com",
        platform: "new-api",
        sortOrder: 1,
      })
      .returning()
      .get();
    const earlierSite = await db
      .insert(schema.sites)
      .values({
        name: "earlier-site",
        url: "https://earlier-site.example.com",
        platform: "new-api",
        sortOrder: 0,
      })
      .returning()
      .get();

    const laterAccount = await db
      .insert(schema.accounts)
      .values({
        siteId: laterSite.id,
        username: "later-account",
        accessToken: "later-token",
        sortOrder: 1,
      })
      .returning()
      .get();
    const earlierAccount = await db
      .insert(schema.accounts)
      .values({
        siteId: earlierSite.id,
        username: "earlier-account",
        accessToken: "earlier-token",
        sortOrder: 0,
      })
      .returning()
      .get();

    const response = await app.inject({
      method: "GET",
      url: "/api/accounts",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      accounts: Array<{ id: number; username?: string | null }>;
      sites: Array<{ id: number; name: string }>;
    };

    expect(body.sites.map((site) => site.id)).toEqual([
      earlierSite.id,
      laterSite.id,
    ]);
    expect(body.accounts.map((account) => account.id)).toEqual([
      earlierAccount.id,
      laterAccount.id,
    ]);
  });
});
