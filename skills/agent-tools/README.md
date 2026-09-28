# Agent 工具集 Skill

此 Skill 承载旧 Agent 的工作目录工具。`skill.json` 定义 39 个能力及调用风险；`index.py` 是 Skill 运行入口；`engine.py` 提供文件、Git、代码、文档和诊断工具的实现。两个 Python 文件都可在 Skills 页面编辑并进行语法编译校验，保存后重新加载到 Agent Core。

文件搜索支持字面量或正则、路径匹配和分页，并报告扫描截断；`read_files` 可批量读取。测试工具自动识别 Node 原生测试、Vitest、Jest 和 pytest。`pdf_ocr` 依赖本机 Poppler 与 Tesseract。现有 DOCX 支持在单个文本片段内唯一替换，现有 XLSX 支持修改已存在的非公式单元格；这两种编辑都会预览并核对原文件版本。

写入文件、运行命令、调用本机 HTTP 服务和联网等操作需要在 Agent Core 工作台逐次批准。工作流与定时任务按配置的无人值守权限执行：默认拒绝需确认操作，标准或自主模式允许写入，完全控制模式允许全部操作。
