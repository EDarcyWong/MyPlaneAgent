# Git Operations Skill

提供 Git 版本控制操作能力。

## 工具列表

### git.status
获取 Git 仓库状态。

**参数**:
- `short` (boolean, optional): 简短格式输出，默认 false

**返回**:
```json
{
  "status": "Git 状态输出",
  "clean": true/false
}
```

### git.add
添加文件到暂存区。

**参数**:
- `files` (array[string], optional): 文件路径列表
- `all` (boolean, optional): 添加所有更改，默认 false

**返回**:
```json
{
  "success": true,
  "message": "Files added to staging area"
}
```

### git.commit
提交更改。

**参数**:
- `message` (string, required): 提交信息
- `amend` (boolean, optional): 修改上次提交，默认 false

**返回**:
```json
{
  "success": true,
  "message": "提交信息",
  "hash": "commit hash"
}
```

### git.push
推送到远程仓库。

**参数**:
- `remote` (string, optional): 远程仓库名称，默认 "origin"
- `branch` (string, optional): 分支名称
- `force` (boolean, optional): 强制推送，默认 false

**返回**:
```json
{
  "success": true,
  "message": "推送结果信息"
}
```

### git.pull
从远程仓库拉取。

**参数**:
- `remote` (string, optional): 远程仓库名称，默认 "origin"
- `branch` (string, optional): 分支名称

**返回**:
```json
{
  "success": true,
  "message": "拉取结果",
  "upToDate": true/false
}
```

### git.log
查看提交历史。

**参数**:
- `limit` (integer, optional): 最大提交数，默认 10
- `oneline` (boolean, optional): 单行格式，默认 false

**返回**:
```json
{
  "log": "完整日志",
  "commits": [
    {"hash": "abc1234", "message": "commit message"}
  ]
}
```

### git.diff
查看差异。

**参数**:
- `cached` (boolean, optional): 查看暂存区差异，默认 false
- `files` (array[string], optional): 指定文件

**返回**:
```json
{
  "diff": "差异内容",
  "hasChanges": true/false
}
```

### git.branch
分支操作。

**参数**:
- `action` (string, required): 操作类型 (list/create/delete/checkout)
- `name` (string, optional): 分支名称（create/delete/checkout 需要）

**返回**:
```json
{
  "success": true,
  "output": "命令输出",
  "branches": ["main", "dev"] // 仅 list 操作
}
```

## 权限

- 文件系统读写：`**/*`
- 网络：否
- 进程：是（需要运行 git 命令）

## 依赖

- Git 命令行工具（需要预先安装）

## 使用示例

```typescript
// 获取状态
const status = await registry.execute({
  capability: 'git.status',
  args: { short: true },
  workspace: '/path/to/repo'
}, signal)

// 提交更改
await registry.execute({
  capability: 'git.add',
  args: { all: true },
  workspace: '/path/to/repo'
}, signal)

await registry.execute({
  capability: 'git.commit',
  args: { message: 'feat: add new feature' },
  workspace: '/path/to/repo'
}, signal)

// 推送
await registry.execute({
  capability: 'git.push',
  args: { remote: 'origin', branch: 'main' },
  workspace: '/path/to/repo'
}, signal)
```
