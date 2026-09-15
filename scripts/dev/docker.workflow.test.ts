import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('docker workflows', () => {
  it('publishes armv7 docker images in the release workflow', () => {
    const ciWorkflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
    const releaseWorkflow = readFileSync(resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8');
    const dockerWorkflow = readFileSync(resolve(process.cwd(), '.github/workflows/docker-image.yml'), 'utf8');

    expect(ciWorkflow).not.toContain('publish-docker');

    expect(releaseWorkflow).toContain('uses: ./.github/workflows/docker-image.yml');
    expect(releaseWorkflow).toContain('secrets: inherit');
    expect(dockerWorkflow).toContain('arch: armv7');
    expect(dockerWorkflow).toContain('platform: linux/arm/v7');
    expect(dockerWorkflow).toContain('"${tag}-armv7"');
  });

  it('publishes to GHCR and treats Docker Hub as optional', () => {
    const releaseWorkflow = readFileSync(resolve(process.cwd(), '.github/workflows/docker-image.yml'), 'utf8');

    expect(releaseWorkflow).toContain('ghcr.io/${{ github.repository }}');
    expect(releaseWorkflow).toContain('Docker Hub secrets missing; publishing GHCR only.');
    expect(releaseWorkflow).toContain("if: env.DOCKERHUB_USERNAME != '' && env.DOCKERHUB_TOKEN != ''");
    expect(releaseWorkflow).not.toContain('1467078763/metapi');
    expect(releaseWorkflow).not.toContain('Missing Docker Hub secrets: DOCKERHUB_USERNAME / DOCKERHUB_TOKEN');
  });

  it('can publish a server image independently and traces the source revision', () => {
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/docker-image.yml'), 'utf8');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('workflow_call:');
    expect(workflow).not.toContain('needs: build-packages');
    expect(workflow).toContain('needs: publish-docker-arch');
    expect(workflow).toContain("github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v')");
    expect(workflow).toContain('type=sha,format=long');
    expect(workflow).toContain('type=raw,value=latest');
    expect(workflow).toContain('group: metapi-docker-publish');
    expect(workflow).toContain('packages: write');
  });

  it('uses an armv7-capable node base image in the Dockerfile', () => {
    const dockerfile = readFileSync(resolve(process.cwd(), 'docker/Dockerfile'), 'utf8');

    expect(dockerfile).toContain('FROM node:22-bookworm-slim AS builder');
    expect(dockerfile).toContain('FROM node:22-bookworm-slim');
  });

  it('avoids buildkit-only frontend syntax so managed docker builders can parse it reliably', () => {
    const dockerfile = readFileSync(resolve(process.cwd(), 'docker/Dockerfile'), 'utf8');

    expect(dockerfile).not.toContain('# syntax=docker/dockerfile:');
    expect(dockerfile).not.toContain('RUN --mount=type=cache');
  });

  it('keeps server docker builds isolated from desktop packaging dependencies', () => {
    const dockerfile = readFileSync(resolve(process.cwd(), 'docker/Dockerfile'), 'utf8');

    expect(dockerfile).toContain('npm ci --ignore-scripts --no-audit --no-fund');
    expect(dockerfile).toContain('npm rebuild esbuild sharp better-sqlite3 --no-audit --no-fund');
    expect(dockerfile).not.toContain('npm ci --no-audit --no-fund');
    expect(dockerfile).toContain('RUN npm run build:web && npm run build:server');
    expect(dockerfile).toContain('npm prune --omit=dev --no-audit --no-fund');
  });
});
