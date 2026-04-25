import React, { useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import CenteredModal from "../components/CenteredModal.js";
import { MobileCard, MobileField } from "../components/MobileCard.js";
import { useIsMobile } from "../components/useIsMobile.js";
import { useToast } from "../components/Toast.js";
import { formatDateTimeLocal } from "./helpers/checkinLogTime.js";
import { fieldLabelStyle, inputStyle, monoTextStyle, parsePositiveInt } from "./lite/shared.js";

type SiteOption = {
  id: number;
  name: string;
  platform?: string | null;
};

type AccountItem = {
  id: number;
  username?: string | null;
  status?: string | null;
  credentialMode?: "session" | "apikey" | string;
  checkinEnabled?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  apiToken?: string | null;
  oauthProvider?: string | null;
  site?: {
    id: number;
    name: string;
    url?: string | null;
    status?: string | null;
  } | null;
  capabilities?: {
    canCheckin?: boolean;
    proxyOnly?: boolean;
  } | null;
};

type CreateMode = "login" | "credential";
type CredentialMode = "session" | "apikey";

const CHECKIN_SPREAD_INTERVAL_OPTIONS = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60].map((minute) => ({
  value: String(minute),
  label: `${minute} 分钟`,
}));

function normalizeCheckinSpreadIntervalMinutes(input: unknown): number {
  const minute = Number(input);
  if (!Number.isFinite(minute)) return 5;
  const normalized = Math.min(240, Math.max(1, Math.trunc(minute)));
  const option = CHECKIN_SPREAD_INTERVAL_OPTIONS.find((item) => Number(item.value) === normalized);
  return option ? normalized : 5;
}

const CHECKIN_START_TIME = "08:00";
const CHECKIN_START_CRON = "0 8 * * *";

type LoginForm = {
  siteId: number;
  username: string;
  password: string;
};

type CredentialForm = {
  siteId: number;
  displayName: string;
  accessToken: string;
  platformUserId: string;
  credentialMode: CredentialMode;
  skipModelFetch: boolean;
};

function createLoginForm(siteId = 0): LoginForm {
  return {
    siteId,
    username: "",
    password: "",
  };
}

function createCredentialForm(siteId = 0): CredentialForm {
  return {
    siteId,
    displayName: "",
    accessToken: "",
    platformUserId: "",
    credentialMode: "session",
    skipModelFetch: false,
  };
}

function createPreferredCredentialForm(
  siteId = 0,
  preferredMode: "session" | "apikey" | "",
): CredentialForm {
  const form = createCredentialForm(siteId);
  if (preferredMode === "apikey") {
    return {
      ...form,
      credentialMode: "apikey",
      skipModelFetch: true,
    };
  }
  return form;
}

function resolveAccountName(account: AccountItem): string {
  const username = String(account.username || "").trim();
  if (username) return username;
  return account.credentialMode === "apikey" ? "API Key 连接" : `账号 #${account.id}`;
}

function statusBadgeClass(status?: string | null): string {
  if (status === "disabled") return "badge-muted";
  if (status === "expired") return "badge-warning";
  return "badge-success";
}

function filterOutOauthAccounts(items: AccountItem[]): AccountItem[] {
  return items.filter((item) => !String(item.oauthProvider || "").trim());
}

function canAccountCheckin(account: AccountItem): boolean {
  return account.credentialMode !== "apikey" && account.capabilities?.canCheckin === true;
}

