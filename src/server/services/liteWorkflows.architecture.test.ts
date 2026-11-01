import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { refreshModelsAndRebuildRoutes } from './routeRefreshWorkflow.js';

describe('Lite runtime boundaries', () => {
  it('keeps model discovery out of startup and balance scheduling', async () => {
    for (const file of ['src/server/index.ts', 'src/server/services/checkinScheduler.ts']) {
      expect(readFileSync(resolve(file), 'utf8')).not.toMatch(/routeRefreshWorkflow|refreshModelsAndRebuildRoutes|rebuildRoutesOnly/);
    }
    expect(readFileSync(resolve('src/server/services/routeRefreshWorkflow.ts'), 'utf8')).not.toContain('./modelService.js');
    expect((await refreshModelsAndRebuildRoutes()).rebuild).toMatchObject({ skipped: true, createdRoutes: 0 });
  });
});
