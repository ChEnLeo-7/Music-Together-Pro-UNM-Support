# 账号系统与房间门禁重设计

> 状态：设计已确认，待实施
> 范围：应用账号、登录会话、游客身份、服务器管理员初始化、房间密码与短期重连授权
> 数据策略：不兼容迁移旧应用数据，实施时执行一次性全量重置

## 1. 背景

当前系统将自动生成的随机用户 ID 同时用作内部主键、公开账号 ID 和登录凭据的一部分。用户通过随机 ID 加密码恢复身份，游客与正式账号之间没有清晰的领域边界。当前房间准入还会根据历史成员、房间管理员、服务器管理员和重连票据跳过密码验证，导致房间密码无法构成可靠的访问控制边界。

本设计解决两个核心问题：

1. 将账号登录改为用户可理解、可记忆的用户名和密码。
2. 将身份、房间角色和房间准入拆开，确保非房主不能仅凭历史状态或管理角色绕过房间密码。

## 2. 已确认产品决策

| 项目 | 决策 |
| --- | --- |
| 登录方式 | 用户名 + 密码 |
| 游客模式 | 保留 |
| 游客注册 | 原地升级，保留当前数据归属 |
| 旧应用数据 | 全部重置，不迁移 |
| 用户名 | ASCII，3-32 位，区分大小写 |
| 用户名字符 | `A-Z`、`a-z`、`0-9`、`_`、`-` |
| 账号密码 | 10-128 字符 |
| 普通注册 | 首个管理员初始化后公开开放 |
| 首个管理员 | 仅服务器本机初始化 |
| 忘记密码 | 服务器管理员重置 |
| 登录会话 | 服务端保存、可撤销、30 天有效 |
| 房间免密主体 | 仅房主 |
| 短期免输 | 正确验证房间密码后获得 5 分钟重连授权 |
| 房间改密 | 在线成员保持连接；旧重连授权立即失效 |
| 房间密码回显 | 允许房主查看和复制 |
| 房间密码存储 | 使用独立密钥进行认证加密 |

## 3. 目标与非目标

### 3.1 目标

- 用户不再接触随机账号 ID，以用户名和密码完成注册及登录。
- 游客可以正常创建和加入房间，但无法在丢失会话后找回数据。
- 游客注册时保留内部用户 ID，不丢失其房间所有权和平台授权。
- 登录、退出、改密、管理员重置和删号均可立即撤销会话。
- 已删除或禁用的账号不能被旧 Cookie 自动重建。
- 带密码房间只有房主可以直接进入。
- 房间管理员、服务器管理员、历史成员和游客都不能绕过房间密码。
- 短暂刷新或断网可通过 5 分钟授权恢复，且改密后旧授权立即失效。
- 普通房间状态和广播永远不包含房间密码明文。
- 所有安全规则由服务端强制执行，客户端只负责交互体验。

### 3.2 非目标

- 本阶段不支持邮箱、手机号、OAuth 或第三方账号登录。
- 本阶段不提供用户自助找回密码邮件或短信。
- 本阶段不迁移旧随机 ID 账号、永久房间、头像或平台授权。
- 本阶段不允许用户名修改；内部模型应避免阻碍以后增加该能力。
- 本阶段不要求房间改密后立即踢出已经在线的成员。
- 本阶段不将服务器管理员视为房间所有者。

## 4. 核心领域概念

### 4.1 用户主体

用户主体是数据与权限的稳定所有者，由服务端生成不可变的内部 ID。该 ID 不作为登录名，不在账号界面展示。

```ts
type UserId = string

interface UserAccount {
  id: UserId
  kind: 'guest' | 'account'
  username: string | null
  nickname: string
  avatarUrl: string | null
  passwordHash: string | null
  role: 'user' | 'admin'
  status: 'active' | 'disabled'
  mustChangePassword: boolean
  createdAt: number
  updatedAt: number
  lastSeenAt: number
}
```

内部 ID 继续作为以下数据的关联键：

- 房间 `creatorId`、成员 ID、管理员 ID 和播放主持 ID
- 音乐平台授权所有者
- 聊天、投票和播放操作主体
- 头像文件所有者
- 登录会话所有者

### 4.2 登录凭据

正式账号必须同时具有：

- 唯一用户名
- 账号密码哈希
- `kind = 'account'`

用户名只用于定位登录主体，不能作为房间所有权、管理员权限或平台授权的关联键。

用户名规则：

```regex
^[A-Za-z0-9_-]{3,32}$
```

补充约束：

- 提交前去除首尾空白。
- 用户名区分大小写，`Foo` 与 `foo` 是不同账号。
- 唯一约束必须由 SQLite 索引保证，不能只做应用层先查后写。
- 保留 `admin`、`administrator`、`root`、`system` 等系统名称，避免误导性账号。
- 注册失败不能暴露内部用户 ID 或其他账号资料。

### 4.3 游客

游客也是用户主体，但没有登录凭据：

```ts
kind = 'guest'
username = null
passwordHash = null
```

游客规则：

