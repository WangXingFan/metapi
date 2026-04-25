import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { convergeAccountMutation } from './accountMutationWorkflow.js';

type AccountUpdateWorkflowInput = {
  accountId: number;
  updates: Partial<typeof schema.accounts.$inferInsert>;
  preferredApiToken?: string | null;
  refreshModels: boolean;
  preserveExpiredStatus?: boolean;
  allowInactiveModelRefresh?: boolean;
  reactivateAfterSuccessfulModelRefresh?: boolean;
  continueOnError?: boolean;
};

export async function applyAccountUpdateWorkflow(input: AccountUpdateWorkflowInput) {
  const persistedUpdates: Partial<typeof schema.accounts.$inferInsert> = {
    ...input.updates,
    ...(input.preserveExpiredStatus ? { status: 'expired' } : {}),
    updatedAt: new Date().toISOString(),
  };

  await db.update(schema.accounts)
    .set(persistedUpdates)
    .where(eq(schema.accounts.id, input.accountId))
    .run();

  const convergence = await convergeAccountMutation({
    accountId: input.accountId,
    preferredApiToken: input.preferredApiToken,
    defaultTokenSource: 'manual',
    refreshModels: false,
    rebuildRoutes: false,
    continueOnError: input.continueOnError,
  });

  const account = await db.select()
    .from(schema.accounts)
    .where(eq(schema.accounts.id, input.accountId))
    .get();

  return {
    account,
    convergence,
  };
}
