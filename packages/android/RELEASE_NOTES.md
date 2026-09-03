## 中文

本版本提供使用持久正式密钥签名的 Android Release APK，可覆盖安装后续版本。

### 本次更新

- 完善系统媒体通知，支持通知栏、锁屏、蓝牙和耳机按键通过统一的 MediaSession 控制房间播放。
- 媒体通知现在由 Media3 管理，并自动同步歌曲标题、作者、封面和播放状态。
- 支持应用内跟随初始 HTTP(S) 服务端跨域、跨端口重定向，并将原生播放安全绑定到最终地址。
- 网页重载后继续恢复正在播放歌曲的服务端时间位置，暂停歌曲保持暂停位置。
- 修复 Android 调整进度时进度条短暂跳回旧位置的问题。
- Android 播放器支持隐藏状态栏和导航栏的沉浸式全屏。
- 移动端封面切换歌词时，标题和作者使用平滑的 Apple 风格非线性动效。
- 移动端进入歌词模式后继续保持动态流光背景效果。

### 安全与可靠性

- 原生 Bridge 只连接用户在 Activity 中确认的服务器，页面无法指定 Cookie 域或 Socket.IO 目标。
- 修复密码房间 WebView 与原生播放服务争用 rejoin token 的问题。
- 修复服务被系统重启后永久空转，以及 Activity 重建返回服务器选择页的问题。
- 锁屏通知隐藏完整歌曲标题、作者和封面，仅在设备解锁后显示。

### 播放同步

- 修复锁屏 seek 重复发送旧位置、预加载切歌音量恢复到 100%、元数据丢失和无效预加载未释放的问题。
- Activity 返回前台后会恢复后台期间发生的暂停和 seek 状态。
- Android 使用单次快照同步 Web UI，并为 wrapper 加载增加超时，不再永久轮询或每帧重复跨 Bridge 读取。
- NTP 校准完成前不会按错误设备时钟长时间等待，并向服务端上报 RTT 以改善调度。
- 新增 Android 同步算法单元测试和跨端协议 CI 触发覆盖。

### 安装

下载本 Release 中的 `music-together-android-*.apk`。如已安装使用其他签名的旧 Debug APK，需要先卸载旧版本再安装；之后的正式版本可直接覆盖升级。

## English

This release provides an Android Release APK signed with a persistent production key, enabling in-place upgrades for future releases.

### What's new

- Improved the system media notification so notification shade, lock screen, Bluetooth, and headset controls all operate through the shared MediaSession.
- Media3 now owns the media notification lifecycle and keeps the track title, artist, artwork, and playback state synchronized.

### Security and reliability

- Initial cross-origin and cross-port HTTP(S) server redirects now stay in-app, with native playback securely rebound to the final origin.
- Reload recovery resumes from the server-authoritative position, while paused tracks remain paused at their saved position.
- Fixed the Android progress bar briefly jumping back to the previous position during a seek.
- Added immersive player fullscreen that hides the status and navigation bars.
- Added a smooth Apple-style nonlinear title and artist transition when switching between cover and lyrics on mobile.
- Mobile lyric mode now keeps the dynamic flowing background effect active.

- The native bridge only connects to the server approved in the Activity; pages can no longer choose the Cookie domain or Socket.IO target.
- Fixed rejoin-token contention between the WebView and native playback service in password-protected rooms.
- Fixed an endlessly idling service after system restart and restored the current server page after Activity recreation.
- Lock-screen notifications conceal full track titles, artists, and artwork until the device is unlocked.

### Playback synchronization

- Fixed lock-screen seeks sending a stale second position, preloaded tracks resetting volume to 100%, missing metadata, and unreleased invalid preloads.
- Returning to the foreground now reconciles pause and seek changes that occurred while the Activity was stopped.
- Android now synchronizes the Web UI through one snapshot and applies a wrapper bootstrap timeout instead of polling forever or making repeated Bridge calls every frame.
- Playback waits briefly for NTP calibration instead of trusting a badly skewed device clock, and reports RTT to improve server scheduling.
- Added Android synchronization algorithm tests and CI triggers for cross-platform protocol changes.

### Installation

Download `music-together-android-*.apk` from this Release. If an older Debug APK uses a different signature, uninstall it once before installing this build; subsequent production releases can be installed in place.
