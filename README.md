# MyPlaneAgent

MyPlaneAgent 是一个基于 Electron、Vue 3 和 TypeScript 的 AI 桌面工作区。它把模型连接、聊天与文件任务、可视化工作流、定时任务、Python 插件和 MCP 工具放在同一个应用中。

本文按当前仓库代码整理。应用版本为 `0.1.0`，版本号、依赖和构建命令以 [package.json](package.json) 为准。

## 功能概览

| 功能 | 当前实现 |
| --- | --- |
| 聊天与任务 | 流式对话、会话搜索、工作目录选择、工具执行记录、文件产物与修改差异、Token 用量显示；会话可导出为 Markdown、PDF 或 JSON。 |
| 模型连接 | 支持 OpenAI 兼容协议和 Anthropic 协议，可保存、切换多个服务配置；也可连接提供兼容接口的本机服务。 |
| 本地模型 | 搜索 Hugging Face 模型、下载与导入模型文件、管理 GGUF 模型及视觉组件，通过 llama.cpp 的 `llama-server` 启动本地推理。 |
| 工作流 | 独立画布编辑窗口、JSON 数据传递、AI 判断与确定性判断、多路连接、汇合、人工确认、系统通知和结束节点。 |
| 定时任务 | 一次性、间隔、每日、每周和五字段 Cron；可执行 Agent 任务或已保存的工作流，支持超时、重试和运行记录。 |
| 插件 | 管理 Python Skill 插件，编辑清单与代码、测试工具、查看能力注册表；仓库附带文件、Git 和 Agent 工具集。 |
| MCP | 通过命令、参数和环境变量启动 stdio MCP 服务，发现工具并接入 Agent 能力注册表。 |
| 内置浏览器 | 独立浏览器界面及浏览器插件能力。 |
| 模型 API 服务 | 本地模型可通过带鉴权的网关提供模型查询、聊天和模型管理接口；具体接口能力取决于运行时。 |
| 外观与诊断 | 主题和背景设置、应用日志、本地运行时状态与错误诊断。 |

主界面以聊天为入口，左下角“设置”提供“工作流、定时任务、插件、MCP 服务、发现模型、我的模型、模型服务、应用设置”等页面。

## 开发环境与启动

### 环境要求

- **Node.js ≥ 22.13.0**，以及随 Node.js 安装的 npm。
- **Python 3**：执行 Python 插件、部分文件与文档工具时需要。当前内置插件清单声明 Python `>=3.9`，实际可用版本还需满足所安装依赖的要求。Windows 需能运行 `python`，macOS/Linux 需能运行 `python3`。
- **Git**：使用 Git 工具时需要。
- **llama-server**：仅在应用托管本地 GGUF 模型时需要；使用外部模型接口不需要本地推理运行时。

模型文件和 llama.cpp 运行时不随源码依赖自动安装。

### 安装依赖

在仓库根目录执行：

```bash
npm ci
```

需要 PDF 文本提取、图片或 OCR 等 Python 工具时，为实际运行工具的 Python 解释器安装依赖：

```bash
python -m pip install -r python/requirements.txt
```

macOS/Linux 将上述命令中的 `python` 换成 `python3`。依赖清单位于 [python/requirements.txt](python/requirements.txt)，包含 pypdf、Pillow 和 RapidOCR。

### 开发模式

```bash
npm run dev
```

该命令启动 Vite、等待 `127.0.0.1:5174` 就绪，编译 Electron 主进程后打开桌面窗口。Vite 使用固定端口；端口被占用时需先释放。渲染进程支持热更新，修改 Electron 主进程或 preload 后需要重新编译并重启应用。

### 本地构建后启动

```bash
npm start
```

`npm start` 会先构建前端和 Electron，再启动应用。单独运行 Vite 不能替代完整桌面应用，页面依赖 preload 提供的 `window.myplane` 接口。

## 首次使用

### 1. 配置模型

进入“设置 → 模型服务”，选择一种连接方式。

**外部服务**：选择 OpenAI 兼容或 Anthropic 协议，填写服务地址、模型 ID，以及服务要求的 API Key；保存配置并连接。外部服务也可以是运行在本机的 Ollama、LM Studio 或其他兼容接口。模型 ID 和上下文长度应与实际服务一致。

