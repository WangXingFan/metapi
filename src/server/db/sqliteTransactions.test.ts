import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('SQLite transaction ownership', () => {
  let module: typeof import('./index.js');
  let dataDir: string;
  const previousDataDir = process.env.DATA_DIR;
  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-transaction-isolation-'));
    process.env.DATA_DIR = dataDir;
    await import('./migrate.js');
    module = await import('./index.js');
  });
  afterAll(async () => {
    await module.closeDbConnections();
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('does not roll back an independent write while a transaction is suspended', async () => {
    const { db, schema } = module;
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const transaction = db.transaction(async (tx: any) => {
      await tx.insert(schema.settings).values({ key: 'rolled-back', value: '1' }).run();
      entered();
      await gate;
      throw new Error('intentional rollback');
    }).catch((error: Error) => error.message);
    await ready;
    let independentFinished = false;
    const independent = db.insert(schema.settings).values({ key: 'independent', value: '2' }).run()
      .then(() => { independentFinished = true; });
    await new Promise((resolve) => setImmediate(resolve));
    expect(independentFinished).toBe(false);
    release();
    expect(await transaction).toBe('intentional rollback');
    await independent;
    expect(await db.select().from(schema.settings).where(eq(schema.settings.key, 'independent')).get()).toBeDefined();
    expect(await db.select().from(schema.settings).where(eq(schema.settings.key, 'rolled-back')).get()).toBeUndefined();
  });

  it('serializes parallel transactions and preserves nested savepoints', async () => {
    const { db, schema } = module;
    await Promise.all([1, 2].map((id) => db.transaction(async (tx: any) => {
      await tx.insert(schema.settings).values({ key: `parallel-${id}`, value: '1' }).run();
      await tx.transaction(async (nested: any) => {
        await nested.insert(schema.settings).values({ key: `nested-${id}`, value: '1' }).run();
        throw new Error('savepoint rollback');
      }).catch(() => {});
    })));
    const rows = await db.select().from(schema.settings).all();
    expect(rows.filter((row: any) => row.key.startsWith('parallel-'))).toHaveLength(2);
    expect(rows.filter((row: any) => row.key.startsWith('nested-'))).toHaveLength(0);
  });
});
