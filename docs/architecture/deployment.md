# 部署方案

## 架构

采用**纯 Node.js 单镜像**方案：Express 同时托管前端 SPA 静态文件和后端 API/WebSocket，无需 Nginx。

```
Docker 容器 (:3001)
├── / 静态文件        → client/dist（Vite 产物）
├── /api/*           → REST API
└── /socket.io/*     → WebSocket
```

## CI/CD 流程

1. **push 到 main** → GitHub Actions 构建 Docker 镜像 → 推送到 GHCR（`ghcr.io`）
2. **服务器上** Watchtower 每 5 分钟检查镜像更新 → 自动拉取并重启容器

零人工干预，GitHub 零额外 Secrets（使用自带的 `GITHUB_TOKEN`）。

## Docker 多阶段构建

- **阶段 1（deps）**：`pnpm install --frozen-lockfile` 安装全部依赖
- **阶段 2（build）**：分别构建 shared、server（tsc）、client（vite build）
- **阶段 3（production）**：仅安装 server 生产依赖（`--filter @music-together/server...`），复制构建产物

## CORS 策略

- 生产环境未设置 `CLIENT_URL` / `CORS_ORIGINS` → 禁止跨域，仅允许浏览器同源请求
- 开发环境未设置白名单 → 允许本地跨域开发
- 前后端分离时必须显式配置精确 origin 白名单

## 反向代理来源地址

- 直接暴露应用端口时保持 `TRUST_PROXY_HOPS=0`，服务端不会信任客户端伪造的转发头
- 经本机 Nginx/1Panel 单层反向代理时通常设置 `TRUST_PROXY_HOPS=1`
- HTTP 登录限速和 Socket 房间密码限速共用相同的可信代理跳数
- 配置值必须等于实际可信代理层数，否则可能错误归并用户或信任伪造来源地址

## Session Cookie 策略

- 应用使用数据库可撤销会话，浏览器 Cookie 名为 `mt_session`
- 数据库仅保存会话 token 的 SHA-256 哈希
- 生产环境默认添加 `Secure`，因此默认必须使用 HTTPS
- 仅可信局域网 HTTP 调试可显式设置 `SESSION_COOKIE_SECURE=false`
- `SESSION_TTL_DAYS` 默认 30 天
- 退出、改密、管理员重置、禁用和删除账号会立即使对应会话失效

## 首次初始化与不兼容升级

新账号 schema 不兼容旧随机 ID 账号数据库。升级前必须停止服务并备份数据，然后显式执行：

```bash
docker compose run --rm music-together node packages/server/dist/cli/resetAccounts.js --confirm=RESET-ALL-APPLICATION-DATA
docker compose run --rm music-together node packages/server/dist/cli/initAdmin.js
```

- reset 会删除用户、永久房间、平台授权和头像
- 普通启动绝不会自动重置数据库
- 首个管理员只允许通过服务器本机交互命令创建
- 管理员存在后公开注册才会开放

## 房间密码密钥

- `ROOM_PASSWORD_KEY` 必须是 Base64 编码的 32 字节随机密钥，可通过 `openssl rand -base64 32` 生成
- 永久房间密码使用 AES-256-GCM 加密，丢失该密钥将无法恢复已保存密码
- `ROOM_PASSWORD_KEY_VERSION` 默认是 `1`，用于后续密钥轮换
- `ROOM_ADMISSION_TTL_MS` 默认 `300000`，即非房主验证密码后可在 5 分钟内安全重连
- `PLATFORM_AUTH_KEY` 必须使用另一个 Base64 32 字节密钥，用于加密持久化的音乐平台 Cookie
- `STREAM_PROXY_SECRET` 独立用于流代理签名，不得复用房间密码密钥

当前版本只加载一个 `ROOM_PASSWORD_KEY`，因此不得直接提高 key version 或替换密钥。正式密钥轮换需要先实现多版本解密和重加密流程。

## 前端同域适配

`SERVER_URL` 默认使用 `window.location.origin`，同域部署时自动指向当前页面的 origin，无需配置。

## 静态文件托管

`packages/server/src/index.ts` 在启动时检测 `client/dist/index.html` 是否存在：

- **存在**（生产环境）：挂载 `express.static` + SPA fallback
- **不存在**（本地开发）：跳过，零影响

## 服务器部署命令

```bash
# 推荐使用仓库 docker-compose.yml，并在 .env 中配置三个独立密钥后启动
docker compose up -d

# 启动 Watchtower 自动更新
docker run -d --name watchtower --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e WATCHTOWER_CLEANUP=true \
  containrrr/watchtower --interval 300 music-together
```

如使用 1Panel，创建反向代理网站指向 `127.0.0.1:3001`，启用 WebSocket 和 HTTPS。
