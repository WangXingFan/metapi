# 文档维护

当前文档只覆盖 Metapi Lite。

## 保留页面

- `index.md`
- `getting-started.md`
- `configuration.md`
- `deployment.md`
- `operations.md`
- `management-api.md`
- `faq.md`
- `project-structure.md`

## 维护原则

- 不再描述旧版 `/v1/*` 代理、智能路由、OAuth、模型广场、监控、代理日志等已移除功能。
- 新增功能必须先确认当前 UI 和服务端路由真实存在，再更新文档。
- 文档静态资源放在 `docs/public/`；不要重新提交临时截图或草稿图。

## 本地检查

```bash
npm run docs:build
```
