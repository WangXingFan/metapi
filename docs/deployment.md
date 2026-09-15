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

### 构建镜像与更新服务器

在 GitHub 仓库的 **Actions → Docker Image → Run workflow** 选择 `main`，即可单独构建服务端镜像。版本发布也复用这个流程。流程发布 amd64、arm64、arm/v7 镜像到 `ghcr.io/wangxingfan/metapi`，提供 `latest` 和 `sha-<完整提交哈希>` 标签；配置了 Docker Hub 凭据时也会同步发布。

等待 **Publish Docker Manifests** 成功后，在服务器原有 Compose 目录更新。例如使用根目录 `docker-compose.yml` 和 GHCR 镜像的部署：

```bash
cd /root/metapi
docker compose -f docker-compose.yml pull metapi
docker compose -f docker-compose.yml up -d --no-build metapi
docker compose -f docker-compose.yml logs --tail=50 metapi
```

沿用原有 Compose 文件、环境变量和数据卷。发布镜像后无需在服务器编译源码；账户凭据仍通过管理页面添加。

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
