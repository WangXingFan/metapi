import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
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
import { formatDateTimeLocal } from "./helpers/checkinLogTime.js";
import {
  copyText,
  fieldLabelStyle,
  inputStyle,
  maskSecret,
  monoTextStyle,
  parsePositiveInt,
} from "./lite/shared.js";

type AccountItem = {
  id: number;
  username?: string | null;
  status?: string | null;
  credentialMode?: "session" | "apikey" | string;
  apiToken?: string | null;
  oauthProvider?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  site?: {
    id: number;
    name: string;
    url?: string | null;
  } | null;
};

type SiteOption = {
  id: number;
  name: string;
};

type TokenItem = {
  id: number;
  accountId: number;
  name?: string | null;
  tokenMasked?: string | null;
  tokenGroup?: string | null;
  valueStatus?: string | null;
  enabled?: boolean;
  isDefault?: boolean;
  updatedAt?: string | null;
};

function resolveAccountName(account: AccountItem): string {
  const username = String(account.username || "").trim();
  if (username) return username;
  return account.credentialMode === "apikey" ? "API Key 连接" : `账号 #${account.id}`;
}

function filterOutOauthAccounts(items: AccountItem[]): AccountItem[] {
  return items.filter((item) => !String(item.oauthProvider || "").trim());
}

function isMaskedPendingToken(token: TokenItem): boolean {
  return token.valueStatus === "masked_pending";
}

type TokenColumnKey = "site" | "account" | "name" | "value" | "group" | "status" | "updatedAt" | "actions";
type DirectKeyColumnKey = "site" | "account" | "key" | "updatedAt" | "actions";

const TOKEN_COLUMNS: ColumnOption<TokenColumnKey>[] = [
  { key: "site", label: "站点" },
  { key: "account", label: "账户" },
  { key: "name", label: "Key 名称" },
  { key: "value", label: "Key 值" },
  { key: "group", label: "分组" },
  { key: "status", label: "状态" },
  { key: "updatedAt", label: "更新时间" },
  { key: "actions", label: "操作" },
];

const DIRECT_KEY_COLUMNS: ColumnOption<DirectKeyColumnKey>[] = [
  { key: "site", label: "站点" },
  { key: "account", label: "账户" },
  { key: "key", label: "Key" },
  { key: "updatedAt", label: "更新时间" },
  { key: "actions", label: "操作" },
];

