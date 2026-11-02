import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { solveNewApiAcwScV2 } from './newApiShield.js';

describe('upstream challenge parsing', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('solves the supported challenge fixture', () => {
    const html = readFileSync(new URL('./__fixtures__/anyrouter-challenge.html', import.meta.url), 'utf8');
    expect(solveNewApiAcwScV2(html)).toBe('699dbedad126579b6bc0ebb91eaae8d7af3548b5');
  });

  it('does not execute upstream code or expose the host environment', () => {
    vi.stubEnv('METAPI_SHIELD_SECURITY_PROBE', 'aa'.repeat(20));
    const html = `
      var arg1='${'00'.repeat(20)}';
      (function(a,c){return 0;}(a0i,0),!(function(){
        for(var m=[${Array.from({ length: 40 }, (_, index) => index + 1).join(',')}],p=L(0x115);false;){}
      }()));
      function a0i(){return [];}
      function a0j(){return decodeURIComponent.constructor('return process')().env.METAPI_SHIELD_SECURITY_PROBE;}
      function b(){}
    `;
    expect(solveNewApiAcwScV2(html)).toBeNull();
  });

  it('keeps both challenge paths on the parser without a JavaScript runtime', () => {
    for (const file of ['./newApi.ts', './newApiShield.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source).not.toMatch(/node:vm|runInContext|new Function|\beval\s*\(/);
      expect(source).toContain('solveNewApiAcwScV2(text)');
    }
  });
});