- 首次选择游客模式时创建内部用户主体和登录会话。
- 随机内部 ID 不向用户展示，也不能用于登录恢复。
- 游客可创建房间、加入房间和绑定音乐平台数据。
- 游客丢失或清除会话后，数据不能找回。
- 游客注册时在同一事务中补充用户名、密码哈希并改为 `account`。
- 游客升级不得改变内部 ID。
- 无有效会话时，任何人都不能凭昵称认领游客数据。

### 4.4 登录会话

登录会话证明当前客户端正在以某个用户主体访问系统。会话与账号密码、房间密码是不同概念。

```ts
interface Session {
  id: string
  userId: UserId
  tokenHash: string
  createdAt: number
  expiresAt: number
  lastSeenAt: number
  revokedAt: number | null
}
```

会话不变量：

- 浏览器只保存高熵原始 token。
- 数据库只保存 token 的 SHA-256 哈希。
- token 至少包含 256 位随机熵。
- 默认有效期为 30 天。
- Cookie 使用 `HttpOnly`、`Path=/`、`SameSite=Lax`。
- HTTPS 生产部署必须使用 `Secure`。
- HTTP 和 Socket.IO 使用同一套会话验证模块。
- 退出、改密、管理员重置、禁用和删除账号可立即撤销会话。
- 会话对应用户不存在、被禁用、过期或已撤销时，认证必须失败。
- 认证中间件不得自动创建缺失的用户。

### 4.5 房间角色

房间角色只描述用户进入房间后的操作权限：

- `owner`：房主
- `admin`：播放和队列管理员，包括临时管理员
- `member`：普通成员

角色不能作为房间密码的替代凭据。房间管理员和服务器管理员均不因角色获得免密准入。

### 4.6 房间准入

房间准入证明某个用户是否可以建立新的房间连接。权威规则为：

```ts
if (!room.hasPassword) allow()
else if (userId === room.creatorId) allow()
else requireCurrentPasswordOrValidAdmissionGrant()
```

以下状态不能单独放行：

- 用户曾经进入过该房间
- 用户仍存在于历史成员列表
- 用户是永久或临时房间管理员
- 用户是服务器管理员
- Socket 曾映射到该房间
- 用户持有旧密码版本签发的授权
- 永久房间恢复后仍保存了该用户记录

## 5. 数据库设计

### 5.1 Schema 版本

引入最小版本化迁移机制：

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
```

每个迁移必须：

- 在事务中执行。
- 有唯一递增版本号。
- 成功后记录版本。
- 失败时回滚并阻止服务启动。
- 不依赖重复执行 `CREATE TABLE IF NOT EXISTS` 模拟迁移。

### 5.2 用户表

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('guest', 'account')),
  username TEXT COLLATE BINARY,
  nickname TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  CHECK (
    (kind = 'guest' AND username IS NULL AND password_hash IS NULL)
    OR
    (kind = 'account' AND username IS NOT NULL AND password_hash IS NOT NULL)
  )
);

CREATE UNIQUE INDEX users_username_unique
ON users(username COLLATE BINARY)
WHERE username IS NOT NULL;
```

