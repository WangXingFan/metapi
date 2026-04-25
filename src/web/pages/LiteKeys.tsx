import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api.js";
import CenteredModal from "../components/CenteredModal.js";
import { MobileCard, MobileField } from "../components/MobileCard.js";
import { useIsMobile } from "../components/useIsMobile.js";
import { useToast } from "../components/Toast.js";
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

export default function LiteKeys() {
  const toast = useToast();
  const location = useLocation();
  const isMobile = useIsMobile();
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
    const deduped = new Map<number, { id: number; name: string }>();
    for (const account of accounts) {
      if (!account.site?.id) continue;
      if (!deduped.has(account.site.id)) {
        deduped.set(account.site.id, {
          id: account.site.id,
          name: account.site.name || `站点 ${account.site.id}`,
        });
      }
    }
    return Array.from(deduped.values()).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }, [accounts]);

  const availableAccounts = useMemo(() => {
    return accounts
      .filter((account) => {
        if (siteFilter > 0 && account.site?.id !== siteFilter) return false;
        return true;
      })
      .sort((left, right) => resolveAccountName(left).localeCompare(resolveAccountName(right)));
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
    for (const bucket of map.values()) {
      bucket.sort((left, right) => {
        if (left.isDefault === true && right.isDefault !== true) return -1;
        if (left.isDefault !== true && right.isDefault === true) return 1;
        return String(left.name || "").localeCompare(String(right.name || ""));
      });
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
  const unsyncedSessionAccounts = useMemo(
    () =>
      sessionAccounts.filter((account) => (tokenMap.get(account.id) || []).length <= 0),
    [sessionAccounts, tokenMap],
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

  const pendingTokenCount = useMemo(
    () => visibleTokenRows.filter(({ token }) => isMaskedPendingToken(token)).length,
    [visibleTokenRows],
  );

  const summary = useMemo(() => {
    return {
      sessionAccounts: sessionAccounts.length,
      unsynced: unsyncedSessionAccounts.length,
      tokens: visibleTokenRows.length,
      pending: pendingTokenCount,
      directApiKeys: apiKeyAccounts.length,
    };
  }, [apiKeyAccounts.length, pendingTokenCount, sessionAccounts.length, unsyncedSessionAccounts.length, visibleTokenRows.length]);

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

  const setDefaultToken = async (tokenId: number) => {
    setActionId(`default-${tokenId}`);
    try {
      await api.setDefaultAccountToken(tokenId);
      toast.success("默认 key 已更新");
      await load();
    } catch (error: any) {
      toast.error(error?.message || "设置默认 key 失败");
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

  const summaryCards = [
    { label: "Session 账户", value: summary.sessionAccounts, tone: "badge-info" },
    { label: "待同步账户", value: summary.unsynced, tone: "badge-warning" },
    { label: "已同步 key", value: summary.tokens, tone: "badge-success" },
    { label: "待补全 key", value: summary.pending, tone: "badge-warning" },
    { label: "直连 API Key", value: summary.directApiKeys, tone: "badge-muted" },
  ];

  return (
    <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="page-header">
        <div>
          <h2 className="page-title">账号 Key</h2>
          <div style={{ fontSize: 13, color: "var(--color-text-muted)", marginTop: 6 }}>
            这里集中处理两类 key：Session 账户同步出来的站点 key，以及直接导入的 API Key 连接。
          </div>
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
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <strong style={{ fontSize: 24, lineHeight: 1 }}>{item.value}</strong>
              <span className={`badge ${item.tone}`} style={{ fontSize: 11 }}>
                核心链路
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(180px, 220px) minmax(180px, 220px) minmax(220px, 1fr)",
            gap: 12,
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
        </div>

        {loading ? (
          <div style={{ display: "grid", gap: 10 }}>
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={`keys-skeleton-${index}`} className="skeleton" style={{ height: 52 }} />
            ))}
          </div>
        ) : (
          <>
            {unsyncedSessionAccounts.length > 0 ? (
              <div
                style={{
                  borderRadius: "var(--radius-md)",
                  border: "1px solid color-mix(in srgb, var(--color-warning) 28%, transparent)",
                  background: "color-mix(in srgb, var(--color-warning) 8%, var(--color-bg-card))",
                  padding: 14,
                  display: "grid",
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>待同步的 Session 账户</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
                    这些账户还没有拿到站点 key，点击同步即可尝试从站点抓取。
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {unsyncedSessionAccounts.map((account) => (
                    <div
                      key={`unsynced-${account.id}`}
                      style={{
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--color-border)",
                        background: "var(--color-bg-card)",
                        padding: 12,
                        minWidth: 220,
                        display: "grid",
                        gap: 8,
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{resolveAccountName(account)}</div>
                      <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                        {account.site?.name || "-"}
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => void syncTokens(account)}
                        disabled={actionId === `sync-${account.id}`}
                      >
                        {actionId === `sync-${account.id}` ? "同步中..." : "同步该账户 Key"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

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
                            <span className={`badge ${isPending ? "badge-warning" : token.isDefault ? "badge-warning" : token.enabled ? "badge-success" : "badge-muted"}`} style={{ fontSize: 11 }}>
                              {isPending ? "待补全" : token.isDefault ? "默认" : token.enabled ? "可用" : "停用"}
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
                              {!isPending && !token.isDefault ? (
                                <button
                                  type="button"
                                  className="btn btn-link"
                                  onClick={() => void setDefaultToken(token.id)}
                                  disabled={actionId === `default-${token.id}`}
                                >
                                  设默认
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="btn btn-link"
                                onClick={() => void syncTokens(account)}
                                disabled={actionId === `sync-${account.id}`}
                              >
                                同步
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
                          <th>站点</th>
                          <th>账户</th>
                          <th>Key 名称</th>
                          <th>Key 值</th>
                          <th>分组</th>
                          <th>状态</th>
                          <th>更新时间</th>
                          <th style={{ textAlign: "right" }}>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleTokenRows.map(({ account, token }) => {
                          const isPending = isMaskedPendingToken(token);
                          return (
                            <tr key={token.id}>
                              <td>{account.site?.name || "-"}</td>
                              <td style={{ fontWeight: 600 }}>{resolveAccountName(account)}</td>
                              <td>{token.name || "未命名 key"}</td>
                              <td>
                                <span style={monoTextStyle}>{token.tokenMasked || "-"}</span>
                              </td>
                              <td>{token.tokenGroup || "default"}</td>
                              <td>
                                <span className={`badge ${isPending ? "badge-warning" : token.isDefault ? "badge-warning" : token.enabled ? "badge-success" : "badge-muted"}`}>
                                  {isPending ? "待补全" : token.isDefault ? "默认" : token.enabled ? "可用" : "停用"}
                                </span>
                              </td>
                              <td style={{ whiteSpace: "nowrap", color: "var(--color-text-muted)" }}>
                                {formatDateTimeLocal(token.updatedAt)}
                              </td>
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
                                  {!isPending && !token.isDefault ? (
                                    <button
                                      type="button"
                                      className="btn btn-link"
                                      onClick={() => void setDefaultToken(token.id)}
                                      disabled={actionId === `default-${token.id}`}
                                    >
                                      {actionId === `default-${token.id}` ? "处理中..." : "设默认"}
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="btn btn-link"
                                    onClick={() => void syncTokens(account)}
                                    disabled={actionId === `sync-${account.id}`}
                                  >
                                    {actionId === `sync-${account.id}` ? "同步中..." : "同步所属账户"}
                                  </button>
                                </div>
                              </td>
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
                  <div style={{ overflowX: "auto" }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>站点</th>
                          <th>账户</th>
                          <th>Key</th>
                          <th>更新时间</th>
                          <th style={{ textAlign: "right" }}>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {apiKeyAccounts.map((account) => (
                          <tr key={`direct-row-${account.id}`}>
                            <td>{account.site?.name || "-"}</td>
                            <td style={{ fontWeight: 600 }}>{resolveAccountName(account)}</td>
                            <td>
                              <span style={monoTextStyle}>{maskSecret(account.apiToken)}</span>
                            </td>
                            <td style={{ whiteSpace: "nowrap", color: "var(--color-text-muted)" }}>
                              {formatDateTimeLocal(account.updatedAt || account.createdAt)}
                            </td>
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
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}

            {summary.tokens <= 0 && summary.directApiKeys <= 0 && summary.unsynced <= 0 ? (
              <div className="empty-state" style={{ padding: 28 }}>
                <div className="empty-state-title">暂无可用 key</div>
                <div className="empty-state-desc">先在“账户”页添加站点账户，再回到这里同步或复制 key。</div>
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
