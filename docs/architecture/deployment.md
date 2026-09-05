# 部署方案

## 架构

采用**纯 Node.js 单镜像**方案：Express 同时托管前端 SPA 静态文件和后端 API/WebSocket，无需 Nginx。

```
Docker 容器 (:3001)
├── / 静态文件        → client/dist（Vite 产物）
├── /api/*           → REST API
└── /socket.io/*     → WebSocket
```

## 部署流程

1. **服务器同步源码** → 在目标主机执行 `git pull`
2. **服务器本地构建** → `docker compose up -d --build`，Docker 按目标主机架构构建并启动服务

应用镜像不依赖 GHCR 或 GitHub Actions；更新由服务器上的源码和本地 Docker 构建完成。

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
- 经本机 Nginx/1Panel 单层反向代理时通常设置 `TRUST_PROXY_HOPS=1`，并设置 `BIND_ADDRESS=127.0.0.1`
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
docker compose stop music-together
docker compose run --rm --build music-together node packages/server/dist/cli/resetAccounts.js --confirm=RESET-ALL-APPLICATION-DATA
docker compose up -d --build
```

- reset 会删除用户、永久房间、平台授权和头像
- 普通启动绝不会自动重置数据库
- 重启后使用一次性账号 `admin/admin` 登录，并按界面要求立即修改用户名和密码
- 完成管理员凭据更新后公开注册才会开放

## 房间密码密钥

- `ROOM_PASSWORD_KEY` 必须是 Base64 编码的 32 字节随机密钥，可通过 `openssl rand -base64 32` 生成
- 永久房间密码使用 AES-256-GCM 加密，丢失该密钥将无法恢复已保存密码
- `ROOM_PASSWORD_KEY_VERSION` 默认是 `1`，用于后续密钥轮换
- `ROOM_ADMISSION_TTL_MS` 默认 `300000`，即非房主验证密码后可在 5 分钟内安全重连
- `PLATFORM_AUTH_KEY` 必须使用另一个 Base64 32 字节密钥，用于加密持久化的音乐平台 Cookie
- `STREAM_PROXY_SECRET` 独立用于流代理签名，不得复用房间密码密钥

当前版本只加载一个 `ROOM_PASSWORD_KEY`，因此不得直接提高 key version 或替换密钥。正式密钥轮换需要先实现多版本解密和重加密流程。

## 全局媒体默认值

- `UNM_SERVER_URL` 是所有房间的默认 UNM 地址；房间未设置专属地址时自动使用该环境值
- `YOUTUBE_COOKIE` 和 `BILIBILI_COOKIE` 是所有房间的默认视频 Cookie
- 房主在界面保存的房间 Cookie 优先于环境默认值；删除房间覆盖后会恢复使用环境值
- 新建房间和未配置覆盖的现有房间都会动态使用当前环境默认值；修改环境变量后需重启服务
- Cookie 可使用浏览器复制的 `Cookie:` 请求头内容或 Netscape cookies.txt 内容，服务端会在使用前规范化
- Cookie 属于敏感凭据，不应提交到 Git、日志或截图；生产环境优先通过部署平台的 Secret 功能注入
- Docker Compose 从 `.env` 读取值时会处理 `$` 插值，Cookie 中的字面 `$` 应写成 `$$`

## 前端同域适配

`SERVER_URL` 默认使用 `window.location.origin`，同域部署时自动指向当前页面的 origin，无需配置。

## 静态文件托管

`packages/server/src/index.ts` 在启动时检测 `client/dist/index.html` 是否存在：

- **存在**（生产环境）：挂载 `express.static` + SPA fallback
- **不存在**（本地开发）：跳过，零影响

## yt-dlp 版本管理

生产镜像在构建阶段安装 `yt-dlp`。默认使用构建时 PyPI 的最新版；需要可复现版本时，在 `.env` 中设置精确版本：

```bash
YTDLP_VERSION=2025.08.11 docker compose up -d --build
```

如果需要容器启动时自动从 PyPI 更新镜像内置版本，可设置 `YTDLP_AUTO_UPDATE=true`。默认关闭以避免启动依赖外部网络；也可以用 `YTDLP_UPDATE_VERSION` 固定启动更新目标版本。自动更新只作用于镜像内置的 `/usr/local/bin/yt-dlp`，不会覆盖自定义路径。

需要手动替换且跨容器重建保留时，将可执行文件放入数据卷并设置：

```bash
docker exec music-together mkdir -p /app/data/bin
docker cp ./yt-dlp music-together:/app/data/bin/yt-dlp
docker exec music-together chmod 755 /app/data/bin/yt-dlp
# 在 .env 中设置：YTDLP_PATH=/app/data/bin/yt-dlp
docker compose up -d
```

`/app/data` 属于持久化卷；手动版本不会因镜像重建丢失。更换文件后重启服务即可，`YTDLP_AUTO_UPDATE` 对该自定义路径会自动跳过。

## 服务器部署命令

```bash
# 推荐使用仓库 docker-compose.yml，并在 .env 中配置三个独立密钥后本地构建启动
docker compose up -d --build
```

如使用 1Panel，创建反向代理网站指向 `127.0.0.1:3001`，启用 WebSocket 和 HTTPS。
