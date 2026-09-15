# 运维手册

## 备份

优先使用“导入导出”页面进行备份。备份内容覆盖 Lite 当前仍维护的核心数据，包括站点、账户、账号 Key、签到相关设置和部分历史兼容字段。

建议在以下操作前备份：

- 切换数据库
- 升级版本
- 批量导入数据
- 删除站点或账户

## 流光绘境账号与自动签到

在“站点”页面添加 `https://images.aihappy.indevs.in`，平台会自动识别为 `flowrealm`，也可手动选择“流光绘境（FlowRealm）”。其他 FlowRealm 实例可手动选择同一平台。

在“账户”页面选择该站点，通过账号密码登录，用户名填写站点绑定的邮箱。Metapi 会加密保存重登凭据，并启用该账户的签到；登录过期时沿用现有自动重登流程。导入 Session 的账户也可以签到、刷新余额，但不带密码时无法自动重登。

签到使用 Metapi 现有的调度和日志，签到后会自动刷新余额；账户页面也可手动“刷新余额”。无需安装额外的系统 cron。当前 Lite 界面的“账户 → 签到设置”使用每日 08:00 开始的错峰签到，新增账户会加入已有队列。调度采用服务端本地时区，需要中国时间时，将进程或容器的 `TZ` 设置为 `Asia/Shanghai`。

流光绘境的余额和签到奖励按站点“点数”原值记录，不按 New API 比例换算美元，也不会再次从可用余额中减去已用额度。当天重复签到不计入新增奖励。此适配器支持登录、Session 验证、签到、余额与模型列表；账号 Key 的同步、创建和删除暂未接入，可在站点管理密钥并手动导入 API Key。

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
