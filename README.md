<p align="center">
  <img alt="Music Together" src="public/logo.svg" width="80">
</p>

<h1 align="center">Music Together Pro</h1>

<p align="center">
  在线多人同步听歌平台 -- 创建房间，邀请朋友，一起实时听同一首歌。支持 UNM 服务器
</p>

<p align="center">
  <a href="README.en.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/ChEnLeo-7/Music-Together-unm-support/stargazers"><img src="https://img.shields.io/github/stars/ChEnLeo-7/Music-Together-unm-support?style=flat&logo=github" alt="Stars"></a>
  <a href="https://github.com/ChEnLeo-7/Music-Together-unm-support/network/members"><img src="https://img.shields.io/github/forks/ChEnLeo-7/Music-Together-unm-support?style=flat&logo=github" alt="Forks"></a>
  <a href="https://github.com/ChEnLeo-7/Music-Together-unm-support/issues"><img src="https://img.shields.io/github/issues/ChEnLeo-7/Music-Together-unm-support?style=flat&logo=github" alt="Issues"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/ChEnLeo-7/Music-Together-unm-support?style=flat" alt="License"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" alt="React">
  <img src="https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS">
  <img src="https://img.shields.io/badge/Socket.IO-4-010101?logo=socketdotio&logoColor=white" alt="Socket.IO">
  <img src="https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white" alt="Express">
  <img src="https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white" alt="Docker">
</p>

## 截图

### 桌面端

|            首页            |            搜索            |            播放            |            聊天            |
| :------------------------: | :------------------------: | :------------------------: | :------------------------: |
| ![首页](screenshots/1.png) | ![搜索](screenshots/2.png) | ![播放](screenshots/3.png) | ![聊天](screenshots/4.png) |

### 移动端

|             首页             |             搜索             |             播放             |             聊天             |
| :--------------------------: | :--------------------------: | :--------------------------: | :--------------------------: |
| ![首页](screenshots/1_m.png) | ![搜索](screenshots/2_m.png) | ![播放](screenshots/3_m.png) | ![聊天](screenshots/4_m.png) |

### 歌词展示对比

|            桌面端歌词            |         竖屏默认（封面）         |           竖屏歌词模式            |
| :------------------------------: | :------------------------------: | :-------------------------------: |
| ![桌面端歌词](screenshots/3.png) | ![竖屏默认](screenshots/3_m.png) | ![竖屏歌词](screenshots/3_m1.png) |

