## 从新建到投入使用

插件把 Python 函数注册为 Agent 可以调用的工具。一个插件可以提供多个工具；`skill.json` 描述工具及参数，`index.py` 实现功能。本文适用于 MyPlaneAgent 的本地 Python 插件。

最短操作流程：**新建插件 → 编辑 → 编译校验 → 保存并使用 → 测试 → 在对话中调用**。

1. 打开“插件”页面，在“插件与工具”中点击“新建插件”。
2. 输入标识，例如 `text-helper`。标识须以小写字母开头，只能包含小写字母、数字和连字符，最多 64 个字符；不能与已有目录重名。
3. 创建后选中该插件，点击“编辑”，修改配置、Python 代码和使用说明。
4. 点击“编译校验”检查 Python 语法，再点击“保存并使用”。保存也会自动校验配置和 Python 语法。
5. 保存成功后，切换“测试”，选择工具、填写工作目录和参数 JSON，点击“运行测试”。
6. 确认输出正确，再到对话中明确要求调用该工具，并检查实际工具执行结果。

新建插件会生成示例并自动加载。保存成功会重新加载插件、停止旧的插件工作进程并更新能力目录；下一次调用使用新代码，通常无需重启应用或单独安装。请先结束正在运行的 Agent 任务，再保存或刷新。

本指南可从“帮助 → 插件编辑与使用指南”或插件页面右上角问号图标打开，支持离线阅读、目录导航和 Ctrl/Cmd+F 搜索。

## 认识插件页面和文件

“插件与工具”用于创建、查看、编辑和测试；“能力目录”用于确认 Agent 当前可调用的能力。列表支持按名称、说明、工具名称搜索，也可按分类筛选。

| 入口或文件 | 用途 | 操作要点 |
| --- | --- | --- |
| 概览 | 查看启用状态、运行时、本地目录和工具参数 | 本地目录是外部编辑和备份时的准确位置 |
| 编辑 / skill.json | 插件身份、工具定义、参数和权限 | 使用合法 JSON，不写注释或尾随逗号 |
| 编辑 / index.py | Python 工具实现和通信入口 | 保留运行协议；工具名称须与配置一致 |
| 编辑 / engine.py | 部分已有插件的辅助实现 | 仅在文件已存在时显示，新插件默认没有 |
| 编辑 / README.md | 面向使用者的说明 | 写清输入示例、返回结果、依赖和使用条件 |
| 编译校验 | 检查当前 Python 草稿的语法 | 不会保存、加载或执行工具，也不证明依赖齐全 |
| 保存并使用 | 校验并保存所有编辑文件，重新加载能力 | “未保存”标记消失后再测试 |
| 测试 | 实际执行已保存的工具 | 有未保存修改时不可运行 |
| 刷新插件 | 重新扫描磁盘上的插件并更新能力 | 主要用于外部编辑完成后，不会保存编辑器草稿 |

切换文件标签时，草稿仍保留在编辑器中；“保存并使用”保存的是该插件的全部编辑内容。切换插件遇到未保存提示时，选择“继续编辑”可返回保存。

浏览器自动化、静态网页预览是内置插件，使用各自详情中的“允许 Agent 使用”开关。文件、Git 等内置工具可能共用同一来源插件的文件，编辑它们会影响该来源的其他工具。建议通过“新建插件”开发独立功能。

## 完整示例：创建文本统计插件

下面的示例仅使用 Python 标准库，无需第三方依赖。请先新建标识为 `text-helper` 的插件，再把以下内容分别粘贴到对应文件。

### 第一步：编辑 skill.json

