# 部署指南

## 本地服务

```bash
npm run build
npm start
```

构建产物：

```text
dist/web
dist/server
dist/desktop
```

## Docker

仓库保留 Docker 配置：

```text
docker/Dockerfile
docker/docker-compose.yml
```

典型环境变量：

```bash
AUTH_TOKEN=change-this-admin-token
ACCOUNT_CREDENTIAL_SECRET=change-this-encryption-secret
DATA_DIR=/app/data
PORT=4000
```

确保 `DATA_DIR` 挂载到持久化卷。

## 桌面版

开发模式：

```bash
npm run dev:desktop
```

打包：

```bash
npm run package:desktop
```

桌面版会启动内置后端，并把数据和日志放在 Electron 的用户数据目录下。

## 反向代理

如果部署到服务器，只需要代理管理后台和 `/api/*`：

```nginx
location / {
  proxy_pass http://127.0.0.1:4000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

当前 Lite 不提供 `/v1/*` 下游代理入口，不需要为模型流量配置特殊超时。