export default function LiteAccounts() {
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<CreateMode>("login");
  const [loginForm, setLoginForm] = useState<LoginForm>(() => createLoginForm());
  const [credentialForm, setCredentialForm] = useState<CredentialForm>(() => createCredentialForm());
  const [siteFilter, setSiteFilter] = useState<number>(0);
  const [search, setSearch] = useState("");
  const [checkinSettingsOpen, setCheckinSettingsOpen] = useState(false);
  const [checkinSettingsLoading, setCheckinSettingsLoading] = useState(false);
  const [checkinSettingsSaving, setCheckinSettingsSaving] = useState(false);
  const [checkinSpreadIntervalMinutes, setCheckinSpreadIntervalMinutes] = useState(5);

  const requestedSiteId = useMemo(
    () => parsePositiveInt(new URLSearchParams(location.search).get("siteId")),
    [location.search],
  );
  const requestedSegment = useMemo(() => {
    const segment = new URLSearchParams(location.search).get("segment");
    if (segment === "tokens" || segment === "apikey") {
      return segment;
    }
    return "";
  }, [location.search]);
  const shouldOpenCreate = useMemo(
    () => new URLSearchParams(location.search).get("create") === "1",
    [location.search],
  );
  const preferredCreateMode: CreateMode =
    requestedSegment === "apikey" ? "credential" : "login";

  const load = async () => {
    setLoading(true);
    try {
      const snapshot = await api.getAccountsSnapshot();
      const nextSites = Array.isArray(snapshot?.sites) ? snapshot.sites : [];
      const nextAccounts = filterOutOauthAccounts(
        Array.isArray(snapshot?.accounts) ? snapshot.accounts : [],
      );
      setSites(nextSites);
      setAccounts(nextAccounts);
    } catch (error: any) {
      toast.error(error?.message || "加载账户失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (requestedSiteId) {
      setSiteFilter(requestedSiteId);
      setLoginForm((current) => ({ ...current, siteId: requestedSiteId }));
      setCredentialForm((current) => ({
        ...current,
        siteId: requestedSiteId,
      }));
    }
    if (shouldOpenCreate) {
      setCreateMode(preferredCreateMode);
      if (preferredCreateMode === "credential") {
        setCredentialForm((current) => ({
          ...current,
          siteId: requestedSiteId || current.siteId,
          credentialMode: "apikey",
          skipModelFetch: true,
        }));
      }
      setCreateOpen(true);
    }
  }, [preferredCreateMode, requestedSiteId, shouldOpenCreate]);

  useEffect(() => {
    if (!shouldOpenCreate) return;
    const params = new URLSearchParams(location.search);
    params.delete("create");
    const nextSearch = params.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : "",
      },
      { replace: true },
    );
  }, [location.pathname, location.search, navigate, requestedSiteId, shouldOpenCreate]);

  const filteredAccounts = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return accounts.filter((account) => {
      if (siteFilter > 0 && account.site?.id !== siteFilter) return false;
      if (!normalizedSearch) return true;
      const haystack = [
        resolveAccountName(account),
        account.site?.name || "",
        account.site?.url || "",
        account.credentialMode || "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [accounts, search, siteFilter]);

  const summary = useMemo(() => {
    const session = filteredAccounts.filter((item) => item.credentialMode !== "apikey").length;
    const apiKey = filteredAccounts.filter((item) => item.credentialMode === "apikey").length;
    const checkinEnabled = filteredAccounts.filter((item) => canAccountCheckin(item) && item.checkinEnabled).length;
    return {
      total: filteredAccounts.length,
      session,
      apiKey,
      checkinEnabled,
    };
  }, [filteredAccounts]);

  const closeCreate = () => {
    setCreateOpen(false);
    setCreateMode(preferredCreateMode);
    setLoginForm(createLoginForm(requestedSiteId || siteFilter || 0));
    setCredentialForm(
      createPreferredCredentialForm(
        requestedSiteId || siteFilter || 0,
        requestedSegment === "apikey" ? "apikey" : "",
      ),
    );
  };

  const openCreate = () => {
    setCreateMode(preferredCreateMode);
    setLoginForm(createLoginForm(requestedSiteId || siteFilter || 0));
    setCredentialForm(
      createPreferredCredentialForm(
        requestedSiteId || siteFilter || 0,
        requestedSegment === "apikey" ? "apikey" : "",
      ),
    );
    setCreateOpen(true);
  };

  const openCheckinSettings = async () => {
    setCheckinSettingsOpen(true);
    setCheckinSettingsLoading(true);
    try {
      const runtimeInfo = await api.getRuntimeSettings();
      setCheckinSpreadIntervalMinutes(
        normalizeCheckinSpreadIntervalMinutes(runtimeInfo?.checkinSpreadIntervalMinutes),
      );
    } catch (error: any) {
      toast.error(error?.message || "加载签到设置失败");
    } finally {
      setCheckinSettingsLoading(false);
    }
  };

  const closeCheckinSettings = () => {
    setCheckinSettingsOpen(false);
    setCheckinSettingsLoading(false);
    setCheckinSettingsSaving(false);
  };

  const saveCheckinSettings = async () => {
    const intervalMinutes = normalizeCheckinSpreadIntervalMinutes(checkinSpreadIntervalMinutes);
    setCheckinSettingsSaving(true);
    try {
      await api.updateRuntimeSettings({
        checkinCron: CHECKIN_START_CRON,
        checkinScheduleMode: "spread",
        checkinSpreadIntervalMinutes: intervalMinutes,
      });
      setCheckinSpreadIntervalMinutes(intervalMinutes);
      toast.success(`已设置为每天 ${CHECKIN_START_TIME} 开始，每 ${intervalMinutes} 分钟签到 1 个账号`);
      closeCheckinSettings();
    } catch (error: any) {
      toast.error(error?.message || "保存签到设置失败");
    } finally {
      setCheckinSettingsSaving(false);
    }
  };

  const saveByLogin = async () => {
    if (!loginForm.siteId || !loginForm.username.trim() || !loginForm.password.trim()) {
      toast.error("站点、用户名、密码不能为空");
      return;
    }

    setSaving(true);
    try {
      const result = await api.loginAccount({
        siteId: loginForm.siteId,
        username: loginForm.username.trim(),
        password: loginForm.password,
      });
      if (result?.success === false) {
        throw new Error(result.message || "站点登录失败");
      }
      toast.success(result?.apiTokenFound ? "账户已添加，并已自动获取 key" : "账户已添加");
      closeCreate();
      await load();
      if (result?.id) {
        navigate(`/keys?accountId=${result.id}`);
      }
    } catch (error: any) {
      toast.error(error?.message || "添加账户失败");
    } finally {
      setSaving(false);
    }
  };

  const saveByCredential = async () => {
    if (!credentialForm.siteId || !credentialForm.accessToken.trim()) {
      toast.error("站点和凭据不能为空");
      return;
    }

    setSaving(true);
    try {
      const result = await api.addAccount({
        siteId: credentialForm.siteId,
        username: credentialForm.displayName.trim() || undefined,
        accessToken: credentialForm.accessToken.trim(),
        platformUserId: credentialForm.platformUserId.trim()
          ? Number.parseInt(credentialForm.platformUserId.trim(), 10)
          : undefined,
        credentialMode: credentialForm.credentialMode,
        skipModelFetch: true,
      });
      if (result?.success === false) {
        throw new Error(result.message || "添加凭据失败");
      }
      toast.success(credentialForm.credentialMode === "apikey" ? "API Key 连接已添加" : "凭据已添加");
      closeCreate();
      await load();
      if (result?.id) {
        navigate(`/keys?accountId=${result.id}`);
      }
    } catch (error: any) {
      toast.error(error?.message || "添加凭据失败");
    } finally {
      setSaving(false);
    }
  };

  const toggleCheckin = async (account: AccountItem) => {
    setActionId(`checkin-${account.id}`);
    try {
      await api.updateAccount(account.id, {
        checkinEnabled: !account.checkinEnabled,
      });
      toast.success(account.checkinEnabled ? "已关闭签到" : "已开启签到");
      await load();
    } catch (error: any) {
      toast.error(error?.message || "更新签到状态失败");
    } finally {
      setActionId("");
    }
  };

  const toggleStatus = async (account: AccountItem) => {
    setActionId(`status-${account.id}`);
    try {
      await api.updateAccount(account.id, {
        status: account.status === "disabled" ? "active" : "disabled",
      });
      toast.success(account.status === "disabled" ? "账户已启用" : "账户已停用");
      await load();
    } catch (error: any) {
      toast.error(error?.message || "更新账户状态失败");
    } finally {
      setActionId("");
    }
  };

  const runCheckin = async (account: AccountItem) => {
    setActionId(`run-${account.id}`);
    try {
      await api.triggerCheckin(account.id);
      toast.success("签到已执行");
    } catch (error: any) {
      toast.error(error?.message || "执行签到失败");
    } finally {
      setActionId("");
    }
  };

  const deleteAccount = async (account: AccountItem) => {
    const confirmed =
      typeof window === "undefined" || typeof window.confirm !== "function"
        ? true
        : window.confirm(`确定删除账户“${resolveAccountName(account)}”吗？`);
    if (!confirmed) return;

    setActionId(`delete-${account.id}`);
    try {
      await api.deleteAccount(account.id);
      toast.success("账户已删除");
      await load();
    } catch (error: any) {
      toast.error(error?.message || "删除账户失败");
    } finally {
      setActionId("");
    }
  };

  const summaryCards = [
    { label: "账户总数", value: summary.total },
    { label: "Session 账户", value: summary.session },
    { label: "API Key 连接", value: summary.apiKey },
    { label: "已开启签到", value: summary.checkinEnabled },
  ];

  if (requestedSegment === "tokens") {
    const params = new URLSearchParams(location.search);
    params.delete("segment");
    const nextSearch = params.toString();
    return (
      <Navigate
        to={{
          pathname: "/keys",
          search: nextSearch ? `?${nextSearch}` : "",
        }}
        replace
      />
    );
  }

  return (
    <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="page-header">
        <div>
          <h2 className="page-title">账户</h2>
          <div style={{ fontSize: 13, color: "var(--color-text-muted)", marginTop: 6 }}>
            只保留两个入口：站点登录添加账户，或直接导入 Session / API Key。
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-ghost" onClick={() => void openCheckinSettings()}>
            签到设置
          </button>
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            添加账户
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        {summaryCards.map((item) => (
          <div key={item.label} className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 8 }}>
              {item.label}
            </div>
            <div style={{ display: "flex", alignItems: "center" }}>
              <strong style={{ fontSize: 24, lineHeight: 1 }}>{item.value}</strong>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(180px, 240px) minmax(220px, 1fr)",
            gap: 12,
          }}
        >
          <label>
            <div style={fieldLabelStyle}>筛选站点</div>
            <select
              value={siteFilter}
              onChange={(event) => setSiteFilter(Number.parseInt(event.target.value, 10))}
              style={inputStyle}
            >
              <option value={0}>全部站点</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name} {site.platform ? `(${site.platform})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            <div style={fieldLabelStyle}>搜索</div>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="按账户名 / 站点 / 类型过滤"
              style={inputStyle}
            />
          </label>
        </div>

        {loading ? (
          <div style={{ display: "grid", gap: 10 }}>
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={`account-skeleton-${index}`} className="skeleton" style={{ height: 52 }} />
            ))}
          </div>
        ) : filteredAccounts.length <= 0 ? (
          <div className="empty-state" style={{ padding: 28 }}>
            <div className="empty-state-title">暂无账户</div>
            <div className="empty-state-desc">先添加站点，再为站点补充账户或 API Key。</div>
          </div>
        ) : isMobile ? (
          <div className="mobile-card-list">
            {filteredAccounts.map((account) => (
              <MobileCard
                key={account.id}
                title={resolveAccountName(account)}
                headerActions={(
                  <span className={`badge ${statusBadgeClass(account.status)}`} style={{ fontSize: 11 }}>
                    {account.status === "disabled" ? "停用" : account.status === "expired" ? "过期" : "正常"}
                  </span>
                )}
                footerActions={(
                  <>
                    <button type="button" className="btn btn-link" onClick={() => navigate(`/keys?accountId=${account.id}`)}>
                      查看 Key
                    </button>
                    {canAccountCheckin(account) ? (
                      <button
                        type="button"
                        className="btn btn-link"
                        onClick={() => void runCheckin(account)}
                        disabled={actionId === `run-${account.id}`}
                      >
                        签到
                      </button>
                    ) : null}
                    <button type="button" className="btn btn-link" onClick={() => void toggleStatus(account)}>
                      {account.status === "disabled" ? "启用" : "停用"}
                    </button>
                    <button type="button" className="btn btn-link btn-link-danger" onClick={() => void deleteAccount(account)}>
                      删除
                    </button>
                  </>
                )}
              >
                <MobileField label="站点" value={account.site?.name || "-"} />
                <MobileField
                  label="类型"
                  value={account.credentialMode === "apikey" ? "API Key 连接" : "Session 账户"}
                />
                <MobileField
                  label="签到"
                  value={
                    canAccountCheckin(account)
                      ? account.checkinEnabled
                        ? "已开启"
                        : "已关闭"
                      : "不支持"
                  }
                />
                <MobileField
                  label="站点地址"
                  stacked
                  value={<span style={monoTextStyle}>{account.site?.url || "-"}</span>}
                />
                <MobileField label="更新时间" value={formatDateTimeLocal(account.updatedAt || account.createdAt)} />
                {canAccountCheckin(account) ? (
                  <div style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      className={`btn ${account.checkinEnabled ? "btn-ghost" : "btn-primary"}`}
                      onClick={() => void toggleCheckin(account)}
                      disabled={actionId === `checkin-${account.id}`}
                    >
                      {actionId === `checkin-${account.id}`
                        ? "处理中..."
                        : account.checkinEnabled
                          ? "关闭签到"
                          : "开启签到"}
                    </button>
                  </div>
                ) : null}
              </MobileCard>
            ))}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>账户</th>
                  <th>站点</th>
                  <th>类型</th>
                  <th>状态</th>
                  <th>签到</th>
                  <th>更新时间</th>
                  <th style={{ textAlign: "right" }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredAccounts.map((account) => (
                  <tr key={account.id}>
                    <td style={{ fontWeight: 600 }}>{resolveAccountName(account)}</td>
                    <td>
                      <div style={{ display: "grid", gap: 4 }}>
                        <span>{account.site?.name || "-"}</span>
                        <span style={monoTextStyle}>{account.site?.url || "-"}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${account.credentialMode === "apikey" ? "badge-warning" : "badge-info"}`}>
                        {account.credentialMode === "apikey" ? "API Key 连接" : "Session 账户"}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${statusBadgeClass(account.status)}`}>
                        {account.status === "disabled" ? "停用" : account.status === "expired" ? "过期" : "正常"}
                      </span>
                    </td>
                    <td>
                      {canAccountCheckin(account) ? (
                        <button
                          type="button"
                          className={`btn ${account.checkinEnabled ? "btn-ghost" : "btn-primary"}`}
                          style={{ padding: "6px 10px", minHeight: "auto" }}
                          onClick={() => void toggleCheckin(account)}
                          disabled={actionId === `checkin-${account.id}`}
                        >
                          {actionId === `checkin-${account.id}`
                            ? "处理中..."
                            : account.checkinEnabled
                              ? "已开启"
                              : "已关闭"}
                        </button>
                      ) : (
                        <span style={{ color: "var(--color-text-muted)" }}>不支持</span>
                      )}
                    </td>
                    <td style={{ whiteSpace: "nowrap", color: "var(--color-text-muted)" }}>
                      {formatDateTimeLocal(account.updatedAt || account.createdAt)}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                        <button type="button" className="btn btn-link" onClick={() => navigate(`/keys?accountId=${account.id}`)}>
                          查看 Key
                        </button>
                        {canAccountCheckin(account) ? (
                          <button
                            type="button"
                            className="btn btn-link"
                            onClick={() => void runCheckin(account)}
                            disabled={actionId === `run-${account.id}`}
                          >
                            {actionId === `run-${account.id}` ? "执行中..." : "签到"}
                          </button>
                        ) : null}
                        <button type="button" className="btn btn-link" onClick={() => void toggleStatus(account)}>
                          {account.status === "disabled" ? "启用" : "停用"}
                        </button>
                        <button type="button" className="btn btn-link btn-link-danger" onClick={() => void deleteAccount(account)}>
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CenteredModal
        open={checkinSettingsOpen}
        onClose={closeCheckinSettings}
        title="签到设置"
        maxWidth={520}
        closeOnBackdrop
        closeOnEscape
        bodyStyle={{ display: "grid", gap: 14 }}
        footer={(
          <>
            <button type="button" className="btn btn-ghost" onClick={closeCheckinSettings}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void saveCheckinSettings()}
              disabled={checkinSettingsLoading || checkinSettingsSaving}
            >
              {checkinSettingsSaving ? "保存中..." : "保存设置"}
            </button>
          </>
        )}
      >
        {checkinSettingsLoading ? (
          <div style={{ display: "grid", gap: 10 }}>
            <div className="skeleton" style={{ height: 16, width: 120 }} />
            <div className="skeleton" style={{ height: 40 }} />
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <label>
              <div style={fieldLabelStyle}>每日开始时间</div>
              <input value={CHECKIN_START_TIME} readOnly style={inputStyle} />
            </label>
            <label>
              <div style={fieldLabelStyle}>单账号间隔</div>
              <select
                value={String(checkinSpreadIntervalMinutes)}
                onChange={(event) =>
                  setCheckinSpreadIntervalMinutes(
                    normalizeCheckinSpreadIntervalMinutes(event.target.value),
                  )
                }
                style={inputStyle}
              >
                {CHECKIN_SPREAD_INTERVAL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </CenteredModal>

      <CenteredModal
        open={createOpen}
        onClose={closeCreate}
        title="添加账户"
        maxWidth={760}
        closeOnBackdrop
        closeOnEscape
        bodyStyle={{ display: "grid", gap: 14 }}
        footer={(
          <>
            <button type="button" className="btn btn-ghost" onClick={closeCreate}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void (createMode === "login" ? saveByLogin() : saveByCredential())}
              disabled={saving}
            >
              {saving ? "保存中..." : "确认添加"}
            </button>
          </>
        )}
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            className={createMode === "login" ? "btn btn-primary" : "btn btn-ghost"}
            onClick={() => setCreateMode("login")}
          >
            站点登录
          </button>
          <button
            type="button"
            className={createMode === "credential" ? "btn btn-primary" : "btn btn-ghost"}
            onClick={() => setCreateMode("credential")}
          >
            直接导入凭据
          </button>
        </div>

        {createMode === "login" ? (
          <div style={{ display: "grid", gap: 14 }}>
            <label>
              <div style={fieldLabelStyle}>选择站点</div>
              <select
                value={loginForm.siteId}
                onChange={(event) =>
                  setLoginForm((current) => ({
                    ...current,
                    siteId: Number.parseInt(event.target.value, 10),
                  }))
                }
                style={inputStyle}
              >
                <option value={0}>请选择站点</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name} {site.platform ? `(${site.platform})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              <label>
                <div style={fieldLabelStyle}>用户名</div>
                <input
                  value={loginForm.username}
                  onChange={(event) =>
                    setLoginForm((current) => ({ ...current, username: event.target.value }))
                  }
                  placeholder="站点登录用户名"
                  style={inputStyle}
                />
              </label>
              <label>
                <div style={fieldLabelStyle}>密码</div>
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={(event) =>
                    setLoginForm((current) => ({ ...current, password: event.target.value }))
                  }
                  placeholder="站点登录密码"
                  style={inputStyle}
                />
              </label>
            </div>
            <div
              style={{
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-border)",
                background: "color-mix(in srgb, var(--color-success) 8%, var(--color-bg-card))",
                padding: 12,
                fontSize: 12,
                color: "var(--color-text-secondary)",
                lineHeight: 1.7,
              }}
            >
              登录成功后，系统会尽量自动补抓该账户的站点 key。添加完成后会自动跳到“账号 Key”页。
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            <label>
              <div style={fieldLabelStyle}>选择站点</div>
              <select
                value={credentialForm.siteId}
                onChange={(event) =>
                  setCredentialForm((current) => ({
                    ...current,
                    siteId: Number.parseInt(event.target.value, 10),
                  }))
                }
                style={inputStyle}
              >
                <option value={0}>请选择站点</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name} {site.platform ? `(${site.platform})` : ""}
                  </option>
                ))}
              </select>
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              <label>
                <div style={fieldLabelStyle}>凭据类型</div>
                <select
                  value={credentialForm.credentialMode}
                  onChange={(event) =>
                    setCredentialForm((current) => ({
                      ...current,
                      credentialMode: event.target.value as CredentialMode,
                      skipModelFetch: event.target.value === "apikey",
                    }))
                  }
                  style={inputStyle}
                >
                  <option value="session">Session / Cookie</option>
                  <option value="apikey">API Key</option>
                </select>
              </label>
              <label>
                <div style={fieldLabelStyle}>显示名称（可选）</div>
                <input
                  value={credentialForm.displayName}
                  onChange={(event) =>
                    setCredentialForm((current) => ({ ...current, displayName: event.target.value }))
                  }
                  placeholder="例如：主账号 / 备用 Key"
                  style={inputStyle}
                />
              </label>
            </div>

            <label>
              <div style={fieldLabelStyle}>凭据内容</div>
              <textarea
                value={credentialForm.accessToken}
                onChange={(event) =>
                  setCredentialForm((current) => ({ ...current, accessToken: event.target.value }))
                }
                placeholder={
                  credentialForm.credentialMode === "apikey"
                    ? "粘贴站点 API Key"
                    : "粘贴 Session / Cookie / Access Token"
                }
                style={{ ...inputStyle, minHeight: credentialForm.credentialMode === "apikey" ? 46 : 84, resize: "vertical", fontFamily: "var(--font-mono)" }}
              />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              <label>
                <div style={fieldLabelStyle}>平台用户 ID（可选）</div>
                <input
                  value={credentialForm.platformUserId}
                  onChange={(event) =>
                    setCredentialForm((current) => ({ ...current, platformUserId: event.target.value }))
                  }
                  placeholder="仅部分站点需要"
                  style={inputStyle}
                />
              </label>
              <div style={{ alignSelf: "end", fontSize: 12, color: "var(--color-text-muted)", lineHeight: 1.6 }}>
                保存前会验证站点和凭据是否匹配。
              </div>
            </div>
          </div>
        )}
      </CenteredModal>
    </div>
  );
}