```json
{
  "id": "text-helper",
  "name": "文本统计助手",
  "description": "统计给定文本的字符数和非空行数",
  "version": "1.0.0",
  "enabled": true,
  "category": "other",
  "runtime": {
    "type": "python",
    "version": ">=3.9",
    "entry": "index.py",
    "venv": false
  },
  "capabilities": {
    "tools": [
      {
        "name": "text_helper_stats",
        "description": "统计用户提供文本的字符数和非空行数。只处理传入文本，不读写文件。",
        "risk": "read",
        "parameters": {
          "type": "object",
          "properties": {
            "text": { "type": "string", "description": "要统计的文本，换行使用 JSON 转义符 \\n" }
          },
          "required": ["text"],
          "additionalProperties": false
        }
      }
    ]
  },
  "permissions": {
    "fileSystem": { "read": [], "write": [] },
    "network": false,
    "process": false
  },
  "dependencies": { "python": [] }
}
```

如果创建时用了其他标识，请保留实际标识作为 `id`；已存在插件的 ID 不能在编辑时修改。`name` 是显示名称，可以修改。

### 第二步：编辑 index.py

替换整个文件，包括底部通信入口：

```python
import json
import sys
import time


def text_helper_stats(args, context):
    text = args.get("text")
    if not isinstance(text, str):
        raise ValueError("text 必须是字符串")
    return {
        "characters": len(text),
        "non_empty_lines": sum(1 for line in text.splitlines() if line.strip()),
    }


TOOLS = {"text_helper_stats": text_helper_stats}


if __name__ == "__main__" and "--runtime-mode" in sys.argv:
    print("READY", flush=True)
    for line in sys.stdin:
        request = None
        started = time.monotonic()
        try:
            request = json.loads(line)
            tool = TOOLS[request["tool"]]
            output = tool(request.get("args", {}), {"workspace": request.get("workspace")})
            response = {
                "type": "response",
                "id": request["id"],
                "output": output,
                "elapsedMs": int((time.monotonic() - started) * 1000),
            }
        except Exception as error:
            response = {
                "type": "response",
                "id": request.get("id") if isinstance(request, dict) else "",
                "error": str(error),
                "elapsedMs": int((time.monotonic() - started) * 1000),
            }
        print(json.dumps(response, ensure_ascii=False), flush=True)
```

字符数包含空格和换行。非空行数忽略空行及只有空白字符的行。

### 第三步：补充 README.md

建议写入：插件用途、工具名 `text_helper_stats`、必填参数 `text`、输出字段 `characters` 与 `non_empty_lines`、字符统计口径，以及“仅使用 Python 标准库，无文件或网络操作”。README 用于说明；真正供 Agent 选择工具的描述应写在 `skill.json` 的工具 `description` 中。

### 第四步：保存并测试

点击“编译校验”，通过后点击“保存并使用”。在“测试”中选择 `text_helper_stats`，工作目录可保留默认值，参数填写：

```json
{"text": "你好\nMyPlane"}
```

点击“运行测试”，预期结果包含以下内容，界面还会显示耗时：

```json
{"characters": 10, "non_empty_lines": 2}
```

也可以使用 `{"text":""}` 验证两个统计值均为 0；使用 `{"text":123}` 验证工具能返回参数类型错误。

## skill.json 各字段如何填写

| 字段 | 说明 |
| --- | --- |
| id | 稳定的插件标识；保存时不可修改 |
| name / description | 显示名称和插件整体用途 |
| version | 版本标记，例如 `1.0.1`；更新代码时可同步修改，但生效不依赖版本号变化 |
| enabled | `true` 启用、`false` 停用；省略时默认启用 |
| category | 能力分类；界面识别 `file`、`git`、`code`、`document`、`test`、`runtime`、`workflow`、`other`，其他分类在列表中归入“其他插件” |
| runtime | 当前支持 `type: "python"` 和 `entry: "index.py"`；新手示例保留 `venv: false` |
| capabilities.tools | 工具数组，每个工具填写 `name`、`description` 和 `parameters` |
| tools[].name | 由字母或下划线开头，后接字母、数字或下划线；同一插件中不能重复，须与 Python 的 `TOOLS` 键一致 |
| tools[].description | 说明何时使用、输入要求及作用，帮助 Agent 正确选择工具 |
| tools[].parameters | 参数的 JSON Schema；写清类型、必填项和字段说明，Python 中也应校验输入 |
| tools[].risk | 纯读取或纯计算可使用 `read`；有写入或执行副作用的工具不要标为只读，非 `read` 的工具会带有需要审批的风险标记 |
| permissions | 声明文件读取、写入、联网和进程操作需求 |
| dependencies | 依赖信息；仅填写 `dependencies.python` 不会自动安装包 |

