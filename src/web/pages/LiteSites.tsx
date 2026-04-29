import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import CenteredModal from "../components/CenteredModal.js";
import {
  ColumnVisibilityControl,
  type ColumnOption,
  useColumnVisibility,
} from "../components/ColumnVisibilityControl.js";
import { MobileCard, MobileField } from "../components/MobileCard.js";
import RefreshButton from "../components/RefreshButton.js";
import RowActions, { type RowAction } from "../components/RowActions.js";
import { useIsMobile } from "../components/useIsMobile.js";
import { useToast } from "../components/Toast.js";
import { useConfirm } from "../components/ConfirmDialog.js";
import { formatDateTimeLocal } from "./helpers/checkinLogTime.js";
import { fieldLabelStyle, inputStyle, monoTextStyle } from "./lite/shared.js";

type SiteItem = {
  id: number;
  name: string;
  url: string;
  platform?: string | null;
  status?: string | null;
  externalCheckinUrl?: string | null;
  proxyUrl?: string | null;
  useSystemProxy?: boolean | null;
  createdAt?: string | null;
};

type ProxyMode = "none" | "system" | "custom";

type SiteForm = {
  name: string;
  url: string;
  platform: string;
  externalCheckinUrl: string;
  proxyMode: ProxyMode;
  proxyUrl: string;
};

const PLATFORM_OPTIONS = [
  { value: "", label: "自动检测" },
  { value: "new-api", label: "new-api" },
  { value: "one-api", label: "one-api" },
  { value: "anyrouter", label: "anyrouter" },
  { value: "one-hub", label: "one-hub" },
  { value: "done-hub", label: "done-hub" },
  { value: "sub2api", label: "sub2api" },
  { value: "openai", label: "openai" },
  { value: "claude", label: "claude" },
  { value: "gemini", label: "gemini" },
  { value: "cliproxyapi", label: "cliproxyapi" },
];

function createEmptyForm(): SiteForm {
  return {
    name: "",
    url: "",
    platform: "",
    externalCheckinUrl: "",
    proxyMode: "none",
    proxyUrl: "",
  };
}

function statusBadgeClass(status?: string | null): string {
  return status === "disabled" ? "badge-muted" : "badge-success";
}

function resolveExternalUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "#";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function resolveProxyMode(site: SiteItem): ProxyMode {
  if (String(site.proxyUrl || "").trim()) return "custom";
  if (site.useSystemProxy) return "system";
  return "none";
}

function buildProxyPayload(form: SiteForm): { proxyUrl: string | null; useSystemProxy: boolean } {
  if (form.proxyMode === "custom") {
    return {
      proxyUrl: form.proxyUrl.trim(),
      useSystemProxy: false,
    };
  }
  return {
    proxyUrl: null,
    useSystemProxy: form.proxyMode === "system",
  };
}

function formatCustomProxyUrl(proxyUrl?: string | null): string {
  const trimmed = String(proxyUrl || "").trim();
  if (!trimmed) return "自定义代理";
  try {
    const parsed = new URL(trimmed);
    const host = parsed.host || parsed.hostname;
    return `${parsed.protocol}//${host}`;
  } catch {
    return "自定义代理（已设置）";
  }
}

function renderProxySummary(site: Pick<SiteItem, "proxyUrl" | "useSystemProxy">) {
  const proxyUrl = String(site.proxyUrl || "").trim();
  if (proxyUrl) {
    return (
      <span className="badge badge-info" title="自定义代理">
        {formatCustomProxyUrl(proxyUrl)}
      </span>
    );
  }
  if (site.useSystemProxy) {
    return <span className="badge badge-info">系统代理</span>;
  }
  return <span style={{ color: "var(--color-text-muted)" }}>未设置</span>;
}

function renderSiteUrlLink(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return <span style={{ color: "var(--color-text-muted)" }}>未设置</span>;
  return (
    <a
      href={resolveExternalUrl(trimmed)}
      target="_blank"
      rel="noreferrer"
      style={{ ...monoTextStyle, color: "var(--color-primary)", textDecoration: "none" }}
    >
      {trimmed}
    </a>
  );
}

type SiteColumnKey = "name" | "platform" | "url" | "proxy" | "checkin" | "status" | "createdAt" | "actions";

