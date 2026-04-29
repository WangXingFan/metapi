import React, { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ToastProvider } from "./components/Toast.js";
import { ConfirmProvider } from "./components/ConfirmDialog.js";
import TooltipLayer from "./components/TooltipLayer.js";
import { clearAuthSession, hasValidAuthSession, persistAuthSession } from "./authSession.js";
import { I18nProvider, useI18n } from "./i18n.js";
import { SITE_DOCS_URL, SITE_GITHUB_URL } from "./docsLink.js";
import ImportExport from "./pages/ImportExport.js";
import CheckinLog from "./pages/CheckinLog.js";
import LiteSites from "./pages/LiteSites.js";
import LiteAccounts from "./pages/LiteAccounts.js";
import LiteKeys from "./pages/LiteKeys.js";

function NavIconBase({ children }: { children: React.ReactNode }) {
  return (
    <svg
      className="sidebar-item-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function SitesIcon() {
  return (
    <NavIconBase>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" />
    </NavIconBase>
  );
}

function AccountsIcon() {
  return (
    <NavIconBase>
      <path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19" />
      <circle cx="10" cy="8" r="3.5" />
      <path d="M20 19v-1.2a3 3 0 0 0-2.4-2.94" />
      <path d="M16 5.2a3 3 0 0 1 0 5.6" />
    </NavIconBase>
  );
}

function KeysIcon() {
  return (
    <NavIconBase>
      <circle cx="8" cy="15" r="3.5" />
      <path d="M10.5 12.5L20 3" />
      <path d="M16 7l3 3" />
      <path d="M19 4l2 2" />
    </NavIconBase>
  );
}

function CheckinIcon() {
  return (
    <NavIconBase>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17" />
      <path d="M8 3v4M16 3v4" />
      <path d="M9 14.5l2 2 4-4" />
    </NavIconBase>
  );
}

function ImportExportIcon() {
  return (
    <NavIconBase>
      <path d="M8 3v10" />
      <path d="M4.5 9.5L8 13l3.5-3.5" />
      <path d="M16 21V11" />
      <path d="M19.5 14.5L16 11l-3.5 3.5" />
    </NavIconBase>
  );
}

export const sidebarGroups = [
  {
    label: "核心功能",
    items: [
      { to: "/sites", label: "站点", icon: <SitesIcon /> },
      { to: "/accounts", label: "账户", icon: <AccountsIcon /> },
      { to: "/keys", label: "账号 Key", icon: <KeysIcon /> },
      { to: "/checkin", label: "签到", icon: <CheckinIcon /> },
      { to: "/import-export", label: "导入导出", icon: <ImportExportIcon /> },
    ],
  },
];

const navItems = sidebarGroups[0].items.map(({ to, label, icon }) => ({ to, label, icon }));
const THEME_STORAGE_KEY = "metapi_theme";
type ThemeMode = "light" | "dark";

function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function ThemeToggle() {
  const { t } = useI18n();
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const isDark = theme === "dark";

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  return (
    <button
      type="button"
      className={`theme-toggle ${isDark ? "is-dark" : "is-light"}`}
      aria-label={isDark ? t("切换到浅色模式") : t("切换到深色模式")}
      aria-pressed={isDark}
      title={isDark ? t("切换到浅色模式") : t("切换到深色模式")}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      <span className="theme-toggle-track" aria-hidden="true">
        <span className="theme-toggle-thumb">{isDark ? t("暗") : t("亮")}</span>
      </span>
    </button>
  );
}

function LegacyPathRedirect({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={{ pathname: to, search: location.search }} replace />;
}

export function Login({
  onLogin,
  t,
}: {
  onLogin: (token: string) => void;
  t: (text: string) => string;
}) {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    if (!token.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/settings/auth/info", {
        headers: { Authorization: `Bearer ${token.trim()}` },
      });
      if (!res.ok) {
        throw new Error(t("管理员令牌无效"));
      }
      onLogin(token.trim());
    } catch (err: any) {
      setError(err?.message || t("无法连接到服务器"));
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 20,
        background:
          "radial-gradient(circle at top left, rgba(234,88,12,0.08), transparent 40%), radial-gradient(circle at bottom right, rgba(79,70,229,0.08), transparent 35%), var(--color-bg)",
      }}
    >
      <div
        className="card animate-scale-in"
        style={{
          width: "min(1000px, 100%)",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          overflow: "hidden",
        }}
      >
        <section
          style={{
            padding: 36,
            background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #ea580c 100%)",
            color: "#fff",
            display: "grid",
            gap: 20,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/logo.png" alt="Metapi" style={{ width: 48, height: 48, borderRadius: 12 }} />
            <div>
              <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.02em" }}>Metapi Lite</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>
                {t("仅保留站点、账户、Key、签到、导入导出")}
              </div>
            </div>
          </div>
          <div style={{ fontSize: 32, lineHeight: 1.2, fontWeight: 800, maxWidth: 420, letterSpacing: "-0.03em" }}>
            {t("面向运维闭环的极简工作台")}
          </div>
          <div style={{ fontSize: 15, lineHeight: 1.8, color: "rgba(255,255,255,0.85)" }}>
            {t("这一版移除了仪表盘、代理、路由、监控、OAuth、日志分析等扩展面板，只保留最短管理路径。")}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {["添加站点", "添加账户", "获取 Key", "执行签到", "导入导出"].map((item) => (
              <span
                key={item}
                style={{
                  padding: "8px 14px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.1)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  fontSize: 13,
                  fontWeight: 600,
                  backdropFilter: "blur(8px)",
                }}
              >
                {t(item)}
              </span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12 }}>
            <a href={SITE_DOCS_URL} target="_blank" rel="noreferrer" style={{ color: "#f8fafc" }}>
              {t("部署文档")}
            </a>
            <a href={SITE_GITHUB_URL} target="_blank" rel="noreferrer" style={{ color: "#f8fafc" }}>
              GitHub
            </a>
          </div>
        </section>

        <section style={{ padding: 36, display: "grid", gap: 20, alignContent: "center" }}>
          <div>
            <div style={{ fontSize: 14, color: "var(--color-text-muted)", marginBottom: 10, fontWeight: 600 }}>
              {t("管理员入口")}
            </div>
            <h2 style={{ margin: 0, fontSize: 32, lineHeight: 1.2, fontWeight: 800, letterSpacing: "-0.03em" }}>{t("登录")}</h2>
            <p style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.7, marginTop: 8 }}>
              {t("输入管理员令牌后进入精简版工作台。")}
            </p>
          </div>

          <label>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-secondary)", marginBottom: 8 }}>
              {t("管理员令牌")}
            </div>
            <input
              type="password"
              value={token}
              onChange={(event) => {
                setToken(event.target.value);
                setError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleLogin();
                }
              }}
              placeholder={t("请输入管理员令牌")}
              style={{
                width: "100%",
                padding: "14px 16px",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-sm)",
                fontSize: 15,
                background: "var(--color-bg)",
                color: "var(--color-text-primary)",
              }}
            />
          </label>

          {error ? <div className="alert alert-error">{error}</div> : null}

          <button
            type="button"
            className="btn btn-primary"
            disabled={loading || !token.trim()}
            onClick={() => void handleLogin()}
          >
            {loading ? t("验证中...") : t("登录")}
          </button>

          <div style={{ fontSize: 13, color: "var(--color-text-muted)", lineHeight: 1.7 }}>
            {t("登录只校验本地管理端权限，不会把管理员令牌发送到第三方站点。")}
          </div>
        </section>
      </div>
    </div>
  );
}