**托管本地模型**：

1. 在“发现模型”中下载模型，或在“我的模型”中导入已有文件。
2. 在“模型服务 → 本地服务 → 运行时”中查找、安装运行包，或指定 `llama-server` 可执行文件。
3. 选择有效的 GGUF 模型，按机器资源设置上下文、GPU 层数和线程数。
4. 启动模型，并将本地服务设为当前使用的服务。

托管模式当前一次加载一个模型。视觉输入需要模型本身支持，并配有可识别的视觉投影文件；只有文本模型时不能通过添加图片获得视觉能力。

### 2. 开始聊天或文件任务

回到聊天界面，选择可用模型并发送消息。需要读取项目、修改文件或执行命令时，先选择聊天工作目录，再说明目标。执行过程中的工具调用、审批请求、文件产物和差异会在会话中展示。

聊天界面提供三档权限：

| 权限 | 行为 |
| --- | --- |
| 请求批准 | 联网、写入和高风险操作请求批准。 |
| 帮我批准 | 自动允许搜索和工作目录内写入；高风险操作及目录外访问仍请求批准。 |
| 完全访问 | 允许访问互联网和本机文件，不再逐次询问；首次切换需要在界面确认。 |

权限按实际任务选择。工作流与定时任务另有各自的执行配置。

## 可视化工作流

进入“设置 → 工作流”新建流程，在独立编辑窗口中设置入口并连接组件。每个工作流使用独立的工作目录，不需要关联项目。

### 组件与分支

| 分类 | 组件 | 分支行为 |
| --- | --- | --- |
| 任务执行 | Agent | 唯一输出分支固定输出 `{"result":"AI 的完整回答"}`，可连接多个下游。 |
| 任务执行 | 系统通知 | 固定“发送成功”和“发送失败”两个分支，按通知发送结果选择。 |
| 数据处理 | 数据变量 | 设置命名变量，并通过输出 JSON 传递数据。 |
| 数据处理 | 汇合 | 等待全部或任一上游，使用唯一输出分支继续执行。 |
| 逻辑判断 | AI 判断 | 选择直接上游的判断输入；模型只返回分支和理由，运行器传递原输入。新建组件固定保留“无法判断”分支。 |
| 逻辑判断 | 文本、数值、布尔、集合判断 | 按类型规则选择“成立”或“不成立”，不调用 AI。 |
| 逻辑判断 | 条件判断 | 按全部满足（AND）或任一满足（OR）组合规则，不调用 AI。 |
| 逻辑判断 | Switch | 按匹配值选择分支，未命中时进入默认分支，不调用 AI。 |
| 流程控制 | 人工确认 | 等待批准或拒绝，可设置等待期限和超时处理方式。 |
| 流程控制 | 结束 | 设置结果状态、摘要和可选 JSON，可结束当前路径或整个工作流；没有输出分支。 |

所有逻辑判断组件，包括兼容旧流程的判断和路由节点，均以**菱形**显示。Agent 用于执行任务，需要 AI 分流时使用独立的“AI 判断”组件。

### 画布操作

- 拖动组件可视区域的任意位置移动节点，包括标题、正文、底部和空白区域；连线端口保留连线操作。
- 从输出端口拖到下游输入端口创建连线。一个分支可连接多个下游，开始节点也可连接多个入口。
- Shift 追加选择，Ctrl/Cmd 切换选择，Alt 减选；支持框选和多节点移动。
- Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Shift+Z 重做；Windows 也支持 Ctrl+Y。
- 可缩放、平移和自动排列节点；自动排列按节点高度留出行间距。
- 首次保存需手动操作。已有流程编辑时每 30 秒尝试自动保存，校验不通过的配置不会保存。

### 数据传递

分支输出使用 JSON。Agent 和 AI 判断节点的空字符串字段由 AI 填写，固定值保持原值，引用字段由程序从上游或变量中解析。例如：

```json
{
  "result": "",
  "source": "{{input.step_source_1.title}}",
  "approved": true
}
```

