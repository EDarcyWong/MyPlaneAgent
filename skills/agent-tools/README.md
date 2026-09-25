# Agent 工具集 Skill

此 Skill 承载旧 Agent 的工作目录工具。`skill.json` 定义 35 个能力及调用风险；`index.py` 是 Skill 运行入口；`engine.py` 提供文件、Git、代码、文档和诊断工具的实现。两个 Python 文件都可在 Skills 页面编辑并进行语法编译校验，保存后重新加载到 Agent Core。

写入文件、运行命令、调用本机 HTTP 服务和联网等操作需要在 Agent Core 工作台逐次批准。工作流与定时任务按配置的无人值守权限执行：默认拒绝需确认操作，标准或自主模式允许写入，完全控制模式允许全部操作。
