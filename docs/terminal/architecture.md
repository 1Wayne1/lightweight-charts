# 架构与数据约定

## 技术选择

沿用 pnpm workspace，在已有图表库仓库内增加应用层。首个 Web 骨架使用 Vite + 严格 TypeScript，暂不引入 UI 框架；交互复杂度增加时可在应用层引入 React 等框架，领域包不随框架变化。Tauri 2 是 macOS、Windows、iOS 的统一原生封装方向，目前未初始化原生工程。

后端选择 Node.js + SQLite（Node 24 内置 `node:sqlite`，开启 WAL 模式），以单容器 Docker Compose 自托管：同一个容器同时托管构建后的前端静态页面、同步 API 和持久化在宿主机目录的单个 `terminal.db`。面向个人单用户自托管，使用单人访问口令（`SYNC_TOKEN` + Bearer Token 常量时间校验）保护同步与备份接口，不维护多用户注册体系。行情和用户同步数据分离，数据库只存交易对周期、画线（含墓碑）、指标/常用周期/画线默认样式等偏好以及同步幂等元数据，不存全部市场 K 线。

## 手机界面与交互

手机界面由 `mobile.ts` / `mobile.css` 提供独立的自选表和图表页，只呈现两个导航入口。宽度不超过 760px，或宽度不超过 1100px 且高度不超过 600px 时使用手机布局，覆盖横屏手机；CSS 与 TypeScript 使用相同断点。横屏合并操作栏与导航，保留系统安全区。

图表实例、行情请求和交易对偏好与桌面共用，手机不另存一套周期。`HoldSwitcher` 是不依赖 DOM 的手势状态机：按住后预选，抬手才提交，提前滑动或系统取消不切换。浮窗、底部面板和页面选择仅为临时 UI 状态，不进入云同步数据。旋转只调整布局，不重建工作区或清除交易对设置。

## 交易对身份与标签页隔离

交易对的业务键为 `venue:market:symbol`，例如 `binance:spot:BTC-USDT` 和 `binance:perpetual:BTC-USDT` 是不同交易对。账户数据还必须以 `userId` 隔离，不能只使用 `BTCUSDT` 作为全局键。

V1 每个工作区对同一交易对只保留一个标签页，重复打开时聚焦已有标签页。每个标签页指向自己的交易对偏好，周期保存在偏好内；修改 BTC 周期不会修改 ETH。关闭标签页只关闭视图，不删除偏好或画线。若以后允许同一交易对多开不同周期，引入 `viewId` 保存独立视图，同时保留交易对默认周期，不能直接复用一份可变周期状态。

标签顺序、活动标签和临时缩放位置目前属于本机工作区状态；用户要求的周期和画线属于需要跨设备同步的交易对数据。后续可单独增加工作区布局同步，避免把全部工作区作为一个 JSON 文档覆盖。

当前只创建活动标签的图表实例；切换或关闭时销毁实例并取消请求，后台标签保留业务状态。请求完成后还需验证当前渲染版本，防止旧请求把 BTC 行情写进已切换的 ETH 图表。接入 WebSocket 时使用交易对 + 周期订阅键，销毁视图必须解除订阅。

## 行情适配

当前应用使用 `BinanceProvider`，按 `spot` / `perpetual` 分开请求与订阅，只接入 USDT 现货和 USDT 本位永续。REST 提供 exchangeInfo 交易对目录、价格 tickSize、历史 K 线及 24h ticker；WebSocket 提供活动图表 K 线和每类市场一个组合 ticker 流。合约 K 线 / ticker 使用 `/market/stream` 路径。`mock-provider.ts` 只保留为演示开发源，正常界面不回退到模拟数据。

`Candle` 含基础币成交量。解析层检查 OHLC、成交量、时间戳并排序去重；状态层按事件时间及累计成交量拒绝旧消息。`startCandleFeed` 在加载快照期间缓冲实时事件，重连从最后 K 线向前分页补齐，再合并缓冲。重试包含超时、指数退避和 Retry-After 冷却，停止后迟到结果不能触及图表。向左浏览采用独立历史分页，前插后平移逻辑可见范围保持位置。

指标历史全量计算，当前 K 线使用上根已完成 K 线状态增量计算 EMA / MACD；调用公开 `series.update` 更新末根，不在每次推送重设可见范围。自选报价按最多每 400ms 刷新 DOM，避免交易所推送频率直接重建手机列表。

指标设置的 schemaVersion 2 增加可选持久化字段 `hidden` 与 `legendCollapsed`；兼容读取缺少这两个字段的旧配置，默认全部可见并展开。启用 / 移除与曲线显隐分开：隐藏只修改 series 的 visible，保留副图、参数与图上恢复入口；收起只控制信息行，主副图共用一个状态。信息数值读取已有 series 对应时间点，沿用指标计算结果，行情更新仅更新文字而不重建按钮。

时间统一使用 UTC Unix 秒，进入图表前按时间排序并去重，毫秒只在适配器入口转换。断线后要重连并补齐缺口，取消旧请求，避免重复 K 线。行情密钥如有需要由安全的配置/服务代理管理，不能作为 `VITE_*` 变量打入前端。

## 画线持久化

应用通过 `DrawingSession` 使用 `@tradingview/lwc-plugin-drawing-tools` 的 `DrawingManager`、`exportState()`、`importState()` 和销毁接口，已接入现有基础与扩展工具。适配器负责时间与价格锚点、本机存储和运行时校验，领域包的 `DrawingDocument` 继续使用稳定工具 ID。