function AppShell() {
  const { t } = useI18n();
  const [authed, setAuthed] = useState(() => hasValidAuthSession(localStorage));

  useEffect(() => {
    if (!authed) return;
    const timer = setInterval(() => {
      if (hasValidAuthSession(localStorage)) return;
      clearAuthSession(localStorage);
      setAuthed(false);
    }, 60_000);
    return () => clearInterval(timer);
  }, [authed]);

  if (!authed) {
    return (
      <Login
        t={t}
        onLogin={(token) => {
          persistAuthSession(localStorage, token);
          setAuthed(true);
        }}
      />
    );
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-logo">
          <img src="/logo.png" alt="Metapi" style={{ width: 30, height: 30, borderRadius: 8 }} />
          <span className="topbar-logo-text">Metapi Lite</span>
        </div>
        <nav className="topbar-nav">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end className={({ isActive }) => `topbar-nav-item ${isActive ? "active" : ""}`}>
              <span className="topbar-nav-icon" aria-hidden="true">{item.icon}</span>
              <span className="topbar-nav-label">{t(item.label)}</span>
            </NavLink>
          ))}
        </nav>
        <div className="topbar-right">
          <ThemeToggle />
          <button
            type="button"
            className="btn btn-ghost"
            style={{ border: "1px solid var(--color-border)", minHeight: 36 }}
            onClick={() => {
              clearAuthSession(localStorage);
              setAuthed(false);
            }}
          >
            {t("退出")}
          </button>
        </div>
      </header>

      <main
        style={{
          maxWidth: 1360,
          margin: "0 auto",
          padding: "28px 24px 48px",
          display: "grid",
          gap: 20,
        }}
        className="main-content"
      >
        <Routes>
          <Route path="/" element={<Navigate to="/sites" replace />} />
          <Route path="/sites" element={<LiteSites />} />
          <Route path="/accounts" element={<LiteAccounts />} />
          <Route path="/keys" element={<LiteKeys />} />
          <Route path="/tokens" element={<LegacyPathRedirect to="/keys" />} />
          <Route path="/checkin" element={<CheckinLog />} />
          <Route path="/import-export" element={<ImportExport />} />
          <Route path="/settings/import-export" element={<LegacyPathRedirect to="/import-export" />} />
          <Route path="*" element={<Navigate to="/sites" replace />} />
        </Routes>
      </main>
    </>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <ToastProvider>
        <ConfirmProvider>
          <AppShell />
          <TooltipLayer />
        </ConfirmProvider>
      </ToastProvider>
    </I18nProvider>
  );
}
