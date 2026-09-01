<p align="center">
  <img alt="Music Together" src="public/logo.svg" width="80">
</p>

<h1 align="center">Music Together Pro</h1>

<p align="center">
  Online multi-user synchronized music platform -- Create a room, invite friends, and listen to the same song together in real time. With UNM server support.
</p>

<p align="center">
  <a href="README.md">中文</a>
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

## Screenshots

### Desktop

|            Home            |           Search           |           Player           |           Chat            |
| :------------------------: | :------------------------: | :------------------------: | :-----------------------: |
| ![Home](screenshots/1.png) | ![Search](screenshots/2.png) | ![Player](screenshots/3.png) | ![Chat](screenshots/4.png) |

### Mobile

|            Home             |           Search            |           Player            |            Chat             |
| :-------------------------: | :-------------------------: | :-------------------------: | :-------------------------: |
| ![Home](screenshots/1_m.png) | ![Search](screenshots/2_m.png) | ![Player](screenshots/3_m.png) | ![Chat](screenshots/4_m.png) |

### Lyrics Display Comparison

|         Desktop Lyrics         |      Portrait Default (Cover)      |        Portrait Lyrics Mode         |
| :----------------------------: | :--------------------------------: | :---------------------------------: |
| ![Desktop Lyrics](screenshots/3.png) | ![Portrait Default](screenshots/3_m.png) | ![Portrait Lyrics](screenshots/3_m1.png) |

