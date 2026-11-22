# 单容器自托管部署与迁移（SQLite）

采用**单个 Docker 容器**同时托管构建后的 Web 看盘界面、同步 API 和内置 SQLite 数据库（Node 24 `node:sqlite`，WAL 模式），宿主机只需持久化一个数据目录（`terminal.db`）。面向个人单用户使用，通过 `SYNC_TOKEN` 访问口令保护同步和备份接口。

## 首次启动（服务器或本机电脑通用）

需要 Docker Engine / Docker Desktop 和 Compose v2。在仓库根目录运行：

```bash
cp deploy/terminal/.env.example deploy/terminal/.env
# 编辑 deploy/terminal/.env，填入随机生成的 SYNC_TOKEN（至少 8 位，例如 openssl rand -hex 24）
mkdir -p deploy/terminal/data
docker compose --env-file deploy/terminal/.env -f deploy/terminal/compose.yaml config --quiet
docker compose --env-file deploy/terminal/.env -f deploy/terminal/compose.yaml up -d --build
```

验证存活与数据库就绪：

```bash
curl http://127.0.0.1:8080/health/live
curl http://127.0.0.1:8080/health/ready
curl http://127.0.0.1:8080/v1/capabilities
```

浏览器打开 <http://127.0.0.1:8080>（或你的 HTTPS 域名），点击右下角状态栏「云同步未启用」（手机端在底部「⋯ → 云同步与数据迁移」），服务地址留空（自动使用当前地址）并填入 `.env` 中的 `SYNC_TOKEN` 即可启用多端同步。

> 公网服务器部署时，建议保持 `SYNC_BIND=127.0.0.1`，外层使用 Caddy / Nginx 等反向代理提供 HTTPS；仅在受信任的家庭局域网直连（例如手机 Safari 访问电脑）时可改为 `SYNC_BIND=0.0.0.0`。若 Linux 宿主机出现 `./data` 权限不足，执行 `chown -R 1000:1000 deploy/terminal/data`。

## 本地开发运行同步服务（不依赖 Docker）

只要配置过 `deploy/terminal/.env`（填入 `SYNC_TOKEN`），直接运行即可自动读取该 `.env` 并把数据库存在 `deploy/terminal/data/terminal.db`（与 Docker 共用同一份配置和数据）：

```bash
pnpm dev:sync
```

也可以通过环境变量临时指定：

```bash
SYNC_TOKEN=your-local-dev-token DB_PATH=./deploy/terminal/data/terminal.db pnpm dev:sync
```

然后在 Vite 开发页面（`pnpm dev:terminal`）的同步弹窗中将服务地址设为 `http://127.0.0.1:8080`（手机端填电脑局域网 IP）并填入同一口令即可联调。

## 服务器关机 ↔ 迁回电脑使用

### 情况 1：服务器临时关机

无需手动迁移。客户端已将全量状态与待同步队列保存在本机，服务器离线期间照常看盘、画线、改周期；等服务器重新开机后自动补推同步。

### 情况 2：正常关机前把数据迁到电脑（推荐：单文件 SQLite 热备）

1. 在网页「云同步与数据迁移」弹窗点击**「下载 SQLite 备份 (.db)」**（或命令行调用热备接口）：

   ```bash
   curl -H "Authorization: Bearer $SYNC_TOKEN" http://127.0.0.1:8080/v1/backup/sqlite -o terminal.db
   ```

2. 将下载的 `terminal.db` 放到电脑的 `deploy/terminal/data/terminal.db`，启动电脑上的容器或 `pnpm dev:sync` 即可完整接管（`store_id` 保持不变，手机把同步地址切到电脑局域网 IP 即可继续同步）。
3. 以后服务器重新开机时，同样从电脑下载最新 `terminal.db` 拷回服务器覆盖即可无缝切回。

> 注意：请勿在容器运行中直接复制宿主机 `data/terminal.db` 而遗漏 `-wal`/`-shm` 文件。如需直接拷贝文件，请先执行 `docker compose --env-file deploy/terminal/.env -f deploy/terminal/compose.yaml down` 停止容器。

### 情况 3：服务器已意外关机，来不及拷贝 `.db`

直接点击电脑端网页的**「导出本机 JSON 快照」**，在电脑本地启动一个空 SQLite 容器，然后在同步弹窗将服务地址切到电脑本地地址：

- 客户端会自动识别到 `store_id` 变化，弹窗提示选择**「以本机覆盖服务端」**（或手动「导入 JSON 快照」），即可零数据丢失在电脑上继续运行。

## 停止与升级

停止服务但保留宿主机 `data/terminal.db`：

```bash
docker compose --env-file deploy/terminal/.env -f deploy/terminal/compose.yaml down
```

数据库迁移由服务端在启动时按 `services/sync-api/migrations/` 顺序自动执行并记录在 `schema_migrations` 表中；升级镜像前请先下载一份 `.db` 备份，不要通过删除数据目录升级。不要将 `.env`、`SYNC_TOKEN` 或 `.db` 备份提交到 Git 仓库。