这里的 `step_source_1` 是示例节点 ID，实际使用时应从属性面板插入引用。数据变量可使用 `{{数据变量 1.result}}` 这样的组件名称引用。

工作流不支持循环连线。分支无下游时当前路径结束；多路连接不代表保证并行执行。需要所有输入到齐后再继续时，应明确配置汇合或输入等待方式。AI 返回不存在的分支或不符合输出格式的结果时，节点会失败。

完整配置说明、引用规则和用例见 [工作流使用指南](src/help/workflow.md)，也可从应用“帮助”菜单或编辑器帮助按钮打开。

## 定时任务

在“设置 → 定时任务”中配置任务要求或选择工作流，设置时区、触发方式、超时、重试次数和通知策略。

支持一次性时间、固定分钟间隔、每日、每周及 Cron。Cron 为五字段格式：

```text
分 时 日 月 星期
```

星期范围为 `0–6`，`0` 表示星期日。同一任务上次运行尚未结束时，新触发会被跳过，采用禁止重叠的并发策略。

调度器运行在桌面应用进程内，需要应用保持运行。启用定时任务时，关闭主窗口可能继续保留后台进程；从菜单明确退出应用会停止调度。应用在执行中退出后，未确认完成的运行会记录为失败，不会直接重放该次运行。

## 插件、MCP 与浏览器

### Python 插件

“插件”页支持查看工具、启停插件、编辑代码、测试调用和查看已注册能力。仓库自带：

- `file-operations`：文件读写、列表与搜索。
- `git-operations`：Git 操作。
- `agent-tools`：工作目录、代码、文档、命令、网络等 Agent 工具。

插件通过 `skill.json` 描述运行时、工具参数和权限，通过 `index.py` 提供执行入口；部分插件还有 `engine.py`。应用初始化时会把内置插件复制到用户数据目录中的 `agent-data/skills`，运行时编辑的插件位于该目录，通常不会被源码同名插件覆盖。

### MCP 服务

“MCP 服务”页使用 stdio 传输，需要填写可执行命令、参数及必要环境变量。连接后，服务提供的工具进入能力注册表。对应服务依赖的 Node.js、Python 或其他程序需能在本机启动。

### 内置浏览器

可从聊天工具栏或“视图 → 内置浏览器”打开。插件页面包含浏览器插件入口，Agent 可通过注册的浏览器能力完成网页任务。

## 模型 API 网关

“模型服务”的本地服务区域提供 API 服务配置。网关使用独立鉴权，可供其他客户端访问已加载的本地模型。

代码包含 `/v1/models`、`/v1/chat/completions`、`/v1/completions`、`/v1/embeddings`、`/v1/responses`、`/v1/messages`，以及 `/api/v1/models` 等模型管理路由。部分路由直接依赖 `llama-server` 的对应能力，运行包不支持时会返回未实现错误；接口存在不代表所有模型支持全部能力。

具体参数和示例以应用服务页面及 [网关实现](electron/main/local-ai-gateway.ts) 为准。

## 数据与配置

默认用户数据目录为 Electron 的 `appData` 目录下的 `myplane-agent`；Windows 通常是 `%APPDATA%\myplane-agent`。可通过 `MYPLANE_AGENT_DATA_DIR` 指定另一目录，例如在 PowerShell 中：

```powershell
$env:MYPLANE_AGENT_DATA_DIR = 'D:\MyPlaneAgentData'
npm start
```

主要数据位置：

| 相对用户数据目录的路径 | 内容 |
| --- | --- |
| `local-ai-settings.json`、`local-ai-studio-settings.json` | 模型连接、界面和运行设置。 |
| `local-ai-remote-profiles.json` | 保存的外部服务配置。 |
| `local-ai-sessions/` | 聊天会话。 |
| `local-ai-agent-tasks/` | 项目及兼容 Agent 任务数据。 |
| `agent-data/` | Agent Core 数据、插件及 Python 运行环境。 |
| `agent-core-mcp.json` | 当前 MCP 服务配置。 |
| `local-ai-workflows/` | 工作流定义与运行数据。 |
| `local-ai-automations/` | 定时任务、运行记录和任务工作目录。 |
| `local-ai-runtimes/` | 安装的模型运行包。 |