### 5.3 会话表

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);
```

### 5.4 房间凭据字段

因为产品要求房主回显密码，永久房间需保存加密凭据而不是明文或不可逆哈希：

```sql
ALTER TABLE rooms ADD COLUMN password_ciphertext TEXT;
ALTER TABLE rooms ADD COLUMN password_nonce TEXT;
ALTER TABLE rooms ADD COLUMN password_tag TEXT;
ALTER TABLE rooms ADD COLUMN password_key_version INTEGER;
ALTER TABLE rooms ADD COLUMN password_version INTEGER NOT NULL DEFAULT 0;
```

新 schema 不再使用误导性的 `password_hash` 字段。一次性重置后不需要迁移旧明文。

### 5.5 房间重连授权

授权量小且有效期只有 5 分钟，第一版可保存在进程内存中，不必持久化：

```ts
interface RoomAdmissionGrant {
  tokenHash: string
  roomId: string
  userId: UserId
  sessionId: string
  passwordVersion: number
  expiresAt: number
}
```

如果未来改为多实例部署，必须迁移到共享存储；否则授权只能在签发它的实例上验证。

## 6. 深模块与接口

### 6.1 AccountAuth 模块

账号注册、登录、游客升级、改密和管理员重置集中在一个模块中，路由不得自行拼接 repository 操作。

```ts
interface AccountAuth {
  createGuest(nickname: string): Promise<AuthResult>
  register(input: RegisterInput, currentGuestSession?: Session): Promise<AuthResult>
  login(username: string, password: string): Promise<AuthResult>
  changePassword(userId: UserId, currentPassword: string, newPassword: string): Promise<AuthResult>
  resetPasswordByAdmin(targetUserId: UserId, newPassword: string): Promise<void>
  logout(sessionId: string): Promise<void>
}
```

模块内部负责：

- 用户名校验和唯一性错误映射
- bcrypt 哈希与比较
- 注册事务
- 游客原地升级
- 会话签发与撤销
- 密码修改后的会话轮换
- 防用户名枚举的统一错误

### 6.2 Session 模块

```ts
interface SessionManager {
  issue(userId: UserId): Promise<IssuedSession>
  authenticate(rawToken: string): Promise<AuthenticatedPrincipal | null>
  revoke(sessionId: string): Promise<void>
  revokeAllForUser(userId: UserId): Promise<void>
  revokeAllExcept(userId: UserId, sessionId: string): Promise<void>
}
```

HTTP 和 Socket 中间件都只能通过该接口获取认证主体。

### 6.3 RoomCredential 模块

```ts
interface RoomCredentialManager {
  encrypt(password: string): EncryptedRoomCredential
  verify(credential: EncryptedRoomCredential, candidate: string): boolean
  reveal(credential: EncryptedRoomCredential): string
}
```

实现要求：

- 使用 AES-256-GCM。
- 每次加密使用随机 nonce。
- 使用 `ROOM_PASSWORD_KEY`，不得复用会话或 Cookie 密钥。
- 密钥通过 Base64 编码配置，解码后必须正好 32 字节。
- 生产环境缺少或使用示例密钥时拒绝启动。
- 密钥支持 `password_key_version`，为未来轮换留出空间。
- 解密失败不得降级为明文或无密码状态。

### 6.4 RoomAdmission 模块

```ts
interface RoomAdmission {
  authorizeJoin(input: AuthorizeRoomJoinInput): AuthorizationResult
  issueGrant(input: IssueRoomGrantInput): IssuedRoomGrant
  rotateGrant(input: ConsumeRoomGrantInput): IssuedRoomGrant | null
  revokeForRoom(roomId: string): void
  revokeForUser(roomId: string, userId: UserId): void
  revokeForSession(sessionId: string): void
  revokeForPasswordChange(roomId: string): void
}
```

该模块是所有房间准入规则的唯一实现位置。Controller 不得自行推导免密条件。

## 7. HTTP 认证接口

### 7.1 创建游客

```http
POST /api/auth/guest
Content-Type: application/json

{
  "nickname": "Guest"
}
```

行为：

- 没有有效会话时创建游客主体和会话。
- 已有游客会话时只更新昵称，不重复创建主体。
- 已有正式账号会话时拒绝创建游客，客户端应先退出。

### 7.2 注册或升级游客

```http
POST /api/auth/register
Content-Type: application/json

{
  "username": "ChEnLeo",
  "password": "a-long-password",
  "nickname": "Leo"
}
```

行为：

- 有游客会话时原地升级，内部用户 ID 不变。
- 无会话时创建新的正式账号。
- 有正式账号会话时拒绝重复注册。
- 创建或升级、写入密码哈希和签发会话必须形成一致结果。
- 用户名冲突返回稳定业务错误码。

### 7.3 登录

```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "ChEnLeo",
  "password": "a-long-password"
}
```

行为：

- 用户名大小写必须完全匹配。
- 用户不存在、密码错误或账号禁用使用统一外部错误。
- 成功后签发新会话 Cookie。
- 如果当前是游客会话，不自动合并游客与目标账号数据；旧游客会话被撤销。

### 7.4 退出

```http
POST /api/auth/logout
```

行为：

- 撤销当前会话。
- 清除会话 Cookie。
- 撤销绑定当前会话的房间重连授权。
- 不自动创建新的游客主体。

### 7.5 当前用户

```http
GET /api/auth/me
```

响应：

```ts
interface AccountMe {
  userId: string
  kind: 'guest' | 'account'
  username: string | null
  nickname: string
  avatarUrl: string | null
  role: 'user' | 'admin'
  mustChangePassword: boolean
}
```

### 7.6 修改密码

```http
POST /api/auth/password/change
Content-Type: application/json

{
  "currentPassword": "old-password",
  "newPassword": "new-long-password"
}
```

成功后：

- 撤销该用户所有旧会话。
- 签发当前设备的新会话。
- 撤销与旧会话绑定的房间重连授权。
- 清除 `mustChangePassword`。

### 7.7 管理员重置密码

```http
POST /api/admin/users/:userId/reset-password
Content-Type: application/json