## Reference Projects:
> - Original project [Yueby/music-together](https://github.com/Yueby/music-together)
> - Forked branch [Madokamaes/music-together](https://github.com/Madokamaes/music-together)

## Features of this branch (not in the original)

1. **⌨ Keyboard Shortcuts**: Quick access to corresponding interfaces (customizable keybindings)
2. **🧾 User Data Persistence**: Saves nickname, avatar, and identity to the database
3. **👁‍🗨 Chat History Visibility**: Setting to control whether new users can see historical chat messages when entering a room
4. **🔄 Manual Sync**: Supports manual sync trigger in Settings → Room, with higher frequency calibration
5. **🧪 Experimental Features**: Performance optimizations (not guaranteed smooth), click on lyrics to jump to the corresponding timestamp
6. **🪪 Server Admin Identity**: Allows dissolving any room, viewing account info, deleting accounts, resetting account passwords
7. **🎵 Audio Source & Quality Adjustment**: Supports adjusting audio source priority and quality priority, real‑time adjustment of current song quality
8. **👤 Guest Mode**: Enter a room with just a nickname, can later set a password to convert into a registered account
9. **🌐 Member Offline Persistence**: Saves member information after leaving a room (displayed as offline), this record can be deleted by the room owner
10. **🏠️ Hidden Rooms**: When enabled, the room is hidden from the lobby, but can still be accessed via the full room ID or invite link
11. **📒 Account Features**: Persistent account info, restore Cookie and room identity via login, permission support, avatar upload
12. **🎶 Broader Audio Source Support**: If logged into a music platform's VIP account, can access higher quality audio (Dolby not supported)
13. **🖥️ UNM Server Support**: Can be set via the environment variable `UNM_SERVER_URL` or in browser settings
14. **🌟 UI & Detail Optimizations**: Added full‑screen button, click lyrics to jump to timestamp, hide played lyrics (toggle), UI detail tweaks, layout improvements
15. **🏘️ Permanent Rooms**: When enabled, the room will not be destroyed except by the room owner or server admin (Cookie, UNM server info, etc., persist)
16. **Song/Album/Playlist ID Search**: Supports searching by NetEase Cloud `song`/`playlist`/`album` ID
17. **Native Android Background Playback**: Provides an Android app with Media3 foreground playback, lock-screen and background audio, system media controls, stable play/pause state synchronization, and an interactive seek bar. The app can connect to a self-hosted HTTP or HTTPS server at startup.

## Important Note

This project was secondarily developed using AI (GPT‑5.5), adding UNM support and some personalized features. There may be minor bugs or imperfections (e.g., certain features may not work). Updates are not generally planned. If this causes any offense, please contact me to have it removed.

## Quick Start (Windows)

### Requirements

- Node.js >= 22
- pnpm >= 10

### Installation & Development

```bash
git clone https://github.com/ChEnLeo-7/Music-Together-unm-support.git
cd music-together
pnpm install
pnpm dev
```

Frontend: http://localhost:5173 | Backend: http://localhost:3001

### Android App

Download and install the latest APK from [GitHub Releases](https://github.com/ChEnLeo-7/Music-Together-Pro-UNM-Support/releases/latest). On first launch, enter your Music Together server address, such as `https://music.example.com`; trusted LAN testing may use an address such as `http://192.168.1.10:3001`.

The Android app uses a Media3 foreground playback service and supports background/lock-screen playback plus system media controls. Version `v0.7.0` fixes stale play-button state, false pause transitions while buffering, seek-bar touch offset and snap-back, duplicate playback commands, and native playback continuing after leaving a room.

## Docker Local Deployment

The repository's `docker-compose.yml` builds the application image locally from the checked-out source and includes a health check, log rotation, and a persistent data volume:

```bash
cp .env.example .env
# Edit .env and set at least the three required secrets
docker compose up -d --build
docker compose ps
```

The application image is no longer pulled from GHCR. After updating the checked-out source, run `docker compose up -d --build` in the project directory. Docker builds for the host architecture and restarts the service; the `music-together-data` volume remains intact.

When deploying behind a reverse proxy with `TRUST_PROXY_HOPS=1`, also set `BIND_ADDRESS=127.0.0.1` so clients cannot bypass the proxy and reach the application port directly.

Before the first deployment, generate and configure the keys in `.env`:

```bash
openssl rand -base64 32
openssl rand -base64 32
openssl rand -hex 32
```

Use the first two values for `ROOM_PASSWORD_KEY` and `PLATFORM_AUTH_KEY`, and the third for `STREAM_PROXY_SECRET`. Session cookies require HTTPS by default; set `SESSION_COOKIE_SECURE=false` only for trusted LAN HTTP testing. If an upgrade from an old version reports `Unversioned database schema detected`, back up the Docker volume on the host and then run this mandatory incompatible-schema reset:

```bash
docker compose stop music-together
docker compose run --rm --build music-together node packages/server/dist/cli/resetAccounts.js --confirm=RESET-ALL-APPLICATION-DATA
docker compose up -d --build
```

The reset removes old users, permanent rooms, platform authorizations, and avatars. After restart, sign in once with `admin/admin` and immediately change both the username and password when prompted; public registration opens after that bootstrap step.

Refer to the repository root `Dockerfile` for image build details so documentation cannot drift from the production image configuration.

## Project Structure

```
packages/
  client/   -- Frontend React application
  server/   -- Backend Node.js service
  shared/   -- Shared types, constants, and permission definitions
```

## Acknowledgments

| Library                                                                                       | Description                      |
| --------------------------------------------------------------------------------------------- | -------------------------------- |
| [Howler.js](https://github.com/goldfire/howler.js)                                            | Web audio playback               |
| [Apple Music-like Lyrics](https://github.com/Steve-xmh/applemusic-like-lyrics)                | Lyrics component (GPL-3.0)       |
| [Meting](https://github.com/metowolf/Meting)                                                  | Multi-platform music API         |
| [NeteaseCloudMusicApi Enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced) | NetEase Cloud Music API          |
| [CASL](https://github.com/stalniy/casl)                                                       | Permission management            |
| [Zustand](https://github.com/pmndrs/zustand)                                                  | State management                 |
| [shadcn/ui](https://github.com/shadcn-ui/ui)                                                  | UI component library             |
| [Motion](https://github.com/motiondivision/motion)                                            | Animation library                |
| [qq-music-download](https://github.com/tooplick/qq-music-download)                            | QQ Music login reference         |
| [UnblockNeteaseMusic](https://github.com/UnblockNeteaseMusic/server)                         |Unlock gray-area copyrighted music|

## License

[AGPL-3.0](LICENSE)