模型下载目录可在应用中配置，项目文件保存在选定的工作目录中。备份或迁移时，需要分别考虑这些位置。

API Key 和 Hugging Face Token 使用 Electron `safeStorage` 加密保存；系统安全存储不可用时会拒绝保存密钥。聊天记录与项目文件不因此自动获得加密，使用外部模型时相关请求内容会发往所配置的服务。

## 检查、测试与打包

| 命令 | 用途 |
| --- | --- |
| `npm run check` | Vue 和 Electron TypeScript 类型检查。 |
| `npm test` | 编译 Electron，再运行 `tests/*.test.mjs`。 |
| `npm run test:history` | Electron 会话历史恢复测试。 |
| `npm run test:smoke` | 构建应用并运行 Agent Core 桌面冒烟测试。 |
| `npm run build:renderer` | 输出前端到 `dist/`。 |
| `npm run build:electron` | 清理并重新输出主进程和 preload 到 `dist-electron/`。 |
| `npm run build:app` | 构建前端与 Electron。 |
| `npm run build` | 构建并通过 electron-builder 打包。 |
| `npm run build:win` | Windows NSIS 安装包。 |
| `npm run build:mac` | macOS DMG。 |
| `npm run build:linux` | Linux AppImage 和 DEB。 |

安装包输出到 `release/`。平台打包脚本表示仓库提供对应构建配置，不代表所有平台均已在当前环境验证。建议在目标平台构建和测试；签名、公证等发布配置需另行准备。

## 代码结构

```text
src/
  LocalAiStudio.vue           桌面主界面与设置导航
  local-ai/                   聊天、工作流、模型、插件和 MCP 界面
  help/workflow.md            应用内工作流指南
electron/
  main/index.ts              窗口、菜单、生命周期与数据目录
  main/local-ai-studio.ts    服务协调与 IPC 业务入口
  main/agent/core/           Agent Core、能力注册、Skill 与 MCP 执行
  main/agent/workflow.ts     工作流校验、调度与执行
  main/agent/automation.ts   定时任务调度
  main/local-ai-runtime.ts  llama-server 进程管理
  main/local-ai-gateway.ts  本地模型 API 网关
  preload/                  渲染进程桥接接口
  shared/                   类型定义、输入与输出处理、公共校验
skills/                     随应用分发的 Python 插件
python/                     Python 工具 Worker 与依赖清单
tests/                      Node.js 测试和 Electron 集成测试
docs/                       架构、开发说明及历史迁移记录
examples/                   迁移与插件开发示例
```

渲染界面通过 preload 调用主进程；主进程负责数据持久化、模型服务和任务调度。当前聊天与工作流的 Agent 执行接入 Agent Core，工作流和定时任务通过 `CoreWorkflowAdapter` 复用该执行层。仓库仍保留兼容服务与迁移代码，历史文档中的界面和架构描述可能与当前代码不同。

## 常见问题

- **启动开发模式时提示 5174 端口被占用**：结束占用该端口的进程后重新执行 `npm run dev`。
- **外部模型无法连接**：核对协议、服务地址、模型 ID 和 API Key；查看服务返回的具体错误。
- **本地模型无法加载**：确认使用有效 GGUF 和完整运行包，检查运行时日志，按机器资源减少上下文或 GPU 层数。Windows 缺少 DLL 时不要只复制 `llama-server.exe`。
- **Python 插件启动失败**：在启动应用的环境中检查 `python` 或 `python3`，确保依赖安装到实际使用的解释器；插件使用独立虚拟环境时也需满足其依赖。
- **工作流无法保存**：按红色高亮检查名称、入口连线、输出 JSON、判断规则和分支数量；Agent 保留一个输出，AI 判断至少两个。
- **定时任务没有执行**：确认应用仍在运行、任务已启用、时区和触发时间正确；同一任务尚在运行时，新触发会被跳过。
- **需要查看日志**：使用“视图 → 日志输出”（Ctrl/Cmd+Shift+L），或“帮助 → 打开日志目录”。
