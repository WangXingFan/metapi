import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('harness workflows', () => {
  it('keeps repo drift checks wired into ci without scheduled report workflow', () => {
    const ciWorkflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');

    expect(ciWorkflow).toContain('name: Repo Drift Check');
    expect(ciWorkflow).toContain('npm run repo:drift-check');
    expect(ciWorkflow).toContain('name: Test Core');
    expect(ciWorkflow).toContain('name: Build Web');
    expect(ciWorkflow).toContain('name: Typecheck');
    expect(existsSync(resolve(process.cwd(), '.github/workflows/harness-drift-report.yml'))).toBe(false);
  });
});
