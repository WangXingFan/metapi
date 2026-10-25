import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('account token route architecture boundaries', () => {
  it('keeps legacy token repair from forcing route rebuilds inline', () => {
    const source = readSource('./accountTokens.ts');
    expect(source).not.toContain('rebuildRoutes: true');
  });

  it('delegates token updates to the mutation service', () => {
    const source = readSource('./accountTokens.ts');
    const updateHandler = source.slice(source.indexOf('app.put<'), source.indexOf("app.post<{ Params: { id: string } }>('/api/account-tokens/:id/default'"));
    expect(updateHandler).toContain('updateAccountToken(tokenId, parsedBody.data)');
    expect(updateHandler).not.toContain('db.update(');
    expect(updateHandler).not.toContain('adapter.updateApiToken');
    const service = readSource('../../services/accountTokenMutationService.ts');
    expect(service).not.toContain('routes/');
    expect(service).not.toContain('fastify');
  });
});