增加第二个工具时，需要同时在 `capabilities.tools` 中增加定义，在 `index.py` 中实现函数，并加入 `TOOLS` 映射，然后保存、逐个测试。

能力目录中的名称按 `分类.工具名` 生成，例如 `other.text_helper_stats`。不同插件也应避免使用相同的分类与工具名组合，建议工具名带上插件前缀。

## Python 入口、工作目录与依赖

应用以 `index.py --runtime-mode` 启动插件，插件从标准输入逐行接收请求，并逐行输出 JSON 响应。请保留示例中的 `READY`、请求 `id`、`type: "response"`、异常处理及 `flush=True`。

工具函数返回可以被 JSON 序列化的数据，例如字典、列表、字符串、数值；日期、集合、文件对象等需要先转换。调试日志使用 `print("调试信息", file=sys.stderr)`，避免普通日志混入标准输出通信。

工具函数的 `args` 是本次参数，示例入口提供的 `context["workspace"]` 是用户选择的工作目录。Python 进程自身的当前目录是插件目录，不能把相对路径默认当成用户项目路径。涉及项目文件时，应以传入工作目录解析路径并校验范围。

“编译校验”仅检查语法，缺少模块、业务错误和外部服务故障需要通过“运行测试”发现。插件依赖可用的 Python 环境；出现 Python 启动失败时，检查应用配置使用的 Python 或系统 Python 是否可用。

对于第三方包：

1. 从“概览 → 本地目录”找到插件目录，在外部编辑器创建 `requirements.txt`，填写所需包及版本。
2. 将 `runtime.venv` 设为 `true`，保存后首次调用会在该插件的虚拟环境不存在时创建环境，并安装 `requirements.txt`。
3. 已有虚拟环境不会因为修改依赖文件或点击刷新而自动重新安装。依赖更新需要在该插件使用的虚拟环境中手动安装，再刷新插件。

内置编辑器没有 `requirements.txt` 标签；仅使用标准库的插件无需上述步骤。

## 保存、启用和更新的区别

**保存并使用**：检查配置和代码，写入插件文件，重新扫描插件并更新 Agent 能力。保存成功后提示“已保存并加载，可在对话中使用”。这不是发布到市场，也不会自动发起对话或调用工具。

**启用与停用**：独立 Python 插件通过 `skill.json` 顶层 `enabled` 控制。设为 `true` 后保存即可投入使用；设为 `false` 后保存会使其退出可用能力列表。停用后文件仍保留，可再次编辑启用。保存成功不等于启用，需同时确认该字段及“概览”的状态。

**刷新插件**：用于重新读取磁盘版本，例如通过外部编辑器修改了插件。它不会把当前编辑草稿写入磁盘，也不会自动替换已打开编辑器里的草稿。外部修改前先保存或处理草稿；刷新后切换到其他插件再选回，或重新进入插件页面，检查编辑器显示的是最新内容后再继续编辑。

更新插件前可备份整个“本地目录”，包括辅助文件和依赖清单。恢复时结束运行中的任务，把备份还原到原目录并刷新；不要同时保留两个相同 ID 的插件目录。

## 测试通过后如何在对话中使用

1. 在插件“概览”确认“已启用”，检查提供的工具名称与参数。
2. 切换“能力目录”，搜索 `text_helper_stats`，确认 `other.text_helper_stats` 已出现。目录已打开时如未更新，可重新进入该页面。
3. 回到对话，使用支持工具调用的模型。涉及项目文件时选择正确的项目目录；根据工具实际用途设置会话的文件、联网、执行及审批权限。
4. 发送明确请求，例如：**请调用文本统计助手的 text_helper_stats 工具，统计文本“你好”换行后接“MyPlane”的字符数和非空行数，并展示工具结果。**
5. 查看实际工具调用记录，确认参数及返回结果；只看到模型文字回答不能证明插件被调用。示例预期得到字符数 10、非空行数 2。