export default function LiteKeys() {
  const toast = useToast();
  const confirm = useConfirm();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [tokens, setTokens] = useState<TokenItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [siteFilter, setSiteFilter] = useState<number>(0);
  const [accountFilter, setAccountFilter] = useState<number>(0);
  const [search, setSearch] = useState("");
  const [actionId, setActionId] = useState("");
  const [editingToken, setEditingToken] = useState<TokenItem | null>(null);
  const [editTokenValue, setEditTokenValue] = useState("");
  const [savingToken, setSavingToken] = useState(false);

  const requestedSiteId = useMemo(
    () => parsePositiveInt(new URLSearchParams(location.search).get("siteId")),
    [location.search],
  );
  const requestedAccountId = useMemo(
    () => parsePositiveInt(new URLSearchParams(location.search).get("accountId")),
    [location.search],
  );

  const load = async () => {
    setLoading(true);
    try {
      const [snapshot, tokenRows] = await Promise.all([
        api.getAccountsSnapshot(),
        api.getAccountTokens(),
      ]);
      setSites(
        Array.isArray(snapshot?.sites)
          ? snapshot.sites
            .filter((site): site is SiteOption => typeof site?.id === "number")
            .map((site) => ({
              id: site.id,
              name: site.name || `站点 ${site.id}`,
            }))
          : [],
      );
      setAccounts(
        filterOutOauthAccounts(Array.isArray(snapshot?.accounts) ? snapshot.accounts : []),
      );
      setTokens(Array.isArray(tokenRows) ? tokenRows : []);
    } catch (error: any) {
      toast.error(error?.message || "加载账号 key 失败");
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
    }
    if (requestedAccountId) {
      setAccountFilter(requestedAccountId);
    }
  }, [requestedAccountId, requestedSiteId]);

  const siteOptions = useMemo(() => {
    const activeSiteIds = new Set<number>();
    for (const account of accounts) {
      if (account.site?.id) {
        activeSiteIds.add(account.site.id);
      }
    }
    return sites.filter((site) => activeSiteIds.has(site.id));
  }, [accounts, sites]);

  const availableAccounts = useMemo(() => {
    return accounts
      .filter((account) => {
        if (siteFilter > 0 && account.site?.id !== siteFilter) return false;
        return true;
      });
  }, [accounts, siteFilter]);

  const filteredAccounts = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return availableAccounts.filter((account) => {
      if (accountFilter > 0 && account.id !== accountFilter) return false;
      if (!normalizedSearch) return true;
      const haystack = [
        resolveAccountName(account),
        account.site?.name || "",
        account.site?.url || "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [accountFilter, availableAccounts, search]);

  const tokenMap = useMemo(() => {
    const map = new Map<number, TokenItem[]>();
    for (const token of tokens) {
      const bucket = map.get(token.accountId) || [];
      bucket.push(token);
      map.set(token.accountId, bucket);
    }
    return map;
  }, [tokens]);

  const sessionAccounts = useMemo(
    () => filteredAccounts.filter((account) => account.credentialMode !== "apikey"),
    [filteredAccounts],
  );
  const apiKeyAccounts = useMemo(
    () =>
      filteredAccounts.filter(
        (account) => account.credentialMode === "apikey" && String(account.apiToken || "").trim(),
      ),
    [filteredAccounts],
  );
  const visibleTokenRows = useMemo(
    () =>
      sessionAccounts.flatMap((account) =>
        (tokenMap.get(account.id) || []).map((token) => ({
          account,
          token,
        })),
      ),
    [sessionAccounts, tokenMap],
  );
  const selectedSessionAccount = useMemo(() => {
    if (accountFilter <= 0) return null;
    return filteredAccounts.find((account) => (
      account.id === accountFilter && account.credentialMode !== "apikey"
    )) || null;
  }, [accountFilter, filteredAccounts]);


  const syncTokens = async (account: AccountItem) => {
    setActionId(`sync-${account.id}`);
    try {
      await api.syncAccountTokens(account.id);
      toast.success(`已同步 ${resolveAccountName(account)} 的站点 key`);
      await load();
    } catch (error: any) {
      toast.error(error?.message || "同步站点 key 失败");
    } finally {
      setActionId("");
    }
  };

  const copyTokenValue = async (tokenId: number) => {
    setActionId(`copy-token-${tokenId}`);
    try {
      const result = await api.getAccountTokenValue(tokenId);
      if (!result?.token) {
        throw new Error("未返回完整 key");
      }
      await copyText(result.token);
      toast.success("已复制完整 key");
    } catch (error: any) {
      toast.error(error?.message || "复制失败");
    } finally {
      setActionId("");
    }
  };

  const copyDirectApiKey = async (account: AccountItem) => {
    const value = String(account.apiToken || "").trim();
    if (!value) {
      toast.info("该账户没有可复制的 key");
      return;
    }

    setActionId(`copy-direct-${account.id}`);
    try {
      await copyText(value);
      toast.success("已复制账户 key");
    } catch (error: any) {
      toast.error(error?.message || "复制失败");
    } finally {
      setActionId("");
    }
  };

  const isDeletingToken = (tokenId: number) =>
    actionId === `delete-token-${tokenId}` || actionId === `delete-token-local-${tokenId}`;

  const deleteToken = async (token: TokenItem) => {
    const tokenName = token.name || "未命名 key";
    const confirmed = await confirm({
      title: "删除账号 Key",
      message: `确定删除 key“${tokenName}”吗？将优先同步删除上游站点 key。`,
      confirmText: "删除",
      tone: "danger",
    });
    if (!confirmed) return;

    setActionId(`delete-token-${token.id}`);
    try {
      await api.deleteAccountToken(token.id);
      toast.success("key 已删除");
      await load();
    } catch (error: any) {
      const message = error?.message || "删除 key 失败";
      const localConfirmed = await confirm({
        title: "上游删除失败",
        message: `删除上游 key 失败：${message}\n是否仅删除本地记录？`,
        confirmText: "仅删除本地",
        tone: "warning",
      });
      if (!localConfirmed) {
        toast.error(message);
        return;
      }

      try {
        setActionId(`delete-token-local-${token.id}`);
        await api.deleteAccountToken(token.id, { localOnly: true });
        toast.success("本地 key 记录已删除");
        await load();
      } catch (localError: any) {
        toast.error(localError?.message || "删除本地 key 失败");
      }
    } finally {
      setActionId("");
    }
  };

  const openCompleteToken = (token: TokenItem) => {
    setEditingToken(token);
    setEditTokenValue("");
  };

  const closeCompleteToken = () => {
    setEditingToken(null);
    setEditTokenValue("");
    setSavingToken(false);
  };

  const saveCompleteToken = async () => {
    if (!editingToken) return;
    const tokenValue = editTokenValue.trim();
    if (!tokenValue) {
      toast.error("请粘贴完整明文 key");
      return;
    }

    setSavingToken(true);
    try {
      await api.updateAccountToken(editingToken.id, {
        token: tokenValue,
        enabled: true,
        isDefault: editingToken.isDefault,
      });
      toast.success("完整 key 已保存");
      closeCompleteToken();
      await load();
    } catch (error: any) {
      toast.error(error?.message || "保存完整 key 失败");
    } finally {
      setSavingToken(false);
    }
  };

  const {
    visibleColumns: visibleTokenColumns,
    isColumnVisible: isTokenColumnVisible,
    toggleColumn: toggleTokenColumn,
    showAllColumns: showAllTokenColumns,
  } = useColumnVisibility("metapi.liteKeys.tokens.columns", TOKEN_COLUMNS);
  const {
    visibleColumns: visibleDirectKeyColumns,
    isColumnVisible: isDirectKeyColumnVisible,
    toggleColumn: toggleDirectKeyColumn,
    showAllColumns: showAllDirectKeyColumns,
  } = useColumnVisibility("metapi.liteKeys.direct.columns", DIRECT_KEY_COLUMNS);

  return (
    <div className="animate-fade-in stack-md">
      <div className="page-header">
        <div>
          <h2 className="page-title">账号 Key</h2>
          <p className="page-subtitle">同步、补全、复制站点账号下挂载的 API Key</p>
        </div>
        <RefreshButton onRefresh={load} refreshing={loading} />
      </div>

      <div className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(180px, 220px) minmax(180px, 220px) minmax(220px, 1fr) auto",
            gap: 12,
            alignItems: "end",
          }}
        >
          <label>
            <div style={fieldLabelStyle}>筛选站点</div>
            <select
              value={siteFilter}
              onChange={(event) => {
                const nextValue = Number.parseInt(event.target.value, 10);
                setSiteFilter(nextValue);
                if (nextValue === 0) return;
                const currentAccount = filteredAccounts.find((account) => account.id === accountFilter);
                if (currentAccount?.site?.id !== nextValue) {
                  setAccountFilter(0);
                }
              }}
              style={inputStyle}
            >
              <option value={0}>全部站点</option>
              {siteOptions.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <div style={fieldLabelStyle}>筛选账户</div>
            <select
              value={accountFilter}
              onChange={(event) => setAccountFilter(Number.parseInt(event.target.value, 10))}
              style={inputStyle}
            >
              <option value={0}>全部账户</option>
              {availableAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {resolveAccountName(account)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <div style={fieldLabelStyle}>搜索</div>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="按账户 / 站点 / URL 搜索"
              style={inputStyle}
            />
          </label>
          {selectedSessionAccount ? (
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              {!isMobile && visibleTokenRows.length > 0 ? (
                <ColumnVisibilityControl<TokenColumnKey>
                  columns={TOKEN_COLUMNS}
                  visibleColumns={visibleTokenColumns}
                  onToggleColumn={toggleTokenColumn}
                  onShowAll={showAllTokenColumns}
                />
              ) : null}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void syncTokens(selectedSessionAccount)}
                disabled={actionId === `sync-${selectedSessionAccount.id}`}
              >
                {actionId === `sync-${selectedSessionAccount.id}` ? "同步中..." : "同步当前账户"}
              </button>
            </div>
          ) : !isMobile && visibleTokenRows.length > 0 ? (
            <ColumnVisibilityControl<TokenColumnKey>
              columns={TOKEN_COLUMNS}
              visibleColumns={visibleTokenColumns}
              onToggleColumn={toggleTokenColumn}
              onShowAll={showAllTokenColumns}
            />
          ) : !isMobile && apiKeyAccounts.length > 0 ? (
            <ColumnVisibilityControl<DirectKeyColumnKey>
              columns={DIRECT_KEY_COLUMNS}
              visibleColumns={visibleDirectKeyColumns}
              onToggleColumn={toggleDirectKeyColumn}
              onShowAll={showAllDirectKeyColumns}
            />
          ) : null}
        </div>

        {loading ? (
          <div style={{ display: "grid", gap: 10 }}>
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={`keys-skeleton-${index}`} className="skeleton" style={{ height: 52 }} />
            ))}
          </div>
        ) : (
          <>
            {visibleTokenRows.length > 0 ? (
              <div className="card" style={{ padding: 0, boxShadow: "none", border: "1px solid var(--color-border)" }}>
                {isMobile ? (
                  <div className="mobile-card-list" style={{ padding: 12 }}>
                    {visibleTokenRows.map(({ account, token }) => {
                      const isPending = isMaskedPendingToken(token);
                      return (
                        <MobileCard
                          key={token.id}
                          title={token.name || "未命名 key"}
                          headerActions={(
                            <span className={`badge ${isPending ? "badge-warning" : token.enabled ? "badge-success" : "badge-muted"}`} style={{ fontSize: 11 }}>
                              {isPending ? "待补全" : token.enabled ? "可用" : "停用"}
                            </span>
                          )}
                          footerActions={(
                            <>
                              {isPending ? (
                                <button
                                  type="button"
                                  className="btn btn-link"
                                  onClick={() => openCompleteToken(token)}
                                >
                                  补全
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn-link"
                                  onClick={() => void copyTokenValue(token.id)}
                                  disabled={actionId === `copy-token-${token.id}`}
                                >
                                  复制
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn btn-link"
                                onClick={() => void syncTokens(account)}
                                disabled={actionId === `sync-${account.id}`}
                              >
                                同步
                              </button>
                              <button
                                type="button"
                                className="btn btn-link btn-link-danger"
                                onClick={() => void deleteToken(token)}
                                disabled={isDeletingToken(token.id)}
                              >
                                {isDeletingToken(token.id) ? "删除中..." : "删除"}
                              </button>
                            </>
                          )}
                        >
                          <MobileField label="站点" value={account.site?.name || "-"} />
                          <MobileField label="账户" value={resolveAccountName(account)} />
                          <MobileField
                            label="Key"
                            stacked
                            value={<span style={monoTextStyle}>{token.tokenMasked || "-"}</span>}
                          />
                          <MobileField label="分组" value={token.tokenGroup || "default"} />
                          <MobileField label="更新时间" value={formatDateTimeLocal(token.updatedAt)} />
                        </MobileCard>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          {isTokenColumnVisible("site") ? <th>站点</th> : null}
                          {isTokenColumnVisible("account") ? <th>账户</th> : null}
                          {isTokenColumnVisible("name") ? <th>Key 名称</th> : null}
                          {isTokenColumnVisible("value") ? <th>Key 值</th> : null}
                          {isTokenColumnVisible("group") ? <th>分组</th> : null}
                          {isTokenColumnVisible("status") ? <th>状态</th> : null}
                          {isTokenColumnVisible("updatedAt") ? <th>更新时间</th> : null}
                          {isTokenColumnVisible("actions") ? <th style={{ textAlign: "right" }}>操作</th> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleTokenRows.map(({ account, token }) => {
                          const isPending = isMaskedPendingToken(token);
                          return (
                            <tr key={token.id}>
                              {isTokenColumnVisible("site") ? <td>{account.site?.name || "-"}</td> : null}
                              {isTokenColumnVisible("account") ? <td style={{ fontWeight: 600 }}>{resolveAccountName(account)}</td> : null}
                              {isTokenColumnVisible("name") ? <td>{token.name || "未命名 key"}</td> : null}
                              {isTokenColumnVisible("value") ? (
                                <td>
                                  <span style={monoTextStyle}>{token.tokenMasked || "-"}</span>
                                </td>
                              ) : null}
                              {isTokenColumnVisible("group") ? <td>{token.tokenGroup || "default"}</td> : null}
                              {isTokenColumnVisible("status") ? (
                                <td>
                                  <span className={`badge ${isPending ? "badge-warning" : token.enabled ? "badge-success" : "badge-muted"}`}>
                                    {isPending ? "待补全" : token.enabled ? "可用" : "停用"}
                                  </span>
                                </td>
                              ) : null}
                              {isTokenColumnVisible("updatedAt") ? (
                                <td style={{ whiteSpace: "nowrap", color: "var(--color-text-muted)" }}>
                                  {formatDateTimeLocal(token.updatedAt)}
                                </td>
                              ) : null}
                              {isTokenColumnVisible("actions") ? (
                                <td style={{ textAlign: "right" }}>
                                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                                    {isPending ? (
                                      <button
                                        type="button"
                                        className="btn btn-link"
                                        onClick={() => openCompleteToken(token)}
                                      >
                                        补全
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        className="btn btn-link"
                                        onClick={() => void copyTokenValue(token.id)}
                                        disabled={actionId === `copy-token-${token.id}`}
                                      >
                                        {actionId === `copy-token-${token.id}` ? "复制中..." : "复制"}
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className="btn btn-link"
                                      onClick={() => void syncTokens(account)}
                                      disabled={actionId === `sync-${account.id}`}
                                    >
                                      {actionId === `sync-${account.id}` ? "同步中..." : "同步所属账户"}
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-link btn-link-danger"
                                      onClick={() => void deleteToken(token)}
                                      disabled={isDeletingToken(token.id)}
                                    >
                                      {isDeletingToken(token.id) ? "删除中..." : "删除"}
                                    </button>
                                  </div>
                                </td>
                              ) : null}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}

            {apiKeyAccounts.length > 0 ? (
              <div className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>直连 API Key 连接</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
                    这部分不是从 Session 账户同步，而是直接导入保存的账户 key。
                  </div>
                </div>
                {isMobile ? (
                  <div className="mobile-card-list">
                    {apiKeyAccounts.map((account) => (
                      <MobileCard
                        key={`direct-${account.id}`}
                        title={resolveAccountName(account)}
                        headerActions={(
                          <span className="badge badge-warning" style={{ fontSize: 11 }}>
                            直连
                          </span>
                        )}
                        footerActions={(
                          <button
                            type="button"
                            className="btn btn-link"
                            onClick={() => void copyDirectApiKey(account)}
                            disabled={actionId === `copy-direct-${account.id}`}
                          >
                            复制
                          </button>
                        )}
                      >
                        <MobileField label="站点" value={account.site?.name || "-"} />
                        <MobileField
                          label="Key"
                          stacked
                          value={<span style={monoTextStyle}>{maskSecret(account.apiToken)}</span>}
                        />
                        <MobileField label="更新时间" value={formatDateTimeLocal(account.updatedAt || account.createdAt)} />
                      </MobileCard>
                    ))}
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    <ColumnVisibilityControl
                      columns={DIRECT_KEY_COLUMNS}
                      visibleColumns={visibleDirectKeyColumns}
                      onToggleColumn={toggleDirectKeyColumn}
                      onShowAll={showAllDirectKeyColumns}
                    />
                    <div style={{ overflowX: "auto" }}>
                      <table className="data-table">
                        <thead>
                          <tr>
                            {isDirectKeyColumnVisible("site") ? <th>站点</th> : null}
                            {isDirectKeyColumnVisible("account") ? <th>账户</th> : null}
                            {isDirectKeyColumnVisible("key") ? <th>Key</th> : null}
                            {isDirectKeyColumnVisible("updatedAt") ? <th>更新时间</th> : null}
                            {isDirectKeyColumnVisible("actions") ? <th style={{ textAlign: "right" }}>操作</th> : null}
                          </tr>
                        </thead>
                        <tbody>
                          {apiKeyAccounts.map((account) => (
                            <tr key={`direct-row-${account.id}`}>
                              {isDirectKeyColumnVisible("site") ? <td>{account.site?.name || "-"}</td> : null}
                              {isDirectKeyColumnVisible("account") ? <td style={{ fontWeight: 600 }}>{resolveAccountName(account)}</td> : null}
                              {isDirectKeyColumnVisible("key") ? (
                                <td>
                                  <span style={monoTextStyle}>{maskSecret(account.apiToken)}</span>
                                </td>
                              ) : null}
                              {isDirectKeyColumnVisible("updatedAt") ? (
                                <td style={{ whiteSpace: "nowrap", color: "var(--color-text-muted)" }}>
                                  {formatDateTimeLocal(account.updatedAt || account.createdAt)}
                                </td>
                              ) : null}
                              {isDirectKeyColumnVisible("actions") ? (
                                <td style={{ textAlign: "right" }}>
                                  <button
                                    type="button"
                                    className="btn btn-link"
                                    onClick={() => void copyDirectApiKey(account)}
                                    disabled={actionId === `copy-direct-${account.id}`}
                                  >
                                    {actionId === `copy-direct-${account.id}` ? "复制中..." : "复制"}
                                  </button>
                                </td>
                              ) : null}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {visibleTokenRows.length <= 0 && apiKeyAccounts.length <= 0 ? (
              <div className="empty-state" style={{ padding: 28 }}>
                <div className="empty-state-title">
                  {selectedSessionAccount ? `${resolveAccountName(selectedSessionAccount)} 暂无可用 key` : "暂无可用 key"}
                </div>
                <div className="empty-state-desc">
                  {selectedSessionAccount
                    ? "该账户当前没有已保存的 key，可以重新同步上游站点。"
                    : "当前筛选条件下没有已保存的 key。"}
                </div>
                {selectedSessionAccount ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void syncTokens(selectedSessionAccount)}
                    disabled={actionId === `sync-${selectedSessionAccount.id}`}
                    style={{ justifySelf: "center", marginTop: 12 }}
                  >
                    {actionId === `sync-${selectedSessionAccount.id}` ? "同步中..." : "同步当前账户"}
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>

      {editingToken ? (
        <CenteredModal
          open
          title="补全完整 key"
          onClose={closeCompleteToken}
          maxWidth={520}
          footer={(
            <>
              <button type="button" className="btn btn-ghost" onClick={closeCompleteToken} disabled={savingToken}>
                取消
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void saveCompleteToken()} disabled={savingToken}>
                {savingToken ? "保存中..." : "保存完整 key"}
              </button>
            </>
          )}
        >
          <div style={{ display: "grid", gap: 12 }}>
            <div className="alert alert-warning">
              当前本地只有上游返回的脱敏值：
              <span style={{ ...monoTextStyle, marginLeft: 6 }}>{editingToken.tokenMasked || "-"}</span>
              。请从上游站点复制完整 key，或重新生成后粘贴到这里。
            </div>
            <label>
              <div style={fieldLabelStyle}>完整明文 key</div>
              <input
                type="password"
                value={editTokenValue}
                onChange={(event) => setEditTokenValue(event.target.value)}
                placeholder="粘贴完整 key，例如 sk-..."
                style={inputStyle}
                autoFocus
              />
            </label>
          </div>
        </CenteredModal>
      ) : null}
    </div>
  );
}
