import React, { useEffect, useState } from "react";
import { api } from "../../api.js";
import CenteredModal from "../../components/CenteredModal.js";
import { useToast } from "../../components/Toast.js";
import { copyText, fieldLabelStyle, maskSecret, monoTextStyle } from "./shared.js";

type CredentialAccount = {
  id: number; username?: string | null; credentialMode?: string;
  accessToken?: string | null; apiToken?: string | null; platformUserId?: number | null;
  site?: { name: string } | null;
};
function resolveAccountName(account: CredentialAccount) {
  return account.username?.trim() || (account.credentialMode === "apikey" ? "API Key 连接" : `账号 #${account.id}`);
}
type CredentialField = {
  key: string;
  label: string;
  value: string;
  sensitive?: boolean;
};

function buildCredentialFields(account: CredentialAccount): CredentialField[] {
  const fields: CredentialField[] = [
    {
      key: "account-id",
      label: "Metapi 账户 ID",
      value: String(account.id),
    },
    {
      key: "platform-user-id",
      label: "平台用户 ID",
      value: String(account.platformUserId || ""),
    },
    {
      key: "access-token",
      label: "Access Token / Session",
      value: String(account.accessToken || "").trim(),
      sensitive: true,
    },
  ];

  const apiToken = String(account.apiToken || "").trim();
  if (apiToken) {
    fields.push({
      key: "api-token",
      label: "API Key",
      value: apiToken,
      sensitive: true,
    });
  }

  return fields;
}


export default function AccountCredentialsDialog({ account, onClose }: { account: CredentialAccount; onClose: () => void }) {
  const toast = useToast();
  const [credentialAccount, setLoadedAccount] = useState<CredentialAccount>({ ...account, accessToken: null, apiToken: null });
  const [credentialsRevealed, setCredentialsRevealed] = useState(false);
  const [credentialsLoading, setCredentialsLoading] = useState(true);
  const [credentialsError, setCredentialsError] = useState("");
  const credentialAccountId = account.id;

  useEffect(() => {
    if (!credentialAccountId) return;
    let active = true;
    setCredentialsLoading(true);
    setCredentialsError("");
    void api.getAccountCredentials(credentialAccountId).then((credentials) => {
      if (active) setLoadedAccount((current) => current?.id === credentialAccountId ? { ...current, ...credentials } : current);
    }).catch((error: any) => {
      if (active) setCredentialsError(error?.message || "读取账户凭据失败");
    }).finally(() => {
      if (active) setCredentialsLoading(false);
    });
    return () => { active = false; };
  }, [credentialAccountId]);

  const copyCredential = async (label: string, value: string) => {
const trimmed = value.trim();
if (!trimmed) {
  toast.info(`${label} 为空`);
  return;
}
try {
  await copyText(trimmed);
  toast.success(`已复制 ${label}`);
} catch (error: any) {
  toast.error(error?.message || "复制失败");
}
  };

  return (
    <CenteredModal
      open
      onClose={onClose}
      title="查看凭据"
      maxWidth={680}
      closeOnBackdrop
      closeOnEscape
      bodyStyle={{ display: "grid", gap: 14 }}
      footer={(
        <>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setCredentialsRevealed((current) => !current)}
            disabled={credentialsLoading || !!credentialsError}
          >
            {credentialsRevealed ? "隐藏完整凭据" : "显示完整凭据"}
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            关闭
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
          <div style={{ fontWeight: 700 }}>{resolveAccountName(credentialAccount)}</div>
          <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            {credentialAccount.site?.name || "-"}
          </div>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {credentialsLoading ? <div role="status">正在读取数据库中的凭据...</div> : credentialsError ? (
            <div className="alert alert-warning" role="alert">{credentialsError}</div>
          ) : buildCredentialFields(credentialAccount).map((field) => {
            const hasValue = field.value.trim().length > 0;
            const displayValue = !hasValue
              ? "-"
              : field.sensitive && !credentialsRevealed
                ? maskSecret(field.value)
                : field.value;
            return (
              <div
                key={field.key}
                style={{
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-sm)",
                  padding: 12,
                  display: "grid",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <div style={fieldLabelStyle}>{field.label}</div>
                  <button
                    type="button"
                    className="btn btn-link"
                    onClick={() => void copyCredential(field.label, field.value)}
                    disabled={!hasValue}
                  >
                    复制
                  </button>
                </div>
                <div
                  style={{
                    ...monoTextStyle,
                    borderRadius: "var(--radius-sm)",
                    background: "var(--color-bg)",
                    border: "1px solid var(--color-border)",
                    padding: "10px 12px",
                    minHeight: 38,
                  }}
                >
                  {displayValue}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </CenteredModal>
  );
}
