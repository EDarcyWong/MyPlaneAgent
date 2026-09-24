# File Operations Skill

提供基础的文件系统操作能力。

## 工具列表

### file.read
读取文件内容，支持指定行范围。

**参数**：
- `path` (string, required): 文件路径
- `startLine` (integer, optional): 起始行号，默认 1
- `endLine` (integer, optional): 结束行号，默认到文件末尾

**返回**：
```json
{
  "path": "文件路径",
  "totalLines": 总行数,
  "startLine": 实际起始行,
  "endLine": 实际结束行,
  "text": "文件内容（带行号）"
}
```

### file.write
写入文件内容，自动创建目录。

**参数**：
- `path` (string, required): 文件路径
- `content` (string, required): 文件内容

**返回**：
```json
{
  "success": true,
  "path": "文件路径",
  "bytes": 写入字节数
}
```

### file.list
列出目录文件，递归遍历。

**参数**：
- `path` (string, optional): 目录路径，默认 "."
- `depth` (integer, optional): 递归深度，默认 4

**返回**：
```json
{
  "paths": ["文件路径列表"],
  "truncated": 是否截断
}
```

## 权限

- 文件系统读写：`**/*`（所有路径）
- 网络：否
- 进程：否

## 依赖

无外部依赖。
