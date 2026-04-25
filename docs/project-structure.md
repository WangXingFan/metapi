# 项目结构

```text
src/
  web/                 # Lite 前端
    App.tsx            # 当前路由装配
    pages/             # Lite 页面
    components/        # 当前页面共享组件
  server/              # Fastify 服务端
    index.ts           # 服务入口与路由注册
    routes/api/        # 当前管理 API
    routes/proxy/      # 仅保留 runtimeExecutor 兼容模块
    services/          # 业务服务
    db/                # Drizzle schema、迁移、运行时兼容
    proxy-core/        # 当前仍被账号/模型运行链路引用的核心模块
  desktop/             # Electron 外壳
  shared/              # 前后端共享的轻量合约
```

## 当前前端页面

```text
src/web/pages/LiteSites.tsx
src/web/pages/LiteAccounts.tsx
src/web/pages/LiteKeys.tsx
src/web/pages/CheckinLog.tsx
src/web/pages/ImportExport.tsx
```

## 当前服务端路由

主入口注册：

```text
src/server/desktop.ts
src/server/routes/api/sites.ts
src/server/routes/api/accounts.ts
src/server/routes/api/checkin.ts
src/server/routes/api/auth.ts
src/server/routes/api/accountTokens.ts
src/server/routes/api/settings.ts
```

旧版未注册路由不应再新增文档入口。

## 不要随意删除

```text
drizzle/
src/server/db/
src/server/db/generated/
data/
```

这些属于 schema、迁移和运行数据边界。
