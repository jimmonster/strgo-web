# Codex 项目技能

本目录存放随 GitHub 仓库一起维护的项目技能。每个技能以 `skills/<技能名>/SKILL.md` 为入口，说明适用任务、项目约定和验证方法。

| 技能 | 适用任务 |
| --- | --- |
| [strgo-development](skills/strgo-development/SKILL.md) | STRGO Web 开发、构建、模块集成和排错 |
| [strgo-review](skills/strgo-review/SKILL.md) | 整仓或模块审查、风险分级、验证和审查文档 |

## 下次如何使用

在此仓库开启 Codex 会话时，根目录 [AGENTS.md](../AGENTS.md) 提供文档与技能入口；会话按任务读取相应技能。也可直接说：

> 按 strgo-development 技能修改论坛，并完成对应验证。

> 读取 codex/skills/strgo-review/SKILL.md，review 这次改动并更新 doc/PROJECT-REVIEW.md。

`codex/` 是本项目约定的存放位置，通过 `AGENTS.md` 和明确的文件路径加载；单独创建该目录不代表技能已注册到客户端技能菜单。需要菜单发现能力时，再按所用客户端支持的技能安装方式安装。相关机制见 [OpenAI 官方技能文档](https://learn.chatgpt.com/docs/build-skills) 和 [AGENTS.md 文档](https://learn.chatgpt.com/docs/agent-configuration/agents-md)。

## 新增与维护

新增 `skills/<小写英文短横线名称>/SKILL.md`，文件开头包含 YAML `name` 与 `description`。说明具体适用场景，正文记录项目特有的操作知识；详细背景链接到 `doc/`，避免复制整份文档。增加技能时同步更新本索引和需要的 `AGENTS.md` 路由。
