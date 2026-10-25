import React, { useEffect, useState } from 'react';
import { api } from '../../api.js';
import CenteredModal from '../../components/CenteredModal.js';
import { useToast } from '../../components/Toast.js';
import { fieldLabelStyle, inputStyle, monoTextStyle } from './shared.js';

type Token = {
  id: number;
  accountId: number;
  name?: string | null;
  tokenGroup?: string | null;
  tokenMasked?: string | null;
  valueStatus?: string | null;
};

type Props = {
  mode: 'create' | 'edit' | 'complete';
  token?: Token;
  accounts: Array<{ id: number; label: string }>;
  initialAccountId?: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
};

export default function AccountTokenDialog({ mode, token, accounts, initialAccountId, onClose, onSaved }: Props) {
  const toast = useToast();
  const [accountId, setAccountId] = useState(token?.accountId || initialAccountId || accounts[0]?.id || 0);
  const [name, setName] = useState(token?.name || '');
  const [group, setGroup] = useState(token?.tokenGroup || '');
  const [tokenValue, setTokenValue] = useState('');
  const [groups, setGroups] = useState<string[]>([]);
  const [capabilities, setCapabilities] = useState({ create: false, update: false });
  const [loadingGroups, setLoadingGroups] = useState(mode !== 'complete');
  const [groupError, setGroupError] = useState('');
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const completing = mode === 'complete';

  useEffect(() => {
    if (completing || !accountId) return;
    let active = true;
    setLoadingGroups(true);
    setGroupError('');
    setGroups([]);
    setCapabilities({ create: false, update: false });
    void api.getAccountTokenGroups(accountId).then((result) => {
      if (!active) return;
      const available: string[] = Array.isArray(result?.groups)
        ? result.groups.filter((value: unknown): value is string => typeof value === 'string' && !!value.trim())
        : [];
      setGroups(available);
      setCapabilities(result?.capabilities || { create: false, update: false });
      if (mode === 'create') setGroup((current) => available.includes(current)
        ? current : available.includes('default') ? 'default' : available[0] || '');
    }).catch((error: any) => {
      if (active) setGroupError(error?.message || '加载上游分组失败');
    }).finally(() => {
      if (active) setLoadingGroups(false);
    });
    return () => { active = false; };
  }, [accountId, completing, mode, reload]);

  const canManage = completing || (mode === 'create' ? capabilities.create : capabilities.update);
  const save = async () => {
    if (saving || (!completing && (loadingGroups || !canManage))) return;
    const fullKey = tokenValue.trim();
    if (completing && !fullKey) return toast.error('请粘贴完整明文 key');
    if (fullKey && /[*•]/.test(fullKey)) return toast.error('请填写完整 key，不能使用脱敏值');
    if (!completing && !name.trim()) return toast.error('请填写 Key 名称');
    if (!completing && !group.trim()) return toast.error('请选择上游分组');
    setSaving(true);
    try {
      if (mode === 'create') {
        const result = await api.addAccountToken({ accountId, name: name.trim(), group: group.trim() });
        toast.success(result?.maskedPending > 0
          ? '已在上游创建 Key；上游未提供完整值，请补全后使用'
          : '已在上游创建并保存完整 Key');
      } else if (token) {
        await api.updateAccountToken(token.id, completing
          ? { token: fullKey, enabled: true }
          : { name: name.trim(), group: group.trim(), syncUpstream: true, ...(fullKey ? { token: fullKey } : {}) });
        toast.success(completing ? '完整 key 已保存' : 'Key 名称和分组已同步更新到上游');
      }
      await onSaved();
      onClose();
    } catch (error: any) {
      toast.error(error?.message || '保存 Key 失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <CenteredModal
      open
      title={mode === 'create' ? '新建账号 Key' : completing ? '补全完整 key' : '编辑账号 Key'}
      onClose={() => { if (!saving) onClose(); }}
      showCloseButton={!saving}
      maxWidth={520}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>取消</button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving || loadingGroups || !canManage}>
            {saving ? '保存中...' : mode === 'create' ? '在上游创建' : completing ? '保存完整 key' : '保存并同步上游'}
          </button>
        </>
      )}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        {mode === 'create' ? (
          <label>
            <div style={fieldLabelStyle}>所属账户</div>
            <select aria-label="所属账户" value={accountId} onChange={(event) => { setAccountId(Number(event.target.value)); setGroup(''); }} style={inputStyle} disabled={saving}>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
            </select>
          </label>
        ) : (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
            {accounts.find((account) => account.id === accountId)?.label}
            <div style={{ ...monoTextStyle, marginTop: 6 }}>{token?.tokenMasked || '-'}</div>
          </div>
        )}
        {!completing ? (
          <>
            <label>
              <div style={fieldLabelStyle}>Key 名称</div>
              <input aria-label="Key 名称" value={name} onChange={(event) => setName(event.target.value)} style={inputStyle} disabled={saving} autoFocus />
            </label>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <label htmlFor="account-key-group" style={fieldLabelStyle}>分组</label>
                <button type="button" className="btn btn-link" onClick={() => setReload((value) => value + 1)} disabled={saving || loadingGroups}>
                  {loadingGroups ? '加载中...' : '刷新分组'}
                </button>
              </div>
              <select id="account-key-group" aria-label="分组" value={group} onChange={(event) => setGroup(event.target.value)} style={inputStyle} disabled={saving || loadingGroups}>
                <option value="" disabled>{loadingGroups ? '正在加载上游分组...' : '请选择上游分组'}</option>
                {Array.from(new Set([...groups, token?.tokenGroup || ''])).filter(Boolean).map((item) => (
                  <option key={item} value={item}>{item}{!groups.includes(item) ? '（当前分组，上游未返回）' : ''}</option>
                ))}
              </select>
              {!loadingGroups && !groupError && groups.length === 0 ? (
                <div className="alert alert-warning" style={{ marginTop: 8 }}>上游未返回可用分组，请刷新或检查账户会话。</div>
              ) : null}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
              {mode === 'create' ? '将在上游网站创建 Key，并自动读取和保存完整值。' : '名称和分组会同时更新到上游网站。'}
            </div>
            {groupError ? (
              <div className="alert alert-warning">
                {groupError}
                <button type="button" className="btn btn-link" onClick={() => setReload((value) => value + 1)}>重试</button>
              </div>
            ) : !loadingGroups && !canManage ? (
              <div className="alert alert-warning">该平台暂不支持{mode === 'create' ? '新建' : '修改'}上游 Key，请在上游网站操作后同步。</div>
            ) : null}
          </>
        ) : (
          <div className="alert alert-warning">上游未提供完整 Key，请从上游网站复制完整值后粘贴到这里。</div>
        )}
        {mode !== 'create' ? (
          <label>
            <div style={fieldLabelStyle}>{completing ? '完整明文 key' : '完整 Key（可选）'}</div>
            <input aria-label="完整明文 key" type="password" value={tokenValue} onChange={(event) => setTokenValue(event.target.value)} placeholder={completing ? '粘贴完整 key，例如 sk-...' : '留空保留现有 Key'} style={inputStyle} autoComplete="off" disabled={saving} autoFocus={completing} />
            {!completing ? <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginTop: 6 }}>此项用于更新本地保存的完整值。重新生成 Key 请在上游网站操作。</div> : null}
          </label>
        ) : null}
      </div>
    </CenteredModal>
  );
}
