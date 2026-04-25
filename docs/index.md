# Metapi Lite

Metapi Lite 是一个精简的中转站账号运维控制台。当前版本不再提供统一代理网关和智能路由，只保留站点、账户、账号 Key、签到、导入导出五个核心入口。

## 当前保留能力

- 维护上游站点基础信息
- 添加 Session 账户或 API Key 连接
- 同步、补全、复制账号 Key
- 执行签到并查看签到日志
- 导入导出数据，支持 WebDAV 同步

## 当前入口

```text
/sites          站点
/accounts       账户
/keys           账号 Key
/checkin        签到
/import-export  导入导出
```

## 已移除能力

以下旧版能力不属于当前 Lite 运行面：

- `/v1/*` 统一代理入口
- 智能路由和通道权重页面
- 模型广场和模型测试器
- OAuth 管理页面
- 下游 API Key 管理
- 代理日志、监控、通知设置、更新中心

如果以后重新启用这些能力，应按新需求重新设计入口、路由和文档，不要恢复旧页面作为默认行为。

## 下一步

- [快速上手](./getting-started.md)
- [配置说明](./configuration.md)
- [部署指南](./deployment.md)
- [运维手册](./operations.md)
- [管理 API](./management-api.md)
