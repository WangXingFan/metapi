# 运维手册

## 备份

优先使用“导入导出”页面进行备份。备份内容覆盖 Lite 当前仍维护的核心数据，包括站点、账户、账号 Key、签到相关设置和部分历史兼容字段。

建议在以下操作前备份：

- 切换数据库
- 升级版本
- 批量导入数据
- 删除站点或账户

## 日志

本地开发和服务器部署的日志跟随进程输出。桌面版日志位于 Electron 用户数据目录下的 `logs`。

## 数据目录

默认：

```text
./data
```

生产部署应挂载持久化卷。不要在未备份时删除 `data/hub.db` 或 SQLite WAL/SHM 文件。

## 常用检查

```bash
npm run typecheck
npm run build
npm test
```

数据库检查：

```bash
npm run test:schema:unit
npm run smoke:db:sqlite
```

## 清理建议

可以清理的本地产物：

```text
dist/
node_modules/
.codex-run/
.playwright-mcp/
tmp/*
```

不要清理：

```text
data/
drizzle/
src/server/db/generated/
```
