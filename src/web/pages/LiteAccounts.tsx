import React, { useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import CenteredModal from "../components/CenteredModal.js";
import {
  ColumnVisibilityControl,
  type ColumnOption,
  useColumnVisibility,
} from "../components/ColumnVisibilityControl.js";
import { MobileCard, MobileField } from "../components/MobileCard.js";
import RefreshButton from "../components/RefreshButton.js";
import { useIsMobile } from "../components/useIsMobile.js";
import { useToast } from "../components/Toast.js";
import { useConfirm } from "../components/ConfirmDialog.js";
import RowActions from "../components/RowActions.js";
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
  balance?: number | null;
  todaySpend?: number | null;
  todayReward?: number | null;
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

type RebindForm = {
  accessToken: string;
  platformUserId: string;
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

function canRefreshAccountBalance(account: AccountItem): boolean {
  return account.capabilities?.canRefreshBalance === true;
}

function canRebindAccount(account: AccountItem): boolean {
  return account.status === "expired" && account.credentialMode !== "apikey";
}

function formatAccountBalance(value: unknown): string {
  const balance = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(balance)) return "-";
  return balance.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function resolvePositiveAmount(value: unknown): number | null {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

function formatSignedBalanceDelta(value: unknown): string | null {
  const amount = resolvePositiveAmount(value);
  if (amount === null) return null;
  return `+${formatAccountBalance(amount)}`;
}

function formatSpentBalanceDelta(value: unknown): string | null {
  const amount = resolvePositiveAmount(value);
  if (amount === null) return null;
  return `-${formatAccountBalance(amount)}`;
}

function BalanceDisplay({ account }: { account: AccountItem }) {
  const rewardText = formatSignedBalanceDelta(account.todayReward);
  const spendText = formatSpentBalanceDelta(account.todaySpend);
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <span style={monoTextStyle}>{formatAccountBalance(account.balance)}</span>
      {rewardText || spendText ? (
        <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
          {rewardText ? (
            <span
              style={{
                color: "var(--color-success)",
                fontSize: 12,
                fontWeight: 700,
                lineHeight: 1.2,
              }}
              title="今日签到增加的余额"
            >
              {rewardText}
            </span>
          ) : null}
          {spendText ? (
            <span
              style={{
                color: "var(--color-danger)",
                fontSize: 12,
                fontWeight: 700,
                lineHeight: 1.2,
              }}
              title="今日消耗的余额"
            >
              {spendText}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

type AccountColumnKey = "account" | "site" | "type" | "status" | "balance" | "checkin" | "updatedAt" | "actions";

const ACCOUNT_COLUMNS: ColumnOption<AccountColumnKey>[] = [
  { key: "account", label: "账户" },
  { key: "site", label: "站点" },
  { key: "type", label: "类型" },
  { key: "status", label: "状态" },
  { key: "balance", label: "余额" },
  { key: "checkin", label: "签到" },
  { key: "updatedAt", label: "更新时间" },
  { key: "actions", label: "操作" },
];

export default function LiteAccounts() {
  const toast = useToast();
  const confirm = useConfirm();
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
  const [rebindAccount, setRebindAccount] = useState<AccountItem | null>(null);
  const [rebindForm, setRebindForm] = useState<RebindForm>({
    accessToken: "",
    platformUserId: "",
  });
  const [rebinding, setRebinding] = useState(false);

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

  const activeSiteLabel = useMemo(() => {
    if (siteFilter <= 0) return "";
    const matchedSite = sites.find((site) => site.id === siteFilter);
    if (matchedSite) {
      return matchedSite.platform
        ? `${matchedSite.name} (${matchedSite.platform})`
        : matchedSite.name;
    }
    const matchedAccountSite = accounts.find((account) => account.site?.id === siteFilter)?.site;
    return matchedAccountSite?.name || `站点 #${siteFilter}`;
  }, [accounts, siteFilter, sites]);


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

  const openRebind = (account: AccountItem) => {
    setRebindAccount(account);
    setRebindForm({
      accessToken: "",
      platformUserId: "",
    });
  };

  const closeRebind = () => {
    setRebindAccount(null);
    setRebindForm({
      accessToken: "",
      platformUserId: "",
    });
    setRebinding(false);
  };

  const saveRebind = async () => {
    if (!rebindAccount) return;
    const accessToken = rebindForm.accessToken.trim();
    if (!accessToken) {
      toast.error("请粘贴新的 Session Token");
      return;
    }

    const platformUserIdRaw = rebindForm.platformUserId.trim();
    const platformUserId = platformUserIdRaw
      ? Number.parseInt(platformUserIdRaw, 10)
      : undefined;
    if (platformUserIdRaw && (!Number.isFinite(platformUserId) || !platformUserId || platformUserId <= 0)) {
      toast.error("平台用户 ID 必须是正整数");
      return;
    }

    setRebinding(true);
    try {
      const result = await api.rebindAccountSession(rebindAccount.id, {
        accessToken,
        platformUserId,
      });
      if (result?.success === false) {
        throw new Error(result.message || "重新绑定失败");
      }
      toast.success(result?.apiTokenFound ? "账户已重新绑定，并已获取 key" : "账户已重新绑定");
      closeRebind();
      await load();
    } catch (error: any) {
      toast.error(error?.message || "重新绑定失败");
    } finally {
      setRebinding(false);
    }
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
    const nextCheckinEnabled = !account.checkinEnabled;
    try {
      await api.updateAccount(account.id, {
        checkinEnabled: nextCheckinEnabled,
      });
      setAccounts((current) =>
        current.map((item) =>
          item.id === account.id ? { ...item, checkinEnabled: nextCheckinEnabled } : item,
        ),
      );
      toast.success(account.checkinEnabled ? "已关闭签到" : "已开启签到");
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

  const refreshAccountBalance = async (account: AccountItem) => {
    setActionId(`balance-${account.id}`);
    try {
      const result = await api.refreshBalance(account.id);
      setAccounts((current) =>
        current.map((item) =>
          item.id === account.id
            ? {
                ...item,
                balance: typeof result?.balance === "number" ? result.balance : item.balance,
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      );
      toast.success("余额已刷新");
    } catch (error: any) {
      toast.error(error?.message || "刷新余额失败");
    } finally {
      setActionId("");
    }
  };

  const deleteAccount = async (account: AccountItem) => {
    const confirmed = await confirm({
      title: "删除账户",
      message: `确定删除账户“${resolveAccountName(account)}”吗？该账户下的所有 Key 也会一并清除。`,
      confirmText: "删除",
      tone: "danger",
    });
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


  const { visibleColumns, isColumnVisible, toggleColumn, showAllColumns } = useColumnVisibility(
    "metapi.liteAccounts.columns",
    ACCOUNT_COLUMNS,
  );

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
    <div className="animate-fade-in stack-md">
      <div className="page-header">
        <div>
          <h2 className="page-title">账户</h2>
          <p className="page-subtitle">通过站点登录或导入 Session / API Key 添加账户</p>
        </div>
        <div className="page-header-actions">
          <RefreshButton onRefresh={load} refreshing={loading} />
          <button type="button" className="btn btn-ghost" onClick={() => void openCheckinSettings()}>
            签到设置
          </button>
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            添加账户
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 20, display: "grid", gap: 16 }}>
        {siteFilter > 0 ? (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              alignItems: "center",
              fontSize: 12,
              color: "var(--color-text-secondary)",
            }}
          >
            <span className="badge badge-info">当前站点</span>
            <span>{activeSiteLabel}</span>
            <span style={{ color: "var(--color-text-muted)" }}>
              {filteredAccounts.length} 个账号
            </span>
          </div>
        ) : null}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(180px, 240px) minmax(220px, 1fr) auto",
            gap: 14,
            alignItems: "end",
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
          {!isMobile && filteredAccounts.length > 0 ? (
            <ColumnVisibilityControl
              columns={ACCOUNT_COLUMNS}
              visibleColumns={visibleColumns}
              onToggleColumn={toggleColumn}
              onShowAll={showAllColumns}
            />
          ) : null}
        </div>

        {loading ? (
          <div style={{ display: "grid", gap: 10 }}>
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={`account-skeleton-${index}`} className="skeleton" style={{ height: 52 }} />
            ))}
          </div>
        ) : filteredAccounts.length <= 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19" />
                <circle cx="10" cy="8" r="3.5" />
                <path d="M20 19v-1.2a3 3 0 0 0-2.4-2.94" />
                <path d="M16 5.2a3 3 0 0 1 0 5.6" />
              </svg>
            </div>
            <div className="empty-state-title">还没有账户</div>
            <div className="empty-state-desc">从站点登录或直接导入 Session / API Key，把账户挂在站点下统一管理。</div>
            <div className="empty-state-actions">
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                添加账户
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => navigate('/sites')}>
                查看站点
              </button>
            </div>
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
                  <RowActions
                    align="left"
                    inline={[{
                      key: "view-keys",
                      label: "查看 Key",
                      onClick: () => navigate(`/keys?accountId=${account.id}`),
                    }]}
                    menu={[
                      {
                        key: "rebind",
                        label: "重新绑定",
                        hidden: !canRebindAccount(account),
                        onClick: () => openRebind(account),
                      },
                      {
                        key: "checkin",
                        label: "签到",
                        hidden: !canAccountCheckin(account),
                        disabled: actionId === `run-${account.id}`,
                        onClick: () => void runCheckin(account),
                      },
                      {
                        key: "balance",
                        label: actionId === `balance-${account.id}` ? "刷新中..." : "刷新余额",
                        hidden: !canRefreshAccountBalance(account),
                        disabled: actionId === `balance-${account.id}`,
                        onClick: () => void refreshAccountBalance(account),
                      },
                      {
                        key: "toggle",
                        label: account.status === "disabled" ? "启用" : "停用",
                        onClick: () => void toggleStatus(account),
                      },
                      {
                        key: "delete",
                        label: "删除",
                        danger: true,
                        onClick: () => void deleteAccount(account),
                      },
                    ]}
                  />
                )}
              >
                <MobileField label="站点" value={account.site?.name || "-"} />
                <MobileField
                  label="类型"
                  value={account.credentialMode === "apikey" ? "API Key 连接" : "Session 账户"}
                />
                <MobileField label="余额" value={<BalanceDisplay account={account} />} />
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
                  {isColumnVisible("account") ? <th>账户</th> : null}
                  {isColumnVisible("site") ? <th>站点</th> : null}
                  {isColumnVisible("type") ? <th>类型</th> : null}
                  {isColumnVisible("status") ? <th>状态</th> : null}
                  {isColumnVisible("balance") ? <th>余额</th> : null}
                  {isColumnVisible("checkin") ? <th>签到</th> : null}
                  {isColumnVisible("updatedAt") ? <th>更新时间</th> : null}
                  {isColumnVisible("actions") ? <th style={{ textAlign: "right" }}>操作</th> : null}
                </tr>
              </thead>
              <tbody>
                {filteredAccounts.map((account) => (
                  <tr key={account.id}>
                    {isColumnVisible("account") ? <td style={{ fontWeight: 600 }}>{resolveAccountName(account)}</td> : null}
                    {isColumnVisible("site") ? (
                      <td>
                        <div style={{ display: "grid", gap: 4 }}>
                          <span>{account.site?.name || "-"}</span>
                          <span style={monoTextStyle}>{account.site?.url || "-"}</span>
                        </div>
                      </td>
                    ) : null}
                    {isColumnVisible("type") ? (
                      <td>
                        <span className={`badge ${account.credentialMode === "apikey" ? "badge-warning" : "badge-info"}`}>
                          {account.credentialMode === "apikey" ? "API Key 连接" : "Session 账户"}
                        </span>
                      </td>
                    ) : null}
                    {isColumnVisible("status") ? (
                      <td>
                        <span className={`badge ${statusBadgeClass(account.status)}`}>
                          {account.status === "disabled" ? "停用" : account.status === "expired" ? "过期" : "正常"}
                        </span>
                      </td>
                    ) : null}
                    {isColumnVisible("balance") ? (
                      <td>
                        <BalanceDisplay account={account} />
                      </td>
                    ) : null}
                    {isColumnVisible("checkin") ? (
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
                    ) : null}
                    {isColumnVisible("updatedAt") ? (
                      <td style={{ whiteSpace: "nowrap", color: "var(--color-text-muted)" }}>
                        {formatDateTimeLocal(account.updatedAt || account.createdAt)}
                      </td>
                    ) : null}
                    {isColumnVisible("actions") ? (
                      <td style={{ textAlign: "right" }}>
                        <RowActions
                          align="right"
                          inline={[{
                            key: "view-keys",
                            label: "查看 Key",
                            onClick: () => navigate(`/keys?accountId=${account.id}`),
                          }]}
                          menu={[
                            {
                              key: "rebind",
                              label: "重新绑定",
                              hidden: !canRebindAccount(account),
                              onClick: () => openRebind(account),
                            },
                            {
                              key: "checkin",
                              label: actionId === `run-${account.id}` ? "执行中..." : "签到",
                              hidden: !canAccountCheckin(account),
                              disabled: actionId === `run-${account.id}`,
                              onClick: () => void runCheckin(account),
                            },
                            {
                              key: "balance",
                              label: actionId === `balance-${account.id}` ? "刷新中..." : "刷新余额",
                              hidden: !canRefreshAccountBalance(account),
                              disabled: actionId === `balance-${account.id}`,
                              onClick: () => void refreshAccountBalance(account),
                            },
                            {
                              key: "toggle",
                              label: account.status === "disabled" ? "启用" : "停用",
                              onClick: () => void toggleStatus(account),
                            },
                            {
                              key: "delete",
                              label: "删除",
                              danger: true,
                              onClick: () => void deleteAccount(account),
                            },
                          ]}
                        />
                      </td>
                    ) : null}
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

      {rebindAccount ? (
        <CenteredModal
          open
          onClose={closeRebind}
          title="重新绑定 Session"
          maxWidth={620}
          closeOnBackdrop
          closeOnEscape
          bodyStyle={{ display: "grid", gap: 14 }}
          footer={(
            <>
              <button type="button" className="btn btn-ghost" onClick={closeRebind} disabled={rebinding}>
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void saveRebind()}
                disabled={rebinding}
              >
                {rebinding ? "绑定中..." : "确认绑定"}
              </button>
            </>
          )}
        >
          <div style={{ display: "grid", gap: 14 }}>
            <div
              style={{
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-border)",
                background: "var(--color-bg-card)",
                padding: 12,
                display: "grid",
                gap: 4,
              }}
            >
              <div style={{ fontWeight: 700 }}>{resolveAccountName(rebindAccount)}</div>
              <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                {rebindAccount.site?.name || "-"}
              </div>
            </div>
            <label>
              <div style={fieldLabelStyle}>新的 Session / Cookie / Access Token</div>
              <textarea
                value={rebindForm.accessToken}
                onChange={(event) =>
                  setRebindForm((current) => ({ ...current, accessToken: event.target.value }))
                }
                placeholder="粘贴新的 Session Token"
                style={{ ...inputStyle, minHeight: 110, resize: "vertical", fontFamily: "var(--font-mono)" }}
                autoFocus
              />
            </label>
            <label>
              <div style={fieldLabelStyle}>平台用户 ID（可选）</div>
              <input
                value={rebindForm.platformUserId}
                onChange={(event) =>
                  setRebindForm((current) => ({ ...current, platformUserId: event.target.value }))
                }
                placeholder="仅部分站点需要"
                style={inputStyle}
              />
            </label>
            <div style={{ fontSize: 12, color: "var(--color-text-muted)", lineHeight: 1.6 }}>
              绑定成功后账户状态会恢复为正常，并刷新该账户的 key、余额和模型信息。
            </div>
          </div>
        </CenteredModal>
      ) : null}

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
