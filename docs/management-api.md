# 管理 API

管理 API 使用 `AUTH_TOKEN`：

```http
Authorization: Bearer <AUTH_TOKEN>
```

## 站点

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/sites` | 列出站点 |
| `POST` | `/api/sites` | 创建站点 |
| `PUT` | `/api/sites/:id` | 更新站点 |
| `DELETE` | `/api/sites/:id` | 删除站点 |
| `POST` | `/api/sites/detect` | 检测平台类型 |

## 账户

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/accounts` | 获取账户快照 |
| `POST` | `/api/accounts/login` | 通过站点登录添加账户 |
| `POST` | `/api/accounts` | 直接导入凭据 |
| `PUT` | `/api/accounts/:id` | 更新账户 |
| `DELETE` | `/api/accounts/:id` | 删除账户 |

## 账号 Key

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/account-tokens` | 列出账号 Key |
| `PUT` | `/api/account-tokens/:id` | 更新 Key |
| `GET` | `/api/account-tokens/:id/value` | 读取完整 Key |
| `POST` | `/api/account-tokens/:id/default` | 设置默认 Key |
| `POST` | `/api/account-tokens/sync/:accountId` | 同步账户 Key |

## 签到

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/checkin/trigger` | 批量签到 |
| `POST` | `/api/checkin/trigger/:id` | 单账号签到 |
| `GET` | `/api/checkin/logs` | 签到日志 |
| `PUT` | `/api/checkin/schedule` | 更新签到计划 |

## 设置与备份

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/settings/auth/info` | 校验管理令牌 |
| `GET` | `/api/settings/runtime` | 读取运行设置 |
| `PUT` | `/api/settings/runtime` | 更新运行设置 |
| `GET` | `/api/settings/backup/export` | 导出备份 |
| `POST` | `/api/settings/backup/import` | 导入备份 |
| `GET` | `/api/settings/backup/webdav` | 读取 WebDAV 配置 |
| `PUT` | `/api/settings/backup/webdav` | 保存 WebDAV 配置 |
| `POST` | `/api/settings/backup/webdav/export` | 导出到 WebDAV |
| `POST` | `/api/settings/backup/webdav/import` | 从 WebDAV 导入 |
