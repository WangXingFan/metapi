import React, { useEffect, useState } from "react";
import { api } from "../../api.js";
import CenteredModal from "../../components/CenteredModal.js";
import { useToast } from "../../components/Toast.js";
import { fieldLabelStyle, inputStyle } from "./shared.js";

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

export default function AccountCheckinSettingsDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [checkinSettingsLoading, setCheckinSettingsLoading] = useState(true);
  const [checkinSettingsSaving, setCheckinSettingsSaving] = useState(false);
  const [checkinSpreadIntervalMinutes, setCheckinSpreadIntervalMinutes] = useState(5);
  useEffect(() => {
    let active = true;
    setCheckinSettingsLoading(true);
    void api.getRuntimeSettings().then((settings) => {
      if (active) setCheckinSpreadIntervalMinutes(normalizeCheckinSpreadIntervalMinutes(settings?.checkinSpreadIntervalMinutes));
    }).catch((error: Error) => {
      if (active) toast.error(error.message || "加载签到设置失败");
    }).finally(() => {
      if (active) setCheckinSettingsLoading(false);
    });
    return () => { active = false; };
}, [toast]);

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
    onClose();
  } catch (error: any) {
    toast.error(error?.message || "保存签到设置失败");
  } finally {
    setCheckinSettingsSaving(false);
  }
};

return (
    <CenteredModal
      open
      onClose={onClose}
      title="签到设置"
      maxWidth={520}
      closeOnBackdrop
      closeOnEscape
      bodyStyle={{ display: "grid", gap: 14 }}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
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
  );
}
