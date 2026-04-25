# Metapi Lite

Metapi Lite 是一个面向中转站账号运维的精简控制台。当前版本只保留最短管理链路：

- 站点管理：维护上游站点地址、平台类型和外部签到入口
- 账户管理：通过站点登录或直接导入 Session / API Key 添加账户
- 账号 Key：同步、补全、复制站点账号 Key
- 签到：执行单账号或批量签到，并查看签到日志
- 导入导出：本地导入导出与 WebDAV 同步

旧版的统一 `/v1/*` 代理网关、智能路由页面、模型广场、OAuth 管理、监控、代理日志和模型测试器已经从当前运行入口中移除。

## 快速开始

```bash
npm install
npm run db:migrate
npm run dev
```

默认管理后台地址：

```text
http://127.0.0.1:5173
```

服务端默认监听：

```text
http://127.0.0.1:4000
```

首次使用请至少设置：

```bash
AUTH_TOKEN=change-this-admin-token
ACCOUNT_CREDENTIAL_SECRET=change-this-encryption-secret
DATA_DIR=./data
```

## 构建与运行

```bash
npm run build
npm start
```

桌面版：

```bash
npm run dev:desktop
npm run package:desktop
```

Docker 仍使用仓库内的 `docker/Dockerfile` 和 `docker/docker-compose.yml`。

## 当前导航

```text
/sites          站点
/accounts       账户
/keys           账号 Key
/checkin        签到
/import-export  导入导出
```

兼容重定向：

```text
/tokens -> /keys
/settings/import-export -> /import-export
```

## 开发命令

```bash
npm run typecheck
npm test
npm run build:web
npm run build:server
npm run build:desktop
```

数据库变更仍需同步 Drizzle schema、迁移和生成产物。

## 文档

本仓库只保留 Lite 版文档。入口在 `docs/`：

- `docs/getting-started.md`
- `docs/configuration.md`
- `docs/deployment.md`
- `docs/operations.md`
- `docs/management-api.md`
- `docs/faq.md`

本地预览：

```bash
npm run docs:dev
```