工具栏属于应用层：`drawings/catalog.ts` 定义 TradingView 风格的组 / 小节及顺序，并与插件已注册工具取交集；`drawings/toolbar.ts` 负责桌面侧栏和浮动菜单，手机面板复用同一目录。分组最近使用项、菜单、光标与连续绘图属于临时交互状态，不修改持久化格式。全局锁定和批量删除通过一次快照变更进入已有撤销历史，删除保留已锁定对象，并由原有存储适配器生成墓碑。

`drawings/property-profile.ts` 按当前渲染器实际支持的属性定义操作栏能力，`drawings/properties.ts` 负责快捷弹层、对象右键菜单与设置页签；尚未支持的模板、警报、周期可见性等不显示。设置表单持有独立草稿，确定时通过 `DrawingManager.updateDrawing()` 原子提交样式与坐标并记录一次撤销。UTC 坐标经会话的 `DrawingTimeScale.project()` 转为插件锚点；弹层、拖动位置和表单草稿不进入持久化格式。

云端存储每条画线的独立 ID、交易对、工具类型、时间/价格锚点、样式、schemaVersion 和服务端 revision；删除使用墓碑，不能只从数组移除。画线归属交易对，切换周期时共享画线，必要时可增加可见周期过滤。

现有插件锚点包含 `logical`，未来空白区锚点可能没有 `time`。**不能把插件原始 JSON 直接当作跨设备协议**：逻辑索引会随着历史范围、周期和数据补齐变化。适配器需转换为 UTC 时间 + 价格；无时间锚点根据原始数据边界与周期换算目标时间，跨周期恢复时重新投影到新数据的逻辑位置。必须测试未来锚点、非整根 K 线锚点和历史补齐，避免画线漂移。

## 云同步协议与单文件迁移

当前已实现基于 HTTPS/HTTP REST 的单人自托管同步与本机离线优先（Local-First）引擎：

1. 客户端在「云同步与数据迁移」弹窗配置自托管服务地址（单容器同源部署可留空自动使用当前来源）和 `SYNC_TOKEN`；令牌仅保存在本机浏览器存储中，不写日志、不提交仓库、不打入前端构建产物。
2. 本机修改始终先落盘，再写入持久化在 IndexedDB（隐私模式下自动回退 `localStorage`）的待同步队列 `outbox`，附带 `mutationId`、`deviceId`、`baseRevision`；仅在服务端确认后才显示“已同步”。服务器临时关机时客户端自动进入离线模式，继续使用本机数据并在服务端恢复后自动补推。
3. 服务端在 SQLite `BEGIN IMMEDIATE` 事务内核对 `mutationId` 幂等记录与 `baseRevision` 乐观并发版本：写入成功则递增 `revision` 并在同一事务中持久化 `sync_mutations` 响应；陈旧 `baseRevision` 返回 HTTP 409 与服务端最新版本，客户端保留冲突项由用户逐项选择“保留本机”或“采用服务端”，禁止按客户端时间戳静默整份覆盖。
4. 每个 SQLite 数据库在首次初始化时生成稳定的 `store_id` 写入 `store_meta`。将 `terminal.db` 通过在线热备（`VACUUM INTO`）迁移到电脑运行时 `store_id` 保持一致，同步无缝衔接；若切换到全新空库或旧库，客户端检测到 `store_id` 变化会停止自动覆盖，弹窗由用户明确选择“合并两端 / 以本机覆盖服务端 / 以服务端覆盖本机”。
5. 即使服务端完全离线，客户端仍支持离线导出/导入带 `schemaVersion` 校验的完整 JSON 快照（覆盖交易对周期、画线与墓碑、指标、常用周期及画线默认样式）。

当前已实现的接口职责如下（除健康检查和能力声明外均需 `Authorization: Bearer <SYNC_TOKEN>`）：

| 接口 | 职责 |
| --- | --- |
| `GET /health/live` | 进程存活检查 |
| `GET /health/ready` | SQLite 数据库连接就绪检查 |
| `GET /v1/capabilities` | 声明 API 版本、存储类型、当前 `storeId` 与静态托管能力（公开，不返回用户数据或令牌） |
| `GET /v1/snapshot`（别名 `/v1/instruments`） | 读取全部交易对偏好、画线（含删除墓碑）与共享设置快照 |
| `PUT /v1/instruments/:key/preferences` | 带 `mutationId` / `baseRevision` 的交易对周期更新 |
| `PUT /v1/instruments/:key/drawings/:id` | 单条画线的新增、修改或墓碑写入 |
| `PUT /v1/settings/:key` | 共享设置更新（`indicators` / `timeframes` / `drawing-defaults` / `watchlist` / `workspace-tabs`） |
| `GET /v1/backup/sqlite` | 通过 `VACUUM INTO` 生成并返回单个一致的 `.db` 热备份文件 |
| `POST /v1/import` | 导入 JSON 快照（`merge` 合并或 `replace` 替换） |

## 部署与兼容

Docker Compose 提供单容器服务（前端静态资源 + 同步 API + SQLite）、宿主机数据目录挂载与版本化迁移执行器（记录于 `schema_migrations`，不通过删库升级）。公网部署建议在容器外层配合 Caddy / Nginx 等反向代理提供 HTTPS，并将容器端口默认绑定至 `127.0.0.1`。

保留图表库 LICENSE、NOTICE 和用户可见的 TradingView 归属链接。应用是基于 Lightweight Charts 的独立看盘工具，不依赖 TradingView 商业 Charting Library，也不把自己标记为 TradingView 官方客户端。