是否调用工具由模型结合任务和当前可用能力决定。若没有调用，可明确指定工具名、补充必填参数，并确认模型支持工具调用、插件已启用、会话权限允许该操作。保存或刷新前已开始的任务可能持有旧的能力信息；结束后重新发起任务验证。

## 权限和测试范围

测试页会真实执行插件代码，并非模拟运行。请用测试目录和测试数据验证会写文件、联网或启动进程的插件；测试页的直接执行也不能代替对话权限及审批流程的验证。

`permissions.fileSystem.read` / `write` 是路径规则数组，`network` / `process` 表示联网和进程需求。当前路径匹配是简化的前缀规则，并非完整通配符匹配；不要把权限配置当作操作系统级沙箱。插件代码也应自行校验路径与输入，并仅声明实际需要的权限。

示例文本统计工具不访问文件、网络或进程，因此保留空数组和 `false` 即可。

## 常见问题与排查

| 现象 | 排查与处理 |
| --- | --- |
| 新建时提示标识格式不正确或已存在 | 使用小写字母开头、最多 64 字符的唯一标识，例如 `text-helper` |
| 保存按钮不可用 | 没有修改时无需重复保存；忙碌时等待操作完成 |
| JSON 格式错误 | 检查双引号、逗号和括号；JSON 不能有注释，可点击“格式化”帮助定位 |
| 插件 ID 不可在编辑时修改 | 将 `id` 恢复为创建时的标识，只修改显示名称 `name` |
| Only Python index.py skills are supported | 恢复 `runtime.type` 为 `python`、`runtime.entry` 为 `index.py` |
| 工具定义无效或名称重复 | 检查工具名、描述和参数结构；同一插件内名称不能重复 |
| 编译失败 / SyntaxError / IndentationError | 修复提示位置附近的语法、引号及缩进，再编译保存 |
| 请先停止运行中的 Agent 任务 | 结束任务后再保存或刷新 |
| 测试按钮不可用 | 选择一个工具；先保存所有草稿；停用插件需先启用 |
| Skill is disabled / Skill disabled | 将 `enabled` 改为 `true` 并保存 |
| ModuleNotFoundError | 在实际运行插件的 Python 环境中安装依赖；检查虚拟环境和依赖清单 |
| 工具名相关 KeyError 或找不到工具 | 对齐 `skill.json` 的工具名、Python 函数及 `TOOLS` 映射，再保存 |
| 测试超时、无响应 | 检查运行入口、每行 JSON 响应、请求 ID 和刷新输出；排查阻塞输入或网络调用 |
| not permitted to read / write / access network / spawn processes | 核对权限声明与参数中的路径、URL、命令；对话中还需检查会话权限 |
| 已保存但能力目录找不到 | 检查 `enabled`、工具数组和名称冲突，重新进入能力目录；外部修改后刷新 |
| 外部修改后界面还是旧代码 | 处理草稿后重新选择插件加载内容，避免用旧草稿覆盖磁盘版本 |
| 刷新后插件消失 | 检查本地目录的 `skill.json` 是否存在、JSON 和配置是否有效；修复后再次刷新 |

仍无法定位时，打开“视图 → 日志输出”或“帮助 → 打开日志目录”，结合插件标识、工具名和报错时间检查加载与执行错误。

## 删除与日常维护

“删除插件”会从能力目录移除插件，并把本地文件移到回收站。删除前结束运行中的对话或 Agent 任务，保存需要保留的修改并备份。只想暂时不让 Agent 使用时，将 `enabled` 设为 `false` 并保存即可。

每次更新建议记录版本和变更说明，依次完成编译、保存、正常输入测试、异常输入测试和一次真实对话调用。纯计算工具应检查输出值；有副作用的工具还需检查实际文件或服务状态是否符合预期。
