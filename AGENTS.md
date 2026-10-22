# STRGO Web 项目入口

开始本仓库任务时，先查看 [开发文档索引](doc/README.md)；开发环境、目录归属和验证方法见 [开发指南](doc/DEVELOPMENT.md)。

## 仓库技能

技能统一维护在 `codex/skills/`，入口见 [技能索引](codex/README.md)。根据任务按需读取：

- 开发、构建、集成或排错：`codex/skills/strgo-development/SKILL.md`。
- 项目 review、验收与审查文档：`codex/skills/strgo-review/SKILL.md`。

用户直接提到上述技能名称或文件路径时，读取对应 `SKILL.md` 后执行。无需一次加载全部专题文档。

## 文档维护

新增开发文档放入 `doc/`，新增项目技能放入 `codex/skills/<技能名>/SKILL.md`，同步更新各自索引。已有根目录和应用目录的专题文档由索引链接，迁移文件时同时修正引用。

统一仓库以根目录 `README.md`、`DEPLOYMENT.md` 和 `doc/DEVELOPMENT.md` 的路径为准；历史交付记录中的 `/root/strgo-homepage`、相邻独立工程路径及旧上线状态仅作历史背景。
