# 配置说明

## 必填或强烈建议修改

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `AUTH_TOKEN` | 管理后台登录令牌 | `change-me-admin-token` |
| `ACCOUNT_CREDENTIAL_SECRET` | 账号凭据加密密钥 | 回退到 `AUTH_TOKEN` |
| `DATA_DIR` | SQLite、导出文件等运行数据目录 | `./data` |
| `PORT` | 服务端监听端口 | `4000` |
| `HOST` | 服务端监听地址 | `0.0.0.0` |

## 数据库

| 变量 | 说明 |
| --- | --- |
| `DB_TYPE` | `sqlite`、`mysql` 或 `postgres` |
| `DB_URL` | 数据库连接字符串；SQLite 可留空使用默认数据目录 |
| `DB_SSL` | Postgres/MySQL 是否启用 SSL |

变更数据库配置后应先备份，再执行迁移。

## 签到

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `CHECKIN_CRON` | cron 模式签到时间 | `0 8 * * *` |
| `CHECKIN_SCHEDULE_MODE` | `cron`、`interval` 或 `spread` | `spread` |
| `CHECKIN_INTERVAL_HOURS` | interval 模式间隔小时 | `6` |
| `CHECKIN_SPREAD_INTERVAL_MINUTES` | spread 模式单账号间隔分钟 | `5` |

Lite 的“账户”页提供一个简化签到设置入口：每天 08:00 开始，按间隔逐个签到。

## 通知与代理相关变量

服务端仍保留部分历史运行配置，例如通知、系统代理、模型探测等。当前 Lite UI 不再提供完整设置页；如果需要使用这些能力，应通过环境变量或恢复对应管理入口后再启用。

## 不再作为当前功能面的配置

以下配置属于旧版代理、路由或 OAuth 功能面。当前 Lite 默认不暴露相关页面或入口：

```text
PROXY_TOKEN
TOKEN_ROUTER_CACHE_TTL_MS
PROXY_* routing/log/debug settings
CODEX_* / CLAUDE_* / GEMINI_CLI_* OAuth client settings
```

保留这些变量不会自动恢复旧功能。
