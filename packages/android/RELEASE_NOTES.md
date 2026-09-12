## 中文

本版本提供使用持久正式密钥签名的 Android Release APK，可在已安装正式版的设备上直接覆盖升级。

### 本次更新

- 新增服务端歌曲结束 watchdog：即使房主网页标签页处于后台、被冻结或未及时发送结束事件，服务端仍会根据权威播放时间推进队列。
- 后台标签页收到延迟播放命令后，会按照服务端时间投影实际播放位置，不再从旧位置或新歌第 0 秒开始。
- 网页从后台返回前台时立即请求或上报播放同步，减少浏览器定时器节流造成的恢复延迟。

### 安全与可靠性

- 服务端结束兜底绑定当前曲目 ID 和播放 revision，并在房间播放 mutex 内再次校验，避免旧定时器或客户端正常结束事件造成重复切歌。
- 播放、恢复、seek 和有效的指挥者进度上报都会重置歌曲结束截止时间，避免暂停或进度调整后遗留过期任务。
- 新播放事件会取消客户端尚未执行的旧播放定时器，防止旧命令覆盖当前歌曲。

### 播放同步

- 修复房主网页标签页不在前台时，整个房间可能停留在已结束歌曲、无法同步下一首的问题。
- 修复后台标签页延迟执行下一首后从错误位置播放的问题。
- 增加服务端无客户端结束回调自动推进、旧 revision 不误切歌的回归测试。

### 安装

下载本 Release 中的 `music-together-android-v0.10.6.apk`。如已安装使用其他签名的旧 Debug APK，需要先卸载旧版本再安装；已安装正式签名版本的设备可直接覆盖升级。

## English

This release provides an Android Release APK signed with the persistent production key and supports in-place upgrades from an installed production build.

### What's new

- Added a server-side track-end watchdog. The server now advances the queue from authoritative playback time even when the host web tab is backgrounded, frozen, or unable to deliver its end event promptly.
- Backgrounded tabs project delayed playback commands from server time instead of starting from a stale position or from zero on the next track.
- Web clients immediately request or report playback synchronization when returning to the foreground, reducing recovery delays caused by browser timer throttling.

### Security and reliability

- The server fallback is bound to the current track ID and playback revision, then revalidated inside the room playback mutex to prevent duplicate advancement from stale timers or a normal client end event.
- Play, resume, seek, and accepted conductor progress reports reschedule the track-end deadline so paused or adjusted playback cannot leave stale work behind.
- New playback events cancel pending client playback timers, preventing old commands from replacing the current track.

### Playback synchronization

- Fixed rooms getting stuck on a completed track when the host web tab was not in the foreground.
- Fixed delayed next-track execution in backgrounded tabs starting at the wrong position.
- Added regression coverage for server advancement without a client end callback and for rejecting stale playback revisions.

### Installation

Download `music-together-android-v0.10.6.apk` from this Release. If an older Debug APK uses a different signature, uninstall it once before installing this build. Devices with a production-signed version can upgrade in place.
