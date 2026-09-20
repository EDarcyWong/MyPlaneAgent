# 独立项目拆分验证

2026-09-20，macOS arm64，Node.js 22.13.1。

## MyPlaneAgent

- `npm run check`：通过。
- `npm run build:app`：通过。
- `npm test`：116 项，115 通过、0 失败、1 跳过。跳过项为需显式启用 LibreOffice 的 DOCX 打开测试。
- `electron tests/standalone.electron.mjs`：通过。覆盖生产页面启动、独立数据目录、沙箱 preload、功能页面切换、重载及未注册窗口的 IPC 拒绝。
- `electron tests/local-ai-history-recovery.electron.mjs`：通过。覆盖旧记录 `before:null`、多文件快照、行号定位、再次打开和输入框解除锁定。
- `electron-builder --dir --publish never`：通过，输出 `release/mac-arm64/MyPlaneAgent.app`。这是本机未签名构建，不是已签名/公证的发行包。
- 已直接打开打包后的 `.app`，确认工作台、项目菜单和输入框正常显示，Python worker 已随应用打包。

本次没有下载或加载实际模型，推理与工具测试使用本地测试服务。Windows、Linux 打包未在本机验证。

## 原 MyPlane

- 类型检查与生产构建通过；编译输出不再包含本地 AI 和 Agent 模块。
- 全量测试：225 项，203 通过、21 失败、1 跳过。
- 在独立临时目录还原拆分前 HEAD 并运行失败测试文件，复现了完全相同的 21 项失败，没有新增失败。涉及 backup-bridge、planning-payload、report-export、resources、settings，包含旧测试桩及 macOS 临时目录真实路径差异。
- 标题栏测试中的中英文工具菜单断言通过，均不再包含本地 AI。该测试后续原生 undo 断言失败，拆分前版本也复现相同失败。

原项目数据目录中的会话、模型、配置均未删除或迁移，新应用使用独立数据目录。迁移说明见 README。
