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

## 使用 `docker run` 部署（含 Unraid 模板）

### 1. 构建镜像

在服务器（如 Unraid 终端）拉取仓库并在仓库根目录构建镜像：

```bash
docker build -f services/sync-api/Dockerfile -t crypto-terminal:latest .
```

> 若在 Apple Silicon Mac 上构建镜像再导入 x86_64 Unraid，可使用：
> `docker buildx build --platform linux/amd64 -f services/sync-api/Dockerfile -t crypto-terminal:latest --output type=docker,dest=crypto-terminal.tar .`
> 传到 Unraid 后执行 `docker load -i crypto-terminal.tar`。

### 2. 直接使用 `docker run` 启动

```bash
mkdir -p /mnt/user/appdata/crypto-terminal
chown -R 99:100 /mnt/user/appdata/crypto-terminal

docker run -d \
  --name crypto-terminal \
  --restart unless-stopped \
  --init \
  --user 99:100 \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=128m,mode=1777 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  -p 8080:8080 \
  -v /mnt/user/appdata/crypto-terminal:/data \
  -e SYNC_TOKEN="请替换为至少8位随机口令" \
  -e CORS_ORIGIN="*" \
  -e MARKET_PROXY_URL="" \
  crypto-terminal:latest
```

> - 若在普通 Linux 服务器上运行，可将 `--user 99:100` 改为 `--user 1000:1000` 并把挂载目录改为宿主机目录（如 `./data:/data`）。
> - Unraid 若配置了独立缓存盘，建议将挂载路径改为 `/mnt/cache/appdata/crypto-terminal:/data`（或把 `appdata` 设为 Exclusive Share），可避免 FUSE 层对 SQLite WAL 文件锁的影响。
> - 如果 Unraid 所在网络需要代理才能连 Binance，把 `MARKET_PROXY_URL` 填为局域网或旁路由 HTTP 代理（如 `http://192.168.1.2:7890`）；海外服务器或已有透明代理时留空即可。

### 3. 导入 Unraid Docker 图形化模板

仓库已内置 Unraid 模板文件 `deploy/terminal/unraid/my-crypto-terminal.xml`，复制到 Unraid 模板目录即可在 WebUI 图形化管理：

```bash
cp deploy/terminal/unraid/my-crypto-terminal.xml /boot/config/plugins/dockerMan/templates-user/my-crypto-terminal.xml
```

复制后打开 Unraid WebUI → **Docker** → **Add Container** → 在顶部 **Template** 下拉列表选择 **`crypto-terminal`**，填入 `SYNC_TOKEN`（以及可选的 `MARKET_PROXY_URL`）点击 **Apply** 即可启动。

## 手机通过电脑或服务器查看 K 线与画线（内置行情中继）

一体化服务默认内置 **Binance REST + WebSocket 行情中继**（`/v1/market/binance/*`），前端默认采用「通过当前服务转发」，因此手机打开电脑或服务器地址时，**K 线和画线均由所连服务端发出，手机不需要单独开代理**：

- **场景 A：海外 Docker 服务器（HTTPS）**
  - 按上方步骤启动容器即可，服务端直接访问 Binance 公开行情；手机打开你的 HTTPS 域名并在「设置 → 存储服务」填入 `SYNC_TOKEN` 后，画线与 K 线均由服务器提供。
- **场景 B：家里电脑 + 手机局域网看盘（复用电脑代理，如 Clash 7890）**
  - 在 `deploy/terminal/.env` 配置：

    ```bash
    SYNC_TOKEN=你的随机口令（至少8位）
    SYNC_BIND=0.0.0.0
    SYNC_PORT=8080
    MARKET_PROXY_URL=http://127.0.0.1:7890
    ```

  - 在仓库根目录运行 `pnpm --filter @terminal/sync-api start`（或 Docker 启动），手机浏览器访问 `http://<电脑局域网IP>:8080`，在「设置 → 存储服务」填入同一 `SYNC_TOKEN` 即可免代理看盘并同步画线。

## 本机单服务直接运行（不依赖 Docker，默认启用本机存储）

无需配置 `.env` 或单独启动存储服务，在仓库根目录任选以下一条命令即可同时启动前端界面和本机 SQLite 存储（默认数据文件仍为 `deploy/terminal/data/terminal.db`，与 Docker 完全共用）：

```bash
# 方式 A：开发模式（热更新 + 内嵌本机 SQLite，访问 http://127.0.0.1:5173）
pnpm dev:terminal

# 方式 B：生产静态构建 + 内嵌本机 SQLite（先执行一次 pnpm build:terminal，访问 http://127.0.0.1:8080）
pnpm start:terminal
```

打开页面后会自动连接本机内置 SQLite 存储，无需填写服务地址或访问口令；如需连接远程 Docker 同步服务或导出备份，进入界面「设置 → 存储服务 / 数据导入导出」即可切换。

如需单独以口令保护模式运行同步服务（例如供局域网手机连接），可配置 `deploy/terminal/.env`（填入 `SYNC_TOKEN`）后执行：

```bash
pnpm dev:sync
```

也可以通过环境变量临时指定：

```bash
SYNC_TOKEN=your-local-dev-token DB_PATH=./deploy/terminal/data/terminal.db pnpm dev:sync
```

然后在页面「设置 → 存储服务 → 自定义远程存储服务」中填入服务地址（如 `http://127.0.0.1:8080` 或局域网 IP）和同一口令即可联调。

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