## 参考项目：
>- 原项目 [Yueby/music-together](https://github.com/Yueby/music-together)
>- 二改分支项目 [Madokamaes/music-together](https://github.com/Madokamaes/music-together)

## 该分支特性（原版不重复）

1. **⌨键盘快捷键**：快捷打开对应界面（可自定义键位）  
2. **🧾用户数据持久化**：保存昵称、头像、身份持久化到数据库  
3. **👁‍🗨聊天记录可见性**：设置可调整新用户进入房间是否能看见历史聊天记录  
4. **🔄手动同步**：设置-房间中，支持手动触发同步，更快频率的校准  
5. **🧪实验性功能**：性能优化（不一定流畅）、点击歌词跳转到对应时间点  
6. **🪪服务器管理员身份**：允许解散任意房间、查看账号信息、删除账号、重置账号密码  
7. **🎵音源音质调整**：支持调整音源优先级以及音质优先级，支持实时调整当前歌曲音质  
8. **👤游客模式**：只需要输入一个昵称即可进入房间，后续可以设置密码成为账号登录  
9. **🌐成员离线保存**：保存离开房间后的成员信息（显示离线），此信息记录可被房主删除  
10. **🏠️隐藏房间**：开启后隐藏房间在大厅显示，但是可以通过完整房间号和邀请链接进入  
11. **📒账号功能**：账号信息固化、通过登录恢复Cookie及房间身份、权限、支持上传头像  
12. **🎶更广的音源支持**：如果登录了音乐平台的VIP账号可以获取的更全的音质（似乎不支持杜比）  
13. **🖥️UNM服务器支持**：可以在环境变量 `UNM_SERVER_URL` 设置，或者浏览器设置中  
14. **🌟UI以及细节优化**：添加全屏按钮、点击歌词跳转对应时间点、隐藏已播放的歌词（开关）、界面细节优化调整、排版优化  
15. **🏘️永久房间**：开启后除了房主、服务器管理员能解散其他情况都不会销毁（Cookie、UNM服务器等信息会跟随保存）  
16. **歌曲/专辑/歌单 ID搜索**：支持用网易云的 `歌曲`/`歌单`/`专辑`ID 搜索

## 温馨提示
本项目使用 GPT5.5 AI 二改而来，添加了 UNM 以及一些自己个性化需求的功能，可能会有些小bug小瑕疵（某个功能无效），一般不会有更新，如有冒犯，请联系我删除

## 快速开始 (Windows)

### 环境要求

- Node.js >= 22
- pnpm >= 10

### 安装与开发

```bash
git clone https://github.com/ChEnLeo-7/Music-Together-unm-support.git
cd music-together
pnpm install
pnpm dev
```

前端: http://localhost:5173 | 后端: http://localhost:3001

## Docker 本地部署

**Docker-Compose**:
``` Docker-Compose
services:
  music-together:
    build:
      context: .
      dockerfile: Dockerfile
    image: music-together:local
    container_name: music-together
    restart: unless-stopped
    ports:
      - "${HOST_PORT:-3001}:3001"
    environment:
      NODE_ENV: production
      PORT: 3001
      CLIENT_URL: "${CLIENT_URL:-}"
      CORS_ORIGINS: "${CORS_ORIGINS:-}"
      IDENTITY_SECRET: "${IDENTITY_SECRET:-dev-identity-secret-change-me}"
      IDENTITY_TTL_DAYS: "${IDENTITY_TTL_DAYS:-30}"
      IDENTITY_COOKIE_SECURE: "${IDENTITY_COOKIE_SECURE:-false}"
      REJOIN_TTL_MS: "${REJOIN_TTL_MS:-30000}"
      DATABASE_URL: "${DATABASE_URL:-file:/app/data/music-together.db}"
      SERVER_ADMIN_IDS: "${SERVER_ADMIN_IDS:-}"
      AUTO_FALLBACK_ENABLED: "${AUTO_FALLBACK_ENABLED:-true}"
      UNM_SERVER_URL: "${UNM_SERVER_URL:-}"
      UNM_SERVER_TIMEOUT_MS: "${UNM_SERVER_TIMEOUT_MS:-10000}"
    volumes:
      - music-together-data:/app/data
    networks:
      - music-together

networks:
  music-together:
    name: music-together

volumes:
  music-together-data:

```
**Dockerfile**
```
# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/client/package.json packages/client/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/client packages/client
RUN pnpm build

FROM base AS prod-deps
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/client/package.json packages/client/package.json
RUN pnpm install --frozen-lockfile --prod --filter @music-together/server...

FROM node:22-alpine AS production
ENV NODE_ENV=production
ENV PORT=3001
WORKDIR /app

RUN apk add --no-cache vips

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/client/package.json packages/client/package.json
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=prod-deps /app/packages/server/node_modules packages/server/node_modules
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/client/dist packages/client/dist

RUN sed -i 's|./src/index.ts|./dist/index.js|g' packages/shared/package.json \
  && mkdir -p /app/data

EXPOSE 3001
VOLUME ["/app/data"]
CMD ["node", "packages/server/dist/index.js"]

```

## 项目结构

```
packages/
  client/   -- 前端 React 应用
  server/   -- 后端 Node.js 服务
  shared/   -- 共享类型、常量与权限定义
```

## 致谢

| 库                                                                                            | 说明               |
| --------------------------------------------------------------------------------------------- | ------------------ |
| [Howler.js](https://github.com/goldfire/howler.js)                                            | Web 音频播放       |
| [Apple Music-like Lyrics](https://github.com/Steve-xmh/applemusic-like-lyrics)                | 歌词组件 (GPL-3.0) |
| [Meting](https://github.com/metowolf/Meting)                                                  | 多平台音乐 API     |
| [NeteaseCloudMusicApi Enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced) | 网易云音乐 API     |
| [CASL](https://github.com/stalniy/casl)                                                       | 权限管理           |
| [Zustand](https://github.com/pmndrs/zustand)                                                  | 状态管理           |
| [shadcn/ui](https://github.com/shadcn-ui/ui)                                                  | UI 组件库          |
| [Motion](https://github.com/motiondivision/motion)                                            | 动画库             |
| [qq-music-download](https://github.com/tooplick/qq-music-download)                            | QQ 音乐登录参考    |
| [UnblockNeteaseMusic](https://github.com/UnblockNeteaseMusic/server)                         |        解灰        |

## 协议

[AGPL-3.0](LICENSE)
