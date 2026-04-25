import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Language = 'zh' | 'en';

const LANGUAGE_STORAGE_KEY = 'app_language';
const HAS_HAN_RE = /[\u3400-\u9fff]/;
const HAN_BLOCK_RE = /[\u3400-\u9fff]+/g;
const LATIN_OR_DIGIT_RE = /[A-Za-z0-9]/;

const zhToEn: Record<string, string> = {
  '管理员令牌无效': 'Invalid admin token',
  '无法连接到服务器': 'Unable to connect to server',
  '管理员入口': 'Admin Access',
  '管理员令牌': 'Admin Token',
  '请输入管理员令牌': 'Enter admin token',
  '验证中...': 'Verifying...',
  '登录': 'Sign In',
  '退出': 'Sign Out',
  '部署文档': 'Deployment Docs',
  '仅保留站点、账户、Key、签到、导入导出': 'Sites, accounts, keys, check-ins, and import/export only',
  '面向运维闭环的极简工作台': 'A minimal operations workspace',
  '这一版移除了仪表盘、代理、路由、监控、OAuth、日志分析等扩展面板，只保留最短管理路径。': 'This Lite build keeps only the shortest management workflow.',
  '添加站点': 'Add Site',
  '添加账户': 'Add Account',
  '获取 Key': 'Get Key',
  '执行签到': 'Run Check-in',
  '导入导出': 'Import / Export',
  '输入管理员令牌后进入精简版工作台。': 'Enter the admin token to open the Lite console.',
  '登录只校验本地管理端权限，不会把管理员令牌发送到第三方站点。': 'Sign-in only checks local admin access and never sends the token to third-party sites.',
  '站点': 'Sites',
  '账户': 'Accounts',
  '账号 Key': 'Account Keys',
  '签到': 'Check-in',
  '取消': 'Cancel',
  '保存': 'Save',
  '关闭': 'Close',
  '复制': 'Copy',
  '同步': 'Sync',
  '删除': 'Delete',
  '编辑': 'Edit',
  '全部': 'All',
  '未设置': 'Not Set',
  '成功': 'Success',
  '失败': 'Failed',
  '跳过': 'Skipped',
  '未知': 'Unknown',
  '加载中...': 'Loading...',
  '保存中...': 'Saving...',
  '同步中...': 'Syncing...',
  '请求超时（': 'Request timed out (',
  '切换到中文': 'Switch to Chinese',
  '中': 'ZH',
};

const CJK_PUNCT_TO_ASCII: Record<string, string> = {
  '，': ', ',
  '。': '. ',
  '：': ': ',
  '；': '; ',
  '！': '! ',
  '？': '? ',
  '（': '(',
  '）': ')',
  '【': '[',
  '】': ']',
  '“': '"',
  '”': '"',
  '‘': '\'',
  '’': '\'',
  '、': ', ',
};

const zhToEnPhrases = Object.entries(zhToEn).sort((a, b) => b[0].length - a[0].length);
let runtimeLanguage: Language = 'zh';

function enforceStrictEnglish(text: string): string {
  const normalizedPunctuation = text.replace(/[，。：；！？（）【】“”‘’、]/g, (ch) => CJK_PUNCT_TO_ASCII[ch] ?? ch);
  const strippedHan = normalizedPunctuation.replace(HAN_BLOCK_RE, ' ');
  const compacted = strippedHan.replace(/\s+/g, ' ').trim();
  if (!compacted) return 'Untranslated';
  if (!LATIN_OR_DIGIT_RE.test(compacted)) return 'Untranslated';
  return compacted;
}

function resolveStoredLanguage(): Language {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored === 'zh' || stored === 'en') return stored;
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function translateText(text: string, language: Language): string {
  if (language === 'zh') return text;
  if (!text) return text;
  if (!HAS_HAN_RE.test(text)) return zhToEn[text] ?? text;
  const exact = zhToEn[text];
  if (exact) return exact;

  let translated = text;
  for (const [source, target] of zhToEnPhrases) {
    if (!source || source === target) continue;
    if (!translated.includes(source)) continue;
    translated = translated.split(source).join(target);
  }
  if (HAS_HAN_RE.test(translated)) return enforceStrictEnglish(translated);
  return translated;
}

export function tr(text: string): string {
  return translateText(text, runtimeLanguage);
}

type I18nContextValue = {
  language: Language;
  setLanguage: (next: Language) => void;
  toggleLanguage: () => void;
  t: (text: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const resolved = resolveStoredLanguage();
    runtimeLanguage = resolved;
    return resolved;
  });

  useEffect(() => {
    runtimeLanguage = language;
    document.documentElement.setAttribute('lang', language === 'zh' ? 'zh-CN' : 'en');
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    runtimeLanguage = next;
    setLanguageState(next);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    document.documentElement.setAttribute('lang', next === 'zh' ? 'zh-CN' : 'en');
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguage(language === 'zh' ? 'en' : 'zh');
  }, [language, setLanguage]);

  const t = useCallback((text: string) => translateText(text, language), [language]);

  const value = useMemo<I18nContextValue>(() => ({
    language,
    setLanguage,
    toggleLanguage,
    t,
  }), [language, setLanguage, toggleLanguage, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return value;
}
