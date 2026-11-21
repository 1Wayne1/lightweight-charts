# 自托管开发环境

当前部署内容是同步服务的健康检查骨架和 PostgreSQL 初始表结构。API 尚未连接数据库，也没有登录、读写或同步接口。容器健康只代表进程存活，不代表云同步已可用。

## 启动

需要 Docker Engine / Docker Desktop 和 Compose v2。在仓库根目录运行：

```bash
cp deploy/terminal/.env.example deploy/terminal/.env
# 编辑 .env，填入独立生成的 POSTGRES_PASSWORD
docker compose --env-file deploy/terminal/.env -f deploy/terminal/compose.yaml config --quiet
docker compose --env-file deploy/terminal/.env -f deploy/terminal/compose.yaml up -d --build
curl http://127.0.0.1:8080/health/live
curl http://127.0.0.1:8080/v1/capabilities
```

数据库通过命名卷持久化，不向宿主机暴露端口。API 默认只绑定宿主机回环地址。后续实现鉴权和用户隔离后，再通过带 HTTPS 的反向代理供多设备访问；客户端将允许配置自托管服务 URL。

`001-initial.sql` 仅在数据库卷为空时由 PostgreSQL 自动执行。它是初始迁移，不是后续升级机制；新增迁移前需实现版本记录、迁移命令及备份恢复验证。不要通过删除卷应用数据库变更。

停止服务但保留数据：

```bash
docker compose --env-file deploy/terminal/.env -f deploy/terminal/compose.yaml down
```

## 备份和恢复演练

```bash
docker compose --env-file deploy/terminal/.env -f deploy/terminal/compose.yaml exec -T postgres pg_dump -U terminal -d terminal -Fc > terminal-backup.dump
```

备份应放在仓库外并限制访问权限。恢复演练应针对独立的空数据库，使用 `pg_restore` 验证数据和表约束。正式多端同步上线前需补齐服务就绪检查、数据库连接、事务写入、迁移执行器、鉴权、速率限制和 HTTPS 部署示例，不能把当前骨架直接视为生产同步服务。
