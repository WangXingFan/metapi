import { describe, expect, it } from 'vitest';
import { translateText } from './i18n.js';

describe('translateText', () => {
  it('keeps zh text unchanged in zh mode', () => {
    expect(translateText('账号 Key', 'zh')).toBe('账号 Key');
  });

  it('translates exact key in en mode', () => {
    expect(translateText('账号 Key', 'en')).toBe('Account Keys');
  });

  it('supports phrase replacement for mixed text', () => {
    expect(translateText('添加站点 3', 'en')).toBe('Add Site 3');
    expect(translateText('执行签到 12', 'en')).toBe('Run Check-in 12');
  });

  it('never returns Chinese characters in strict en mode', () => {
    const samples = [
      '站点保存失败',
      '导入失败：unknown error',
      '签到任务执行中，请稍后查看签到日志',
    ];

    for (const sample of samples) {
      expect(translateText(sample, 'en')).not.toMatch(/[\u3400-\u9fff]/);
    }
  });

  it('uses concrete english translations instead of fallback for common runtime text', () => {
    expect(translateText('切换到中文', 'en')).toBe('Switch to Chinese');
    expect(translateText('中', 'en')).toBe('ZH');

    const samples = [
      '站点保存失败',
      '签到任务执行中，请稍后查看签到日志',
      '账号 Key 已复制',
    ];

    for (const sample of samples) {
      const translated = translateText(sample, 'en');
      expect(translated).not.toBe('Untranslated');
      expect(translated).not.toMatch(/[\u3400-\u9fff]/);
    }
  });
});
