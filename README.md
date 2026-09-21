# MyPlaneAgent

从 MyPlane 拆分的独立本地 AI 桌面应用，使用 Electron、Vue 3 和 TypeScript。直接启动 AI 工作台，包含模型发现与下载、llama.cpp 托管推理、OpenAI 兼容外部服务、聊天、项目 Agent、MCP、Python 工具、上下文压缩和用量统计。

## 开发与启动

需要 Node.js 22.13+ 与 npm。

```sh
npm ci
npm run dev
```

开发服务器只监听 `127.0.0.1:5174`。`npm run start` 构建后启动本地生产界面；`npm run build` 生成当前平台的安装包，输出到 `release/`。应用 ID 为 `com.myplane.agent`，可与 MyPlane 同时安装、运行。托管 API 默认端口为 `8089`，可在设置中修改。

```sh
npm run check
npm test
npm run test:smoke
```

历史恢复界面回归需要先启动 `npx vite`，然后在另一个终端执行 `npm run test:history`。其余 `tests/*.electron.mjs` 可通过 `npx electron tests/文件名.electron.mjs` 运行，界面测试使用端口 5174。需要真实模型的测试应按照测试文件中的环境变量配置，不会自动下载模型。

## 使用

1. 打开应用即进入工作台。
2. 在设置中连接外部兼容服务，或导入 GGUF 模型并选择/安装 llama.cpp 运行时。
3. 选择模型后聊天；创建项目并选择工作目录后使用 Agent。
4. 在“工作流”页面组合 Agent、确定性路由、数据、汇合、人工确认、系统通知与结束节点，并查看节点运行时间线。
5. 在“定时任务”页面按单次、间隔、每日、每周或 Cron 计划运行项目 Agent 或工作流。
6. 在工具页面管理 Python 工具和项目 MCP 连接。

Python 工具需要 Python 3；macOS/Linux 默认使用 PATH 中的 `python3`，Windows 使用 `python`，可以用 `MYPLANE_PYTHON` 指定解释器。PDF、图片与 OCR 功能的可选依赖：

```sh
python3 -m pip install -r python/requirements.txt
```

Electron 负责操作确认、参数验证、任务状态和审计。独立应用使用当前操作系统用户身份，不依赖 MyPlane 的账号或数据库。IPC 仅接受应用已注册的主框架调用；外部页面与子框架不能调用本地工具。项目授权和写入/命令确认逻辑保持不变。

## 数据与原项目

MyPlaneAgent 使用独立的 `myplane-agent` 数据目录：

- macOS：`~/Library/Application Support/myplane-agent`
- Windows：`%APPDATA%/myplane-agent`
- Linux：`~/.config/myplane-agent`

也可通过 `MYPLANE_AGENT_DATA_DIR` 指定独立数据目录。不要让两个正在运行的应用共用数据目录。

原 MyPlane 中的本地 AI 代码、入口及专属测试已迁到本项目；原来的模型、会话和配置文件均保留，首次启动不会自动迁移或删除这些文件。旧 GGUF 可通过“我的模型 → 导入”使用，无需再次下载。API Key、HF Token 和 MCP 凭据需在新应用重新配置，不能假设原应用的系统加密凭据可直接复用。

如需恢复旧会话，请先完全退出两个应用、备份数据，再将原数据目录中的 `local-ai-sessions/` 与 `local-ai-agent-tasks/` 复制到新应用的数据目录。只在新应用对应目录为空时复制，避免覆盖已有会话；历史引用的项目文件夹仍需存在。任务恢复不会自动执行尚未确认的操作。

## 目录

- `src/LocalAiStudio.vue`、`src/local-ai/`：工作台与 AI 界面
- `electron/main/index.ts`：独立应用启动、窗口与生命周期
- `electron/main/local-ai*.ts`：模型、下载、推理、聊天与 API
- `electron/main/agent/`：项目执行、工具、MCP 与审计
- `electron/preload/index.cts`：沙箱预加载桥，仅暴露 AI 接口
- `electron/shared/`：AI 类型与公共逻辑
- `python/`：工具执行进程及可选依赖
- `tests/`：单元测试与 Electron 回归测试

拆分验证记录：[extraction-validation.md](docs/extraction-validation.md)。

详细文档：[Agent](docs/local-ai-agent.md) · [模型与运行时](docs/local-ai-studio.md) · [规划与边界](docs/local-ai-roadmap.md)。

## DeepSeek 远程 API

在「设置 → 服务连接」点击「DeepSeek 云端 API」，填写在 [DeepSeek 平台](https://platform.deepseek.com/) 创建的 API Key，再点击「保存并测试连接」。成功后在工作台选择模型即可聊天或运行项目 Agent，无需下载 GGUF 或启动 llama.cpp。

预设地址为 `https://api.deepseek.com`，默认模型为 `deepseek-flash`，也可选择 `deepseek-v4-pro` 或接口返回的其他模型 ID。当前模型名依据 [DeepSeek 官方 API 文档](https://api-docs.deepseek.com/zh-cn/)，连接时会实时获取模型列表。应用按当前官方能力预设 65536 输出 token、1000000 上下文预算；输出可手动提高到 393216。聊天默认开启思考；Agent 快速模式使用 8192 单轮预算，深度模式使用完整工作区输出预算，摘要请求关闭思考。

上下文预算不会直接限制 DeepSeek 服务端窗口，而是供 Agent 预留输出、估算工具定义和在接近容量时压缩历史。若取消这项预算，Agent 无法在请求发出前可靠判断何时压缩，可能在工具调用链中收到上下文溢出错误。因此远程模型保留供应商对应的预算，本机模型仍按实际加载的上下文与并发槽计算。

API Key 使用系统安全存储加密，仅由 Electron 主进程发送。更换服务地址后需要重新填写密钥。远程模式下，对话以及 Agent 读取后加入上下文的项目内容会发往所配置的服务，并按供应商规则计费。其他 OpenAI 兼容远程服务仍可手动填写地址、模型和密钥。

DeepSeek 模拟接口回归：`npm run build:electron && npx electron tests/local-ai-deepseek.electron.mjs`；测试不会调用付费 API。