{
  "newPassword": "temporary-long-password"
}
```

成功后：

- 覆盖账号密码哈希。
- 设置 `mustChangePassword = true`。
- 撤销目标账号全部会话。
- 不返回旧密码或密码哈希。

## 8. 首个管理员初始化

首个管理员不通过公开注册接口产生。提供服务器本机命令：

```bash
pnpm account:init-admin
```

要求：

- 命令直接连接配置的 SQLite 数据库。
- 交互式输入用户名、昵称和密码，密码不进入 shell history。
- 数据库中已有任意管理员时拒绝执行。
- 创建账号、密码哈希和 admin 角色写入同一事务。
- 初始化成功后普通注册接口才开放。
- 服务启动时若不存在管理员，可记录明确警告，但不得把公开注册用户自动提升为管理员。
- 删除最后一个管理员前必须拒绝操作。

不得依赖 `X-Forwarded-For` 或 `req.ip` 判断公开 HTTP 请求是否来自本机。反向代理和容器网络会使该判断不可靠。

## 9. 房间密码与门禁

### 9.1 密码规则

- 长度 6-64 字符。
- 不自动裁剪首尾空白，避免悄悄改变用户密码。
- 拒绝空字符串和纯空白密码。
- `null` 是唯一的移除密码语义。
- 创建、修改和加入使用同一组共享校验规则。
- 密码失败响应使用统一 `WRONG_PASSWORD`。

### 9.2 创建房间

- 房主创建房间时已经完成设置密码的授权动作，因此直接进入。
- 房主身份由 `room.creatorId === principal.userId` 决定。
- 创建成功后不需要为房主签发房间重连授权。

### 9.3 加入房间

服务端验证顺序：

1. 验证登录会话或游客会话。
2. 校验加入请求结构。
3. 查找目标房间。
4. 如果无密码，允许加入。
5. 如果当前主体是房主，允许加入。
6. 尝试验证 5 分钟房间重连授权。
7. 没有有效授权时，要求并验证当前房间密码。
8. 验证成功后才离开旧房间、写 Socket mapping 和加入 Socket.IO room。
9. 非房主成功验证后签发或轮换重连授权。

禁止先离开旧房间再验证新房间密码，避免失败请求导致用户被旧房间移除。

### 9.4 五分钟重连授权

授权规则：

- 只在非房主正确验证当前密码后签发。
- 有效期固定为 5 分钟。
- 绑定 `roomId + userId + sessionId + passwordVersion`。
- 数据库存储或内存中只保存 token 哈希。
- 客户端存入 `sessionStorage`，不存入长期 `localStorage`。
- 每个绑定组合最多保留一个有效 token。
- 使用成功后立即轮换，旧 token 失效。
- 错房间、错用户、错会话、错版本和过期 token 均失败。
- 主动离开、退出、会话撤销、房间销毁和密码修改时撤销。
- 无效授权不能降级为免密；必须继续要求当前密码。

### 9.5 修改房间密码

仅房主可以设置、替换或移除密码。密码变化时：

1. 加密并保存新密码，或清除加密字段。
2. 递增 `passwordVersion`。
3. 撤销该房间全部重连授权。
4. 保持当前在线成员连接，不立即踢出。
5. 下一次刷新、断线或重新加入时，非房主必须验证新密码。
6. 永久房间在同一持久化操作中保存密码和版本。

### 9.6 查看房间密码

密码不再通过 `ROOM_STATE` 或 `ROOM_SETTINGS` 广播。提供专用房主接口：

```http
GET /api/rooms/:roomId/password
```

要求：

- 当前会话必须有效。
- 当前用户必须满足 `userId === room.creatorId`。
- 房间管理员和服务器管理员均不能调用。
- 响应使用 `Cache-Control: no-store`。
- 不记录密码到日志。
- 解密失败返回内部错误，不返回损坏数据。

### 9.7 密码失败限速

必须同时限制：

- `(source IP, roomId)`
- `(userId, roomId)`
- 单一 Socket 的加入请求速率

持续失败应增加退避或短期锁定。不能只按 Socket ID 限制，否则重新连接即可绕过。

## 10. 权限矩阵

| 操作 | 房主 | 房间管理员 | 普通成员 | 服务器管理员 |
| --- | ---: | ---: | ---: | ---: |
| 免密码加入带密码房间 | 是 | 否 | 否 | 否 |
| 使用有效 5 分钟授权重连 | 不需要 | 是 | 是 | 是 |
| 查看房间密码 | 是 | 否 | 否 | 否 |
| 修改或移除房间密码 | 是 | 否 | 否 | 否 |
| 修改房间名称和常规设置 | 是 | 否 | 否 | 按运维接口单独授权 |
| 设置房间管理员 | 是 | 否 | 否 | 否 |
| 播放和队列管理 | 是 | 是 | 按成员权限 | 加入后按房间角色 |
| 解散自己的房间 | 是 | 否 | 否 | 是 |
| 解散违规房间 | 否 | 否 | 否 | 是 |

需要拆分当前混用的守卫：

```ts
withRoomMember
withRoomAdmin
withRoomOwner
withServerAdmin
```

`withRoomOwner` 必须严格检查内部用户 ID 是否等于 `room.creatorId`，不能再作为 room manager 的别名。

## 11. 客户端设计

### 11.1 账号交互

- 删除随机账号 ID 的展示、复制和登录入口。
- 登录表单改为用户名和密码。
- 增加注册表单及游客入口。
- 明确显示当前状态：游客或正式账号用户名。
- 正式账号显示用户名和昵称，二者含义分开。
- 游客注册成功后不重建房间用户 ID，不清空已有数据。
- 退出后进入未认证状态，由用户选择登录或创建游客。
- `hasPassword` 不再用于判断是否是正式账号，改用 `kind`。
- 密码被管理员重置后显示强制修改页面。

### 11.2 Socket 生命周期

- HTTP 会话建立成功后再连接 Socket.IO。
- 登录、注册、退出和改密后断开并重新握手。
- Socket 握手失败为 `UNAUTHENTICATED` 时进入认证 UI，不自动创建随机用户。
- 客户端可保存 `userId` 用于识别房间中的自己，但不得将它称为账号 ID 或用于登录。

### 11.3 房间密码交互

- 带密码房间的非房主首次进入必须显示密码输入框。
- 有有效 5 分钟授权时可自动重连。
- 授权失败或版本过期时清除 `sessionStorage` 中的 token 并显示密码框。
- `WRONG_PASSWORD` 后保留房间上下文并允许重新输入。
- 主动离开时清除该房间授权。
- 房主设置页通过专用接口请求密码，不依赖房间状态。
- 普通成员、房间管理员和服务器管理员的客户端状态中不得出现密码字段。

## 12. 数据重置与上线流程

本设计采用一次性全量重置，不对旧 schema 做兼容迁移。重置必须是显式运维操作，不能在普通启动时自动发生。

清理范围：

- 旧 `users`
- 旧永久房间和成员
- 旧平台授权
- 旧头像文件
- 旧身份 Cookie 对应的服务端身份
- 旧房间重连票据
- 旧服务器管理员 ID 配置

建议上线步骤：

1. 停止应用服务。
2. 备份旧 SQLite、头像和必要配置，标记为不可直接恢复到新版本。
3. 配置新的会话安全参数和 `ROOM_PASSWORD_KEY`。
4. 执行一次性 reset/migrate 命令创建新 schema。
5. 通过本机命令初始化首个管理员。
6. 启动服务并验证管理员登录。
7. 验证普通注册、游客、房间密码和重连授权。
8. 确认旧 Cookie 返回未认证而不是创建用户。
9. 开放外部访问。

## 13. 配置设计

建议环境变量：

```dotenv
SESSION_TTL_DAYS=30
SESSION_COOKIE_SECURE=true
ROOM_PASSWORD_KEY=<base64-encoded-32-byte-key>
ROOM_PASSWORD_KEY_VERSION=1
ROOM_ADMISSION_TTL_MS=300000
```

移除或废弃：

```dotenv
IDENTITY_SECRET=
IDENTITY_TTL_DAYS=
SERVER_ADMIN_IDS=
REJOIN_TTL_MS=
```

生产环境启动校验：

- `ROOM_PASSWORD_KEY` 必须存在且长度正确。
- HTTPS 部署必须启用安全 Cookie。
- 数据库 schema 版本必须是应用支持的版本。
- 未初始化管理员时记录显著警告。
- 不允许使用仓库中的示例密钥作为生产密钥。

## 14. 错误码

建议新增或统一以下业务错误码：

| 错误码 | 说明 |
| --- | --- |
| `AUTH_REQUIRED` | 没有有效登录或游客会话 |
| `INVALID_CREDENTIALS` | 用户名或账号密码错误 |
| `USERNAME_TAKEN` | 用户名已被注册 |
| `INVALID_USERNAME` | 用户名格式不合法 |
| `PASSWORD_TOO_SHORT` | 账号密码不足 10 字符 |
| `ACCOUNT_DISABLED` | 账号已禁用，外部可按策略合并为通用错误 |
| `PASSWORD_CHANGE_REQUIRED` | 必须先修改临时密码 |
| `ROOM_PASSWORD_REQUIRED` | 带密码房间缺少密码或有效授权 |
| `WRONG_PASSWORD` | 房间密码错误 |
| `ROOM_GRANT_INVALID` | 房间重连授权无效或过期 |
| `RATE_LIMITED` | 请求过于频繁 |
| `NO_PERMISSION` | 当前主体无操作权限 |

登录接口对外应将用户不存在、密码错误和账号状态异常尽可能合并，避免用户名枚举。管理员接口可以返回更明确状态。

## 15. 安全不变量

实现和审查必须逐条验证：

- [ ] 用户名永远不作为房间或平台数据的权限关联键。
- [ ] 数据库中不存在账号密码明文。
- [ ] 数据库中不存在房间密码明文。
- [ ] 数据库中不存在登录或房间授权原始 token。
- [ ] 已删除用户不能被旧 Cookie 自动重建。
- [ ] 被撤销或过期的会话不能建立 HTTP 或 Socket 身份。
- [ ] 除房主外，任何角色都不能仅凭身份或历史成员记录免密加入。
- [ ] 服务器管理员不能读取房间密码。
- [ ] 改密后所有旧房间重连授权立即失效。
- [ ] 普通房间状态、刷新和广播不含密码字段。
- [ ] 房间密码失败不能导致用户提前离开原房间。
- [ ] 登录和房间密码验证均有服务端限速。
- [ ] 生产环境缺少必要密钥时服务拒绝启动。

## 16. 测试策略

仓库当前没有自动化测试。本次重构必须先建立最小服务端测试基础，再改认证主链路。优先测试模块接口和 Socket 集成行为，不以 UI 隐藏作为安全验证。

### 16.1 账号测试矩阵

- 用户名边界：2、3、32、33 字符。
- 用户名允许和禁止字符。
- 用户名大小写区分。
- 并发注册同名账号只有一个成功。
- 无会话注册创建正式账号。
- 游客注册后内部 ID 保持不变。
- 正式账号不能重复注册覆盖凭据。
- 正确和错误密码登录。
- 用户不存在与密码错误的外部响应一致。
- 退出后当前会话立即失效。
- 用户改密后旧会话失效、新会话有效。
- 管理员重置后全部旧会话失效。
- 禁用和删除账号后旧会话失效。
- 删除账号后旧 Cookie 不会重建账号。
- 不能删除最后一个服务器管理员。

### 16.2 房间门禁测试矩阵

对带密码房间分别验证无密码、错误密码、正确密码和有效授权：

| 主体 | 无密码 | 错误密码 | 正确密码 | 有效 5 分钟授权 |
| --- | --- | --- | --- | --- |
| 房主 | 成功 | 成功 | 成功 | 不需要 |
| 新游客 | 失败 | 失败 | 成功 | 成功 |
| 新账号 | 失败 | 失败 | 成功 | 成功 |
| 离线历史成员 | 失败 | 失败 | 成功 | 成功 |
| 永久房间历史成员 | 失败 | 失败 | 成功 | 成功 |
| 临时管理员 | 失败 | 失败 | 成功 | 成功 |
| 永久管理员 | 失败 | 失败 | 成功 | 成功 |
| 服务器管理员 | 失败 | 失败 | 成功 | 成功 |

补充验证：

- 授权不能跨用户、房间或会话。
- 授权过期后失败。
- 授权使用后轮换，旧 token 失败。
- 主动离开、退出和房间销毁后授权失败。
- 改密后旧密码和旧授权失败，新密码成功。
- 改密时在线成员保持连接。
- 永久房间重启后只接受当前密码。
- 加入失败时不建立 Socket mapping、不进入 Socket.IO room、不签发授权。
- 加入失败时用户仍停留在原房间。

### 16.3 密码隔离测试

- 只有房主专用接口可以解密并返回密码。
- 房间管理员调用查看接口返回 `NO_PERMISSION`。
- 服务器管理员调用查看接口返回 `NO_PERMISSION`。
- 普通 `ROOM_STATE` 不含 `password`。
- `ROOM_REFRESH` 不含 `password`。
- 角色、主持、设置和成员变化广播不含 `password`。
- 日志和错误响应不含账号密码、房间密码或 token。

### 16.4 资源与限速测试

- 登录失败受用户名和 IP 限速。
- 房间密码失败受用户、IP 和房间限速。
- 重复加入不会无限累积授权。
- 每个用户、会话和房间最多一个有效授权。
- 过期授权清理不在每次请求中扫描无限全表。
- 2 GiB 内存环境下测试、类型检查和构建使用单并发。

## 17. 分阶段实施 TODO

### 阶段 0：冻结契约与准备测试

目标：先固定安全行为，再开始替换认证实现。

- [ ] 将本文档作为实现基线纳入代码审查。
- [ ] 确认房间密码长度最终采用 6-64 字符。
- [ ] 确认保留用户名列表。
- [ ] 选择轻量测试框架并增加根目录及 server 测试脚本。
- [ ] 配置测试使用临时 SQLite，不读取生产 `data/`。
- [ ] 增加低内存测试命令，限制并发为 1。
- [ ] 为当前高风险路径编写失败测试：历史成员免密、admin 免密、server-admin 免密。
- [ ] 为账号注册、登录、会话撤销编写接口级测试骨架。

完成标准：测试可在 2 GiB LXC 中稳定运行，关键安全行为已有红灯用例。

### 阶段 1：Schema 与一次性重置工具

目标：建立可演进的新数据库基础。

- [ ] 新增 `schema_migrations` 和迁移执行器。
- [ ] 定义新 `users` 表和区分大小写唯一用户名索引。
- [ ] 新增 `sessions` 表及索引。
- [ ] 重建 `rooms` 凭据字段，移除旧 `password_hash` 语义。
- [ ] 为永久房间增加 `password_version`。
- [ ] 复核所有外键和 `ON DELETE` 行为。
- [ ] 为 `rooms.creator_id` 增加明确删除策略。
- [ ] 编写一次性全量 reset/migrate 命令。
- [ ] reset 命令要求显式确认，不允许普通服务启动自动执行。
- [ ] 清理头像和平台授权的行为纳入 reset。
- [ ] 增加空库建库、重复启动和迁移失败回滚测试。

完成标准：全新数据库可从零创建，schema 有版本，重置流程可重复验证且不会在普通启动中误触发。

### 阶段 2：账号与会话服务端

目标：替换随机 ID 登录恢复模型。

- [ ] 实现 `AccountAuth` 模块。
- [ ] 实现 `SessionManager` 模块。
- [ ] 使用 bcrypt 保存账号密码哈希。
- [ ] 实现游客创建。
- [ ] 实现无会话注册。
- [ ] 实现游客原地升级注册。
- [ ] 实现用户名 + 密码登录。
- [ ] 实现真正的退出和 Cookie 清除。
- [ ] 实现当前用户接口。
- [ ] 实现用户修改密码和当前会话轮换。
- [ ] 实现管理员重置密码及全部会话撤销。
- [ ] 实现账号禁用与删除后的会话失效。
- [ ] 删除认证中间件中的 `userRepo.ensure()` 自动建用户行为。
- [ ] 替换 HTTP 身份中间件。
- [ ] 替换 Socket.IO 身份中间件。
- [ ] 增加登录和注册限速。
- [ ] 统一防用户名枚举错误响应。

完成标准：用户仅通过用户名和密码恢复正式账号，游客会话可用，所有撤销路径在 HTTP 和 Socket 上立即生效。

### 阶段 3：首个管理员与管理接口

目标：移除随机 ID 环境变量管理员模型。

- [ ] 实现 `pnpm account:init-admin` 本机命令。
- [ ] 使用隐藏输入读取密码。
- [ ] 在事务中创建首个 admin。
- [ ] 已有管理员时拒绝再次初始化。
- [ ] 无管理员时禁止公开普通注册并输出运维提示。
- [ ] 初始化完成后开放普通注册。
- [ ] 移除 `SERVER_ADMIN_IDS` 配置和代码路径。
- [ ] 管理员用户列表显示用户名、昵称、角色和状态。
- [ ] 管理员可按用户名查找用户，但操作提交内部 user ID。
- [ ] 防止删除或降级最后一个管理员。
- [ ] 管理员重置密码设置 `mustChangePassword`。

完成标准：服务器管理员完全由数据库角色管理，公网用户不能抢先成为首个管理员。

### 阶段 4：客户端账号流程

目标：完成用户名账号和游客体验替换。

- [ ] 更新 `AccountMe`，使用 `kind` 和 `username`。
- [ ] 删除账号 ID 登录、复制和恢复 UI。
- [ ] 增加用户名 + 密码登录 UI。
- [ ] 增加公开注册 UI。
- [ ] 保留游客昵称入口。
- [ ] 游客升级成功后保持内部 user ID 和当前数据。
- [ ] 退出后进入未认证状态，不自动创建新游客。
- [ ] 增加强制修改临时密码页面。
- [ ] 登录、注册、退出和改密后重连 Socket。
- [ ] Socket 未认证时显示认证入口，不自动 bootstrap 随机身份。
- [ ] 将客户端 `mt-userId` 语义改为仅用于“识别自己”。
- [ ] 更新中英文账号文案。
- [ ] 清理 `hasPassword` 作为账号类型判断的所有用法。

完成标准：客户端不再要求用户保存随机 ID，账号与游客状态清晰，Socket 身份切换一致。

### 阶段 5：房间凭据加密

目标：消除数据库房间密码明文，同时保留房主回显能力。

- [ ] 实现 `RoomCredentialManager`。
- [ ] 增加 `ROOM_PASSWORD_KEY` 和版本配置校验。
- [ ] 使用 AES-256-GCM 加密房间密码。
- [ ] 创建、修改和永久恢复统一使用加密凭据。
- [ ] 实现房主专用密码查看接口。
- [ ] 接口响应增加 `Cache-Control: no-store`。
- [ ] 从 `RoomState` 共享类型中删除 `password` 字段。
- [ ] 删除 `toPublicRoomStateForOwner()` 的密码拼接行为。
- [ ] 删除加入、刷新、角色变化和设置广播中的密码明文。
- [ ] 增加密钥错误、密文损坏和权限隔离测试。

完成标准：数据库、普通状态和日志中没有房间密码明文，只有房主专用路径能解密查看。

### 阶段 6：严格房间门禁与短期授权

目标：使房间密码成为可靠的服务端访问控制边界。

- [ ] 实现 `RoomAdmission` 模块。
- [ ] 将房主定义固定为 `userId === room.creatorId`。
- [ ] 从密码免验证逻辑删除历史成员条件。
- [ ] 删除永久管理员免密条件。
- [ ] 删除临时管理员免密效果。
- [ ] 删除服务器管理员免密条件。
- [ ] 删除 Socket mapping 作为免密条件。
- [ ] 将旧重连票据替换为绑定密码版本的 5 分钟授权。
- [ ] 授权绑定房间、用户、会话和密码版本。
- [ ] 每个绑定组合只保留一个 token，并在使用后轮换。
- [ ] 主动离开、退出、撤销会话和房间销毁时清理授权。
- [ ] 改密时递增版本并清理全房间授权。
- [ ] 改密时保持在线成员连接。
- [ ] 加入验证成功后才离开旧房间并写 Socket mapping。
- [ ] 保留历史成员记录的聊天历史用途，但与准入解耦。
- [ ] 为房间密码失败增加多维限速。
- [ ] 修复永久房间关闭后数据库状态未更新的问题。

完成标准：除房主外，所有身份首次加入都必须验证当前密码；5 分钟授权只能用于安全重连，改密后立即失效。

### 阶段 7：权限守卫重构

目标：消除 owner、room admin 和 server admin 的权限混用。

- [ ] 实现独立 `withRoomOwner`。
- [ ] 实现独立 `withRoomAdmin`。
- [ ] 保留明确的 `withServerAdmin`。
- [ ] 删除 `createWithOwnerOnly = createWithRoomManager` 别名。
- [ ] 房间密码查看和修改只使用 owner 守卫。
- [ ] 房间角色设置只使用 owner 守卫。
- [ ] 房间管理员只获得播放和队列权限。
- [ ] 服务器管理员解散违规房间使用独立运维接口。
- [ ] 服务器管理员进入房间前仍执行正常门禁。
- [ ] 为 owner、永久 admin、临时 admin、member、server admin 建立权限矩阵测试。

完成标准：角色权限与门禁权限完全分离，任何 manager 判断都不能间接泄露或绕过房间密码。

### 阶段 8：客户端房间门禁

目标：配合服务端实现安全且可理解的密码体验。

- [ ] 将房间授权从 `localStorage` 移到 `sessionStorage`。
- [ ] 更新加入请求的授权字段和响应事件。
- [ ] 首次进入带密码房间显示密码输入。
- [ ] 5 分钟授权有效时自动重连。
- [ ] 授权失败时清除本地 token 并重新弹出密码框。
- [ ] 改密后下一次刷新或断线要求输入新密码。
- [ ] 主动离开时清除授权。
- [ ] 房主刷新和重连不显示密码框。
- [ ] 房主设置页通过专用接口读取密码。
- [ ] 房间 admin 和 server admin UI 不展示密码。
- [ ] 加入失败时保持原房间和待加入上下文。

完成标准：客户端行为与服务端规则一致，但即使绕过 UI 直接发 Socket 事件也无法绕过密码。

### 阶段 9：部署、重置与验收

目标：安全切换到不兼容的新数据模型。

- [ ] 更新 `.env.example`。
- [ ] 更新 `docker-compose.yml`。
- [ ] 移除旧身份和管理员配置说明。
- [ ] 生成并安全保存 `ROOM_PASSWORD_KEY`。
- [ ] 停止旧服务。
- [ ] 备份旧数据库和头像。
- [ ] 执行一次性全量 reset/migrate。
- [ ] 本机初始化首个管理员。
- [ ] 启动服务并验证 schema 版本。
- [ ] 验证管理员登录和普通公开注册。
- [ ] 验证游客及游客升级。
- [ ] 验证带密码房间完整测试矩阵。
- [ ] 验证旧 Cookie 返回未认证且不会创建用户。
- [ ] 在桌面和移动端完成 UI 验收。
- [ ] 更新架构、数据流、部署和开发文档。
- [ ] 在 2 GiB LXC 中以单并发完成类型检查、测试和构建。

完成标准：新系统可部署、可初始化、可回滚到备份，且安全不变量和测试矩阵全部通过。

## 18. 总体验收清单

### 账号

- [ ] 用户可以通过用户名和密码注册。
- [ ] 用户可以通过用户名和密码登录并找回账号数据。
- [ ] 用户不再看到或保存随机账号 ID。
- [ ] 游客可以使用系统并原地升级账号。
- [ ] 用户名大小写规则与数据库唯一约束一致。
- [ ] 退出、改密、重置和删号都能撤销会话。
- [ ] 首个管理员只能在服务器本机初始化。
- [ ] 普通公开注册不会产生管理员。

### 房间

- [ ] 房主可以免密进入自己的房间。
- [ ] 所有非房主首次进入带密码房间必须提供当前正确密码。
- [ ] 历史成员不能免密。
- [ ] 房间管理员不能免密。
- [ ] 服务器管理员不能免密。
- [ ] 正确验证后可在 5 分钟内安全重连。
- [ ] 改密后旧重连授权立即失效。
- [ ] 改密不影响当前在线成员。
- [ ] 只有房主能查看、修改或移除密码。
- [ ] 永久房间重启后仍执行相同门禁规则。

### 安全与运维

- [ ] 账号密码只保存哈希。
- [ ] 房间密码只保存认证加密密文。
- [ ] token 只保存哈希。
- [ ] 登录和房间密码请求均有限速。
- [ ] 生产环境必要密钥缺失时拒绝启动。
- [ ] 数据重置只能显式执行。
- [ ] 所有关键链路有自动化测试。
- [ ] 2 GiB LXC 中构建和测试不会因并发导致 OOM。

## 19. 实施约束

- 每个阶段应保持可编译，并尽量保持可运行。
- 数据 reset 之前可以使用新旧代码的短期开发适配，但不得发布双重身份安全边界。
- 不为旧随机账号增加长期兼容代码，因为已明确选择全量重置。
- 不以客户端 UI 限制替代服务端授权。
- 不允许 Controller、路由和 repository 各自复制用户名、会话或房间门禁规则。
- 所有密码、token、密钥和平台 Cookie 均不得写入日志。
- 在当前 2 GiB LXC 中，依赖安装、测试、类型检查和构建默认单并发执行。
