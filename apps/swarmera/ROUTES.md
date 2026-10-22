# 网址清单

所有地址都以 `https://strgo.com/swarmera` 为前缀。以下路径具有各自的目录 `index.html`，支持直接访问、刷新、新标签与原生链接。

| 相对应用路径 | 内容 |
|---|---|
| `/` | 女皇 / 开道 / 裂隙三种首页构图 |
| `/queen/` | 女皇模型与四项动作 |
| `/mechs/` | 四型目录与小规模编队 |
| `/mechs/breaker/` | 破阵镰虎：行进与开道 |
| `/mechs/bulwark/` | 巢卫重装：护盾展开 |
| `/mechs/siege/` | 裂壳攻城：部署、蓄能、后坐 |
| `/mechs/razorwing/` | 镰翼空袭：盘旋与俯冲 |
| `/world/` | 三维地图与三个章节 |
| `/world/fallen-city/` | 陨落之城：战前与侵袭切换 |
| `/world/rift-gate/` | 裂隙之门：开合、密度、穿越 |
| `/world/hive-origin/` | 虫巢起源：器官与管线脉冲 |
| `/factions/` | 三阵营与动态并排比较 |
| `/factions/swarm/` | 虫巢意志：女皇与虫群集结 |
| `/factions/defenders/` | 文明防线：护盾与炮火 |
| `/factions/symbiotes/` | 共生议会：机械与生物构件显隐 |
| `/characters/` | 女皇与四型机甲统一目录 |
| `/showcase/` | 选择、移动、发射、命中、分享与 JSON |
| `/media/trailer/` | 42 秒实时三维演示，无 CG 视频 |
| `/news/` | 三篇实际概念文章与类型筛选 |
| `/news/queen-arrival/` | 女皇降临记录 |
| `/news/mech-fusion/` | 机甲融合档案 |
| `/news/rift-log/` | 裂隙事件报告 |
| `/community/` | 三个示例主题 |
| `/community/first-arrival/` | 初次降临、本地草稿 |
| `/community/favorite-mech/` | 最喜欢的机甲、本地草稿 |
| `/community/battlefield-shot/` | 战场镜头、本地草稿 |
| `/reserve/` | 本地体验意向，非线上预约 |
| `/search/?q=女皇` | 中英文真实条目搜索 |

未知地址及 ID 返回应用独立的 404，并提供首页与角色目录链接。`/swarmera` 在 Nginx 中 308 到 `/swarmera/`，保留查询参数。

查询参数：`scene` / `preset` 为 `descent`、`advance`、`rift`；`unit` 使用模型 ID 白名单；`lang` 为 `zh-CN` 或 `en`；`seed` 为有效的有限整数。复杂配置通过小于 16KB 的版本 1 JSON 导入导出，导入不执行代码。
