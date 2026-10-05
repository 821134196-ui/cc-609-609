# 港口船员登离轮身份核对与岸上通行系统

船员登岸 / 返船按**航次**管理：代理提交本航次名单，船梯口核验证件并扫码登记登岸、返船；值守页实时显示照片、证件尾号与未返船人员；船长确认本航次**实际人员**全部返船后才能办理离港。

技术栈：TypeScript + NestJS + React + Prisma + SQLite（扫码接口本地模拟）。

## 一条命令启动

```bash
npm start
```

该命令会：安装全部依赖（npm workspaces）→ 执行 Prisma 迁移 → 写入种子数据（示例航次 `V2026-1001` / 远洋号，5 名船员）→ 同时启动后端与前端。

- 前端：http://localhost:5173 （代理 `/api` 到后端）
- 后端：http://localhost:3001/api

后续启动可用 `npm run dev`（跳过安装与建库）。重置演示数据：删除 `server/prisma/dev.db` 后执行 `npm run db:setup`。

## 运行验证（e2e 测试）

```bash
npm test
```

5 组测试覆盖需求要求的全部验证点（使用独立的 `test-e2e.db`，不影响演示数据）：

1. **换班后的权限**：提交新版名单后，被换下人员扫码 `NO_PERMISSION` 拒绝，留任与新上人员正常通行；名单版本历史可查。
2. **晚返船名单**：离线产生、延迟补传的返船记录按 `occurredAt` 归位（乱序补传状态仍正确），晚返船记录不丢失。
3. **离线重复补传**：同一事件号重复补传 / 重复扫码返回 `DUPLICATE`，全航次仅一条有效返船记录，同一人不会被算两次返船。
4. **离港确认对应本航次实际人员**：有人未返船时 409 并返回具体未返船名单（不是只看人数）；确认快照 = 生效名单的实际人员（不含被换班换下者）；离港后扫码 `VOYAGE_CLOSED`。
5. **证件遗失**：暂停后扫码 `MEMBER_SUSPENDED`，暂停未归者阻塞离港，状态处理（补办/找回）后恢复通行。

## 关键设计

- **人员状态推导而非计数**：每名船员的在船/登岸状态 = 本航次「已接受」事件中 `occurredAt`（事件发生时间）最新一条的方向。因此重复补传不会重复计数，离线乱序补传也不会把状态算错。
- **事件号幂等去重**：`PassEvent.eventNo` 全局唯一。重复提交（离线补传、网络重试、重复扫码）返回 `DUPLICATE` 及首次处理结果，不新建记录。
- **名单版本即权限**：扫码时按航次**当前生效名单**校验。临时换班提交新版本后旧版本 `SUPERSEDED`，旧名单人员通行权限立即失效；被换下且仍在岸上的人员在值守页单独警示。
- **离港确认快照**：确认时把生效名单实际人员（memberId / 姓名 / 证件尾号 / 状态）写入 `DepartureConfirmation.snapshot`，航次置为 `DEPARTED`，此后扫码一律拒绝；确认记录可查询。
- **证件遗失**：`SUSPENDED` 状态扫码拒绝，直至「解除暂停」（证件找回/补办）恢复通行。

## 页面

| 页面 | 说明 |
| --- | --- |
| 航次列表 `/` | 新建航次、进入航次 |
| 值守页 `/v/:id/watch` | 照片、证件尾号、在船/未返船状态（4 秒自动刷新）、证件遗失暂停/解除、未返船与换班警示 |
| 船梯口扫码 `/v/:id/gate` | 模拟扫码（选船员/方向/发生时间）；**离线模式**暂存本地后批量补传；「重发上一事件」验证去重 |
| 代理名单 `/v/:id/agent` | 提交新版名单（可基于当前名单修改做换班）、版本历史与每版人员查询 |
| 通行记录 `/v/:id/events` | 按方向/结果/证件号查询通行记录（含离线补传来源、拒绝原因） |
| 离港确认 `/v/:id/departure` | 未返船名单、船长确认办理离港、确认记录与人员快照 |

## 主要 API（前缀 `/api`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/voyages` | 新建航次 |
| POST | `/voyages/:id/lists` | 提交新版名单（旧版本失效） |
| GET | `/voyages/:id/lists` `/lists/:version` | 名单版本历史 / 某版人员 |
| POST | `/scan` | 扫码登记（`eventNo` 幂等去重） |
| POST | `/scan/batch` | 离线批量补传（逐条独立处理） |
| GET | `/voyages/:id/status` | 值守状态板（含未返船、换班警示） |
| GET | `/voyages/:id/events` | 通行记录查询 |
| POST | `/members/:id/suspend` `/resolve` | 证件遗失暂停 / 解除 |
| POST | `/voyages/:id/confirm-departure` | 船长离港确认（409 返回未返船人员） |
| GET | `/voyages/:id/confirmations` | 离港确认记录（含人员快照） |

## 目录结构

```
├── package.json          # npm workspaces；npm start 一条命令启动
├── server/               # NestJS + Prisma + SQLite
│   ├── prisma/           # schema、迁移、seed（示例航次）
│   ├── src/              # voyage/scan/member 服务与控制器
│   └── test/             # e2e 测试（npm test）
└── client/               # React + Vite
    └── src/pages/        # 值守页 / 船梯口 / 代理名单 / 通行记录 / 离港确认
```
