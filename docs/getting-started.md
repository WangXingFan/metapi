# 快速上手

## 1. 安装依赖

```bash
npm install
```

## 2. 准备环境变量

建议从 `.env.example` 复制并按需修改。Lite 模式至少需要关注：

```bash
AUTH_TOKEN=change-this-admin-token
ACCOUNT_CREDENTIAL_SECRET=change-this-encryption-secret
DATA_DIR=./data
PORT=4000
```

`AUTH_TOKEN` 用于登录管理后台。`ACCOUNT_CREDENTIAL_SECRET` 用于加密本地保存的账号凭据，生产环境不要使用默认值。

## 3. 初始化数据库

```bash
npm run db:migrate
```

默认使用 SQLite，数据目录由 `DATA_DIR` 控制。

## 4. 启动开发环境

```bash
npm run dev
```

访问：

```text
http://127.0.0.1:5173
```

## 5. 完成核心流程

1. 进入“站点”，添加中转站地址和平台类型。
2. 进入“账户”，选择站点后添加账户。
3. 进入“账号 Key”，同步或补全该账户的 Key。
4. 进入“签到”，执行签到并查看结果。
5. 进入“导入导出”，备份当前配置。

## 平台选择

站点平台可留空自动检测，也可以手动选择当前代码支持的平台，例如：

```text
new-api
one-api
anyrouter
one-hub
done-hub
sub2api
openai
claude
gemini
cliproxyapi
```

Lite 只负责账号与 Key 的管理，不提供下游代理转发入口。
