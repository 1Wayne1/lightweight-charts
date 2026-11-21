# 项目开发约定

## 产品目标

构建类似 TradingView 使用体验的多端加密货币看盘工具，目标平台为 macOS、Windows、iOS。支持多标签页，每个交易对独立周期；画线和周期绑定交易对，通过可用 Docker 部署的自托管服务跨设备同步。

这是 Lightweight Charts 源码仓库上的应用开发。先阅读 [项目说明](docs/terminal/README.md)、[架构设计](docs/terminal/architecture.md) 和 [路线图](docs/terminal/roadmap.md)。当前进入 M1：桌面 / 手机 Web 界面、本机设置、Binance USDT 现货 / 永续真实行情、应用画线集成与本机保存、服务骨架已实现；iPhone Safari 真机验证、云同步和原生安装包尚未完成。报告状态时区分规划、实现、构建通过和实机验证。

## 目录与技术边界

- `apps/terminal-web/`：Vite + TypeScript 共享界面、图表生命周期、数据源与存储适配器。
- `apps/terminal-native/`：规划中的 Tauri 2 原生封装；macOS、Windows、iOS 共享 Web 业务实现。
- `packages/terminal-domain/`：无 DOM、无 UI 框架和数据库依赖的领域模型、状态转换与同步契约。
- `services/sync-api/`：Node.js 自托管 API 与 PostgreSQL 迁移。
- `deploy/terminal/`：Docker Compose、环境变量模板和部署说明。
- `packages/lwc-plugin-drawing-tools/`：已有画线插件，优先通过适配器复用。
- 根目录 `src/`、`packages/lwc-toolkit/` 等为图表引擎与上游基础设施。业务功能优先放在应用/插件层，必要的引擎改动应有独立理由和回归验证。

沿用 pnpm workspace、严格 TypeScript、现有 Node.js 版本约束和锁文件；不引入第二套包管理器。应用包使用 `@terminal/*` 且保持 private，不把应用代码纳入图表库发布包。新增框架、数据库或原生方案时同步更新架构文档。

## 不能破坏的业务约束

1. 交易对身份必须包含交易所、市场类型和标准化交易对，例如 `binance:spot:BTC-USDT`。服务端再以认证账户隔离，现货和合约不能混用设置。
2. V1 同一交易对只打开一个标签页；重复打开聚焦已有标签页。每个标签页读取所属交易对周期，禁止全局唯一可变周期污染其他标签页。支持同交易对多开前先引入独立 `viewId`。
3. 关闭标签页不删除交易对偏好与画线。标签顺序、活动标签属于本机视图，周期与画线属于云端持久化对象。
4. 切换交易对/周期必须取消旧请求，解除旧订阅或销毁图表。异步结果按交易对、周期或请求版本核对，不能覆盖新的活动图表。
5. 画线存时间与价格锚点，不能存屏幕像素或仅存插件 logical 索引。未来空白区、历史补齐和跨周期重投影必须经过适配器和测试。
6. 市场数据统一 UTC Unix 秒、按时间排序并去重。交易所 REST/WebSocket 差异留在 provider 内；不得将演示行情伪装为真实行情。
7. 持久化格式含 schemaVersion，外部 JSON 必须运行时校验。修改格式时提供兼容读取或迁移策略，不能直接丢弃用户画线。
8. 云同步写入采用服务端 revision、baseRevision 乐观并发和 mutationId 幂等；删除保留墓碑。冲突不允许静默整份覆盖，本机时间戳不能决定胜负。
9. 离线修改先持久化，再入队同步；服务端确认后才能显示已同步。本机保存与云端同步状态必须分开。
10. 同步接口必须校验身份、对象归属和请求数据；不能信任客户端传入的 userId。令牌不写日志、不提交仓库、不嵌入前端构建产物。保留 LICENSE、NOTICE 和用户可见的 TradingView 归属链接。

## 开发命令

在仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm build:prod
pnpm dev:terminal
pnpm dev:sync
pnpm typecheck:terminal
pnpm test:terminal
pnpm lint:terminal
pnpm build:terminal
```

首次启动前运行 `pnpm build:terminal`，准备图表库、绘图插件和应用产物。修改应用后运行相关类型检查、测试、lint 和构建；`pnpm build:terminal` 会先构建图表库。Docker 命令及变量说明见 [部署文档](deploy/terminal/README.md)。不要提交 `.env`、令牌、数据库备份或生成的原生/前端构建产物。

代码遵循相邻文件和 `.editorconfig`；TypeScript 使用明确的领域类型，避免 `any`。时间、交易对键、状态转换和并发规则在领域层集中定义，不能在 UI 中各写一套。交互层提供可访问标签、错误状态、空状态和触摸友好布局。

手机使用独立的自选表 / 图表两页导航，不照搬桌面侧边栏，也不增加未实现的导航入口。交易对长按浮窗只在松手后提交切换，取消手势不能改动当前交易对；手机和桌面共用交易对偏好。Binance 合约当前指 USDT 本位永续，不能把币本位或交割合约映射为同一个身份；合约 K 线和 ticker 使用 `/market` WebSocket 路径。响应式断点保持 CSS / TypeScript 一致，横竖屏均保留安全区与可用图表面积。

## 验证与交付

- 状态逻辑改动至少验证不同交易对周期隔离、关闭/重开恢复、重复打开及非法持久化数据。
- 行情改动验证请求乱序、断线重连、去重和资源清理；不要依赖实时交易所网络作为唯一测试数据。
- 画线改动验证序列化往返、跨周期、未来锚点、历史补齐和删除恢复规则。
- 同步改动验证双客户端读写、账户隔离、离线重试、重复 mutation、并发冲突和墓碑。
- 数据库改动新增迁移，不通过删库或删除 Docker 卷升级；验证持久卷和备份恢复。
- UI 改动检查桌面和窄屏；原生支持必须在对应平台构建/设备上验证。环境缺少 Docker、Xcode、Windows 构建环境或凭据时，明确说明未执行项。
- 修改上游图表核心时补跑相关原有测试与构建；纯应用改动保持独立，不顺带重构图表引擎。
- 交付说明写清实现内容、验证结果和剩余里程碑；用户未要求时不自行提交或推送 Git。