const SITE_COLUMNS: ColumnOption<SiteColumnKey>[] = [
  { key: "name", label: "名称" },
  { key: "platform", label: "平台" },
  { key: "url", label: "主站地址" },
  { key: "proxy", label: "代理" },
  { key: "checkin", label: "签到入口" },
  { key: "status", label: "状态" },
  { key: "createdAt", label: "创建时间" },
  { key: "actions", label: "操作" },
];

const siteNameButtonStyle: React.CSSProperties = {
  padding: 0,
  border: "none",
  background: "none",
  font: "inherit",
  color: "var(--color-primary)",
  cursor: "pointer",
  textAlign: "left",
};

export default function LiteSites() {
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<SiteItem | null>(null);
  const [form, setForm] = useState<SiteForm>(() => createEmptyForm());

  const load = async () => {
    setLoading(true);
    try {
      const rows = await api.getSites();
      setSites(Array.isArray(rows) ? rows : []);
    } catch (error: any) {
      toast.error(error?.message || "加载站点失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openSiteAccounts = (siteId: number) => {
    navigate(`/accounts?siteId=${siteId}`);
  };

  const openSiteAccountCreate = (siteId: number) => {
    navigate(`/accounts?siteId=${siteId}&create=1`);
  };

  const openCreate = () => {
    setEditingSite(null);
    setForm(createEmptyForm());
    setEditorOpen(true);
  };

  const openEdit = (site: SiteItem) => {
    setEditingSite(site);
    setForm({
      name: site.name || "",
      url: site.url || "",
      platform: String(site.platform || ""),
      externalCheckinUrl: String(site.externalCheckinUrl || ""),
      proxyMode: resolveProxyMode(site),
      proxyUrl: String(site.proxyUrl || ""),
    });
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditingSite(null);
    setForm(createEmptyForm());
    setDetecting(false);
  };

  const detectPlatform = async () => {
    if (!form.url.trim()) {
      toast.info("先填写站点 URL");
      return;
    }
    setDetecting(true);
    try {
      const result = await api.detectSite(form.url.trim());
      if (result?.platform) {
        setForm((current) => ({ ...current, platform: String(result.platform) }));
        toast.success(`已识别平台：${result.platform}`);
      } else {
        toast.info(result?.error || "未识别到平台，可手动选择");
      }
    } catch (error: any) {
      toast.error(error?.message || "平台检测失败");
    } finally {
      setDetecting(false);
    }
  };

  const saveSite = async () => {
    if (!form.name.trim() || !form.url.trim()) {
      toast.error("站点名称和 URL 不能为空");
      return;
    }

    const payload = {
      name: form.name.trim(),
      url: form.url.trim(),
      platform: form.platform.trim() || undefined,
      externalCheckinUrl: form.externalCheckinUrl.trim(),
      ...buildProxyPayload(form),
    };

    if (form.proxyMode === "custom" && !payload.proxyUrl) {
      toast.error("请填写自定义代理地址");
      return;
    }

    setSaving(true);
    try {
      if (editingSite) {
        await api.updateSite(editingSite.id, payload);
        toast.success("站点已更新");
      } else {
        const created = await api.addSite(payload);
        toast.success("站点已添加");
        if (created?.id) {
          openSiteAccountCreate(created.id);
        }
      }
      closeEditor();
      await load();
    } catch (error: any) {
      toast.error(error?.message || "保存站点失败");
    } finally {
      setSaving(false);
    }
  };

  const deleteSite = async (site: SiteItem) => {
    const confirmed = await confirm({
      title: "删除站点",
      message: `确定删除站点“${site.name}”吗？该站点下所有账户与本地 Key 记录都会一并删除。`,
      confirmText: "删除",
      tone: "danger",
    });
    if (!confirmed) return;

    try {
      await api.deleteSite(site.id);
      toast.success("站点已删除");
      await load();
    } catch (error: any) {
      toast.error(error?.message || "删除站点失败");
    }
  };

  const toggleSiteStatus = async (site: SiteItem) => {
    try {
      await api.updateSite(site.id, {
        status: site.status === "disabled" ? "active" : "disabled",
      });
      toast.success(site.status === "disabled" ? "站点已启用" : "站点已停用");
      await load();
    } catch (error: any) {
      toast.error(error?.message || "更新站点状态失败");
    }
  };

  const { visibleColumns, isColumnVisible, toggleColumn, showAllColumns } = useColumnVisibility(
    "metapi.liteSites.columns",
    SITE_COLUMNS,
  );

  return (
    <div className="animate-fade-in stack-md">
      <div className="page-header">
        <div>
          <h2 className="page-title">站点</h2>
          <p className="page-subtitle">维护上游站点地址、平台类型和签到入口</p>
        </div>
        <div className="page-header-actions">
          <RefreshButton onRefresh={load} refreshing={loading} />
          <button type="button" onClick={openCreate} className="btn btn-primary">
            添加站点
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
        {!isMobile && sites.length > 0 ? (
          <ColumnVisibilityControl
            columns={SITE_COLUMNS}
            visibleColumns={visibleColumns}
            onToggleColumn={toggleColumn}
            onShowAll={showAllColumns}
          />
        ) : null}
        {loading ? (
          <div style={{ display: "grid", gap: 10 }}>
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={`site-skeleton-${index}`} className="skeleton" style={{ height: 52 }} />
            ))}
          </div>
        ) : sites.length <= 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18" />
                <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" />
              </svg>
            </div>
            <div className="empty-state-title">还没有任何站点</div>
            <div className="empty-state-desc">先添加上游站点，再为它添加账户和 API Key。整个运维流程从这里开始。</div>
            <div className="empty-state-actions">
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                立即添加站点
              </button>
            </div>
          </div>
        ) : isMobile ? (
          <div className="mobile-card-list">
            {sites.map((site) => (
              <MobileCard
                key={site.id}
                title={(
                  <button
                    type="button"
                    onClick={() => openSiteAccounts(site.id)}
                    style={siteNameButtonStyle}
                  >
                    {site.name}
                  </button>
                )}
                headerActions={(
                  <span className={`badge ${statusBadgeClass(site.status)}`} style={{ fontSize: 11 }}>
                    {site.status === "disabled" ? "停用" : "可用"}
                  </span>
                )}
                footerActions={(
                  <RowActions
                    align="left"
                    inline={[{
                      key: "view",
                      label: "查看账号",
                      onClick: () => openSiteAccounts(site.id),
                    }]}
                    menu={[
                      { key: "add", label: "添加账户", onClick: () => openSiteAccountCreate(site.id) },
                      { key: "edit", label: "编辑", onClick: () => openEdit(site) },
                      {
                        key: "toggle",
                        label: site.status === "disabled" ? "启用" : "停用",
                        onClick: () => toggleSiteStatus(site),
                      },
                      { key: "delete", label: "删除", danger: true, onClick: () => void deleteSite(site) },
                    ]}
                  />
                )}
              >
                <MobileField label="平台" value={site.platform || "自动"} />
                <MobileField
                  label="主站地址"
                  stacked
                  value={renderSiteUrlLink(site.url)}
                />
                <MobileField
                  label="代理"
                  value={renderProxySummary(site)}
                />
                <MobileField
                  label="签到入口"
                  stacked
                  value={
                    site.externalCheckinUrl ? (
                      <span style={monoTextStyle}>{site.externalCheckinUrl}</span>
                    ) : "未设置"
                  }
                />
                <MobileField label="创建时间" value={formatDateTimeLocal(site.createdAt)} />
              </MobileCard>
            ))}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  {isColumnVisible("name") ? <th>名称</th> : null}
                  {isColumnVisible("platform") ? <th>平台</th> : null}
                  {isColumnVisible("url") ? <th>主站地址</th> : null}
                  {isColumnVisible("proxy") ? <th>代理</th> : null}
                  {isColumnVisible("checkin") ? <th>签到入口</th> : null}
                  {isColumnVisible("status") ? <th>状态</th> : null}
                  {isColumnVisible("createdAt") ? <th>创建时间</th> : null}
                  {isColumnVisible("actions") ? <th style={{ textAlign: "right" }}>操作</th> : null}
                </tr>
              </thead>
              <tbody>
                {sites.map((site) => (
                  <tr key={site.id}>
                    {isColumnVisible("name") ? (
                      <td style={{ fontWeight: 600 }}>
                        <button
                          type="button"
                          onClick={() => openSiteAccounts(site.id)}
                          style={siteNameButtonStyle}
                        >
                          {site.name}
                        </button>
                      </td>
                    ) : null}
                    {isColumnVisible("platform") ? (
                      <td>
                        <span className="badge badge-info">{site.platform || "自动"}</span>
                      </td>
                    ) : null}
                    {isColumnVisible("url") ? (
                      <td>
                        {renderSiteUrlLink(site.url)}
                      </td>
                    ) : null}
                    {isColumnVisible("proxy") ? (
                      <td>
                        {renderProxySummary(site)}
                      </td>
                    ) : null}
                    {isColumnVisible("checkin") ? (
                      <td>
                        {site.externalCheckinUrl ? (
                          <span style={monoTextStyle}>{site.externalCheckinUrl}</span>
                        ) : (
                          <span style={{ color: "var(--color-text-muted)" }}>未设置</span>
                        )}
                      </td>
                    ) : null}
                    {isColumnVisible("status") ? (
                      <td>
                        <span className={`badge ${statusBadgeClass(site.status)}`}>
                          {site.status === "disabled" ? "停用" : "可用"}
                        </span>
                      </td>
                    ) : null}
                    {isColumnVisible("createdAt") ? (
                      <td style={{ whiteSpace: "nowrap", color: "var(--color-text-muted)" }}>
                        {formatDateTimeLocal(site.createdAt)}
                      </td>
                    ) : null}
                    {isColumnVisible("actions") ? (
                      <td style={{ textAlign: "right" }}>
                        <RowActions
                          align="right"
                          inline={[{
                            key: "view",
                            label: "查看账号",
                            onClick: () => openSiteAccounts(site.id),
                          }]}
                          menu={[
                            { key: "add", label: "添加账户", onClick: () => openSiteAccountCreate(site.id) },
                            { key: "edit", label: "编辑", onClick: () => openEdit(site) },
                            {
                              key: "toggle",
                              label: site.status === "disabled" ? "启用" : "停用",
                              onClick: () => toggleSiteStatus(site),
                            },
                            { key: "delete", label: "删除", danger: true, onClick: () => void deleteSite(site) },
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
        open={editorOpen}
        onClose={closeEditor}
        title={editingSite ? "编辑站点" : "添加站点"}
        maxWidth={720}
        closeOnBackdrop
        closeOnEscape
        bodyStyle={{ display: "grid", gap: 14 }}
        footer={(
          <>
            <button type="button" className="btn btn-ghost" onClick={closeEditor}>
              取消
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void saveSite()} disabled={saving}>
              {saving ? "保存中..." : editingSite ? "保存修改" : "创建站点"}
            </button>
          </>
        )}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          <label>
            <div style={fieldLabelStyle}>站点名称</div>
            <input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="例如：My New API"
              style={inputStyle}
            />
          </label>
          <label>
            <div style={fieldLabelStyle}>平台类型</div>
            <select
              value={form.platform}
              onChange={(event) => setForm((current) => ({ ...current, platform: event.target.value }))}
              style={inputStyle}
            >
              {PLATFORM_OPTIONS.map((option) => (
                <option key={option.value || "auto"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label>
          <div style={fieldLabelStyle}>主站地址</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              value={form.url}
              onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))}
              placeholder="https://example.com"
              style={{ ...inputStyle, flex: "1 1 380px" }}
            />
            <button type="button" className="btn btn-ghost" onClick={() => void detectPlatform()} disabled={detecting}>
              {detecting ? "检测中..." : "检测平台"}
            </button>
          </div>
        </label>

        <label>
          <div style={fieldLabelStyle}>外部签到入口（可选）</div>
          <input
            value={form.externalCheckinUrl}
            onChange={(event) =>
              setForm((current) => ({ ...current, externalCheckinUrl: event.target.value }))
            }
            placeholder="https://example.com/checkin"
            style={inputStyle}
          />
        </label>

        <div style={{ display: "grid", gap: 10 }}>
          <div style={fieldLabelStyle}>访问代理</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {([
              ["none", "不使用"],
              ["system", "系统代理"],
              ["custom", "自定义"],
            ] as Array<[ProxyMode, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`btn ${form.proxyMode === value ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setForm((current) => ({ ...current, proxyMode: value }))}
              >
                {label}
              </button>
            ))}
          </div>
          {form.proxyMode === "custom" ? (
            <input
              value={form.proxyUrl}
              onChange={(event) => setForm((current) => ({ ...current, proxyUrl: event.target.value }))}
              placeholder="http://127.0.0.1:7890"
              style={inputStyle}
            />
          ) : null}
        </div>

        <div
          style={{
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--color-border)",
            background: "color-mix(in srgb, var(--color-info) 8%, var(--color-bg-card))",
            padding: 12,
            fontSize: 12,
            color: "var(--color-text-secondary)",
            lineHeight: 1.7,
          }}
        >
          平台类型可留空让系统自动识别。创建完成后会自动跳转到账户页，继续完成“添加该站点账户”。
        </div>
      </CenteredModal>
    </div>
  );
}
