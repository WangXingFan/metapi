import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import CenteredModal from "../components/CenteredModal.js";
import { MobileCard, MobileField } from "../components/MobileCard.js";
import { useIsMobile } from "../components/useIsMobile.js";
import { useToast } from "../components/Toast.js";
import { formatDateTimeLocal } from "./helpers/checkinLogTime.js";
import { fieldLabelStyle, inputStyle, monoTextStyle } from "./lite/shared.js";

type SiteItem = {
  id: number;
  name: string;
  url: string;
  platform?: string | null;
  status?: string | null;
  externalCheckinUrl?: string | null;
  createdAt?: string | null;
};

type SiteForm = {
  name: string;
  url: string;
  platform: string;
  externalCheckinUrl: string;
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
  };
}

function statusBadgeClass(status?: string | null): string {
  return status === "disabled" ? "badge-muted" : "badge-success";
}

export default function LiteSites() {
  const toast = useToast();
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

  const sortedSites = useMemo(
    () =>
      [...sites].sort((left, right) =>
        String(left.name || "").localeCompare(String(right.name || "")),
      ),
    [sites],
  );

  const summary = useMemo(() => {
    const enabled = sortedSites.filter((site) => site.status !== "disabled").length;
    const withCheckin = sortedSites.filter((site) => site.externalCheckinUrl).length;
    return {
      total: sortedSites.length,
      enabled,
      disabled: sortedSites.length - enabled,
      withCheckin,
    };
  }, [sortedSites]);

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
    };

    setSaving(true);
    try {
      if (editingSite) {
        await api.updateSite(editingSite.id, payload);
        toast.success("站点已更新");
      } else {
        const created = await api.addSite(payload);
        toast.success("站点已添加");
        if (created?.id) {
          navigate(`/accounts?siteId=${created.id}&create=1`);
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
    const confirmed =
      typeof window === "undefined" || typeof window.confirm !== "function"
        ? true
        : window.confirm(`确定删除站点“${site.name}”吗？`);
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

  const summaryCards = [
    { label: "站点总数", value: summary.total },
    { label: "可用站点", value: summary.enabled },
    { label: "停用站点", value: summary.disabled },
    { label: "已配置签到入口", value: summary.withCheckin },
  ];

  return (
    <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="page-header">
        <div>
          <h2 className="page-title">站点</h2>
          <div style={{ fontSize: 13, color: "var(--color-text-muted)", marginTop: 6 }}>
            这里只保留站点的基础信息维护，创建后可直接进入账户添加流程。
          </div>
        </div>
        <button type="button" onClick={openCreate} className="btn btn-primary">
          添加站点
        </button>
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
            <strong style={{ fontSize: 24, lineHeight: 1 }}>{item.value}</strong>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: 16 }}>
        {loading ? (
          <div style={{ display: "grid", gap: 10 }}>
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={`site-skeleton-${index}`} className="skeleton" style={{ height: 52 }} />
            ))}
          </div>
        ) : sortedSites.length <= 0 ? (
          <div className="empty-state" style={{ padding: 28 }}>
            <div className="empty-state-title">暂无站点</div>
            <div className="empty-state-desc">先添加站点，再添加该站点的账户。</div>
          </div>
        ) : isMobile ? (
          <div className="mobile-card-list">
            {sortedSites.map((site) => (
              <MobileCard
                key={site.id}
                title={site.name}
                headerActions={(
                  <span className={`badge ${statusBadgeClass(site.status)}`} style={{ fontSize: 11 }}>
                    {site.status === "disabled" ? "停用" : "可用"}
                  </span>
                )}
                footerActions={(
                  <>
                    <button type="button" className="btn btn-link" onClick={() => navigate(`/accounts?siteId=${site.id}&create=1`)}>
                      添加账户
                    </button>
                    <button type="button" className="btn btn-link" onClick={() => openEdit(site)}>
                      编辑
                    </button>
                    <button type="button" className="btn btn-link" onClick={() => toggleSiteStatus(site)}>
                      {site.status === "disabled" ? "启用" : "停用"}
                    </button>
                    <button type="button" className="btn btn-link btn-link-danger" onClick={() => void deleteSite(site)}>
                      删除
                    </button>
                  </>
                )}
              >
                <MobileField label="平台" value={site.platform || "自动"} />
                <MobileField
                  label="主站地址"
                  stacked
                  value={<span style={monoTextStyle}>{site.url}</span>}
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
                  <th>名称</th>
                  <th>平台</th>
                  <th>主站地址</th>
                  <th>签到入口</th>
                  <th>状态</th>
                  <th>创建时间</th>
                  <th style={{ textAlign: "right" }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {sortedSites.map((site) => (
                  <tr key={site.id}>
                    <td style={{ fontWeight: 600 }}>{site.name}</td>
                    <td>
                      <span className="badge badge-info">{site.platform || "自动"}</span>
                    </td>
                    <td>
                      <span style={monoTextStyle}>{site.url}</span>
                    </td>
                    <td>
                      {site.externalCheckinUrl ? (
                        <span style={monoTextStyle}>{site.externalCheckinUrl}</span>
                      ) : (
                        <span style={{ color: "var(--color-text-muted)" }}>未设置</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${statusBadgeClass(site.status)}`}>
                        {site.status === "disabled" ? "停用" : "可用"}
                      </span>
                    </td>
                    <td style={{ whiteSpace: "nowrap", color: "var(--color-text-muted)" }}>
                      {formatDateTimeLocal(site.createdAt)}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                        <button type="button" className="btn btn-link" onClick={() => navigate(`/accounts?siteId=${site.id}&create=1`)}>
                          添加账户
                        </button>
                        <button type="button" className="btn btn-link" onClick={() => openEdit(site)}>
                          编辑
                        </button>
                        <button type="button" className="btn btn-link" onClick={() => toggleSiteStatus(site)}>
                          {site.status === "disabled" ? "启用" : "停用"}
                        </button>
                        <button type="button" className="btn btn-link btn-link-danger" onClick={() => void deleteSite(site)}>
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
