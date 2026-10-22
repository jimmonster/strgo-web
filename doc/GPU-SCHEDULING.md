# AI 与 Workflow 的中央 GPU 调度

日期：2026-10-23。适用共享Python/SQLite服务，以及本仓库本机ComfyUI连接程序。对应 [功能清单F03](FEATURE-BACKLOG.md)。

## 配置和升级

两条队列共享 `ai_leases`，在 `BEGIN IMMEDIATE` 事务中领取。Workflow任务使用 `workflow:<id>`，不会因租期超时抢锁。`LOCAL_STUDIO_RESOURCE_GROUP` 默认 `local-studio-gpu`；与AI节点共用一块GPU时，必须填写相同资源组名称。不同硬件使用不同名称。`LOCAL_STUDIO_DRAINING=1` 停止领取新Workflow任务。

升级时先排空AI节点，设置Workflow排空并等待现有任务结束，核对全部模型服务。更新账号服务与本机连接程序后再恢复队列。旧连接程序不能发送卸载确认，任务可以保存但资源锁会保留；请同步升级连接程序。已有运行中的Workflow任务在服务启动时补资源锁；存在未解决锁时禁止修改资源组名称。若升级前已出现双队列并发，先停止并核对运行任务，不能直接清空锁。

## 完成、断线和卸载

任务成功保存或执行失败均不会立即释放GPU锁。连接程序保留本机日志，先检查 `/queue` 中运行和等待列表均为空，再调用 `/free` 请求卸载模型和释放缓存，随后轮询 `/system_stats`。CUDA/XPU/NPU设备需要报告PyTorch保留及空闲缓存均为0；CPU不占GPU。未知设备、缺字段、仍有模型内存、忙队列或超时均保留锁及日志；之后只重试清理，不重发生成。

`/free` 只设置异步卸载标记，收到200并不能证明卸载完成。这一实现依据 [ComfyUI服务接口](https://github.com/Comfy-Org/ComfyUI/blob/master/server.py)、[卸载循环](https://github.com/Comfy-Org/ComfyUI/blob/master/main.py)及[内存统计定义](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy/model_management.py)，真实部署仍应固定并验证所用版本。

确认空闲后，连接程序使用原任务claim及服务端密钥发送 `/worker/jobs/{id}/release`。服务端仅允许已结束任务释放自己的锁；迟到确认无法删除下一项任务的锁。断线、服务重启、旧备份恢复及失败任务均保留未核实资源占用；不会重新派发已有任务。

## 人工恢复

若本机日志丢失、节点不再可达或未知任务无法证明结束：

1. 在AI管理页排空该资源组全部节点。
2. 设置 `LOCAL_STUDIO_DRAINING=1`，在维护窗口重启账号服务；停止该组全部AI模型和ComfyUI服务，确认进程已退出。
3. 核对任务已结束。Workflow过期任务由状态/轮询标记失败；AI未知任务按既有核对期限结算。
4. 载入服务环境并使用服务账号执行 `python -m image_service.ai_cli release-resource 资源组 --confirm-services-stopped`。命令检查终态、AI排空及Workflow排空并记录审计，不能代替人工确认进程停止。
5. 启动服务、验证连接及空闲卸载，再恢复队列。

## 验证与边界

`tests/test_gpu_scheduler.py` 竞争领取同一资源组，验证两队列只有一个赢家；覆盖成功后等待卸载、未知过期、重启、旧任务升级、排空和迟到确认。`tests/test_comfy_worker.py` 验证异步卸载、忙队列及未知统计保锁。`tests/test_workflow_http.py` 使用真实HTTP与模拟ComfyUI完成结果保存及释放。

本实现管理共用一个SQLite的两条队列，不是跨数据库的分布式节点代理。禁止其他调度器、ComfyUI页面或其他客户端绕过本系统向同一GPU提交任务。AI服务仍需按各自约定卸载模型（Ollama使用 `keep_alive: 0`，ACE-Step需配置空闲释放），第三方CUDA扩展或其他进程的显存不能仅靠PyTorch统计证明。真实显存效果、ACE-Step配置和断电恢复列入外部设备验收；未完成前保持硬件隔离或错峰。
