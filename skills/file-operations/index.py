#!/usr/bin/env python3
"""
File Operations Skill
提供文件读写、列表等基础操作
"""

import sys
import json
import os
from typing import Dict, Any, Optional


class FileOperationsSkill:
    """文件操作 Skill"""

    IGNORED = {'.git', 'node_modules', 'dist', '__pycache__', '.next', 'build'}

    @staticmethod
    def resolve_path(workspace: str, relative_path: str) -> str:
        if not workspace or not os.path.isdir(workspace):
            raise ValueError('Workspace does not exist')
        if not isinstance(relative_path, str) or os.path.isabs(relative_path):
            raise ValueError('Path must be relative to workspace')
        root = os.path.realpath(workspace)
        target = os.path.realpath(os.path.join(root, relative_path))
        if os.path.commonpath((root, target)) != root:
            raise ValueError('Path escapes workspace')
        return target

    def __init__(self):
        self.skill_id = os.getenv('SKILL_ID', 'file-operations')
        print(f"FileOperationsSkill initialized: {self.skill_id}", file=sys.stderr, flush=True)
        # 输出准备就绪信号
        print("READY", flush=True)

    async def handle_request(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """处理请求"""
        tool = request['tool']
        args = request['args']
        workspace = request.get('workspace', '.')

        if tool == 'read':
            return await self.read_file(workspace, args)
        elif tool == 'write':
            return await self.write_file(workspace, args)
        elif tool == 'list':
            return await self.list_files(workspace, args)
        else:
            raise ValueError(f"Unknown tool: {tool}")

    async def read_file(self, workspace: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """读取文件"""
        rel_path = args['path']
        start_line = args.get('startLine', 1)
        end_line = args.get('endLine')

        file_path = self.resolve_path(workspace, rel_path)

        if not os.path.isfile(file_path):
            raise FileNotFoundError(f"File not found: {rel_path}")

        # 限制文件大小
        if os.path.getsize(file_path) > 10 * 1024 * 1024:  # 10MB
            raise ValueError("File too large (max 10MB)")

        try:
            with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
                lines = f.readlines()
        except Exception as e:
            raise ValueError(f"Failed to read file: {e}")

        total = len(lines)
        start = max(1, start_line) - 1
        end = min(total, end_line or total)

        # 限制返回行数
        if end - start > 2000:
            end = start + 2000

        text = ''.join(
            f"{i+1}\t{lines[i]}"
            for i in range(start, end)
        )

        return {
            'path': rel_path,
            'totalLines': total,
            'startLine': start + 1,
            'endLine': end,
            'text': text[:100000]  # 限制100KB
        }

    async def write_file(self, workspace: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """写入文件"""
        rel_path = args['path']
        content = args['content']

        file_path = self.resolve_path(workspace, rel_path)

        # 确保目录存在
        os.makedirs(os.path.dirname(file_path), exist_ok=True)

        try:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
        except Exception as e:
            raise ValueError(f"Failed to write file: {e}")

        return {
            'success': True,
            'path': rel_path,
            'bytes': len(content.encode('utf-8'))
        }

    async def list_files(self, workspace: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """列出文件"""
        rel_path = args.get('path', '.')
        depth = args.get('depth', 4)

        base_path = self.resolve_path(workspace, rel_path)

        if not os.path.isdir(base_path):
            raise NotADirectoryError(f"Not a directory: {rel_path}")

        result = []

        def walk(dir_path: str, level: int):
            if level > depth:
                return

            try:
                for entry in os.scandir(dir_path):
                    if entry.name in self.IGNORED:
                        continue

                    rel = os.path.relpath(entry.path, os.path.realpath(workspace))
                    rel = rel.replace('\\', '/')

                    if entry.is_dir(follow_symlinks=False):
                        result.append(rel + '/')
                        walk(entry.path, level + 1)
                    elif entry.is_file(follow_symlinks=False):
                        result.append(rel)

                    # 限制数量
                    if len(result) >= 1000:
                        return
            except PermissionError:
                pass

        walk(base_path, 0)

        return {
            'paths': result[:1000],
            'truncated': len(result) >= 1000
        }

    async def run_runtime_mode(self):
        """Runtime 模式：持久运行，接收 JSON-RPC 请求"""
        while True:
            try:
                line = sys.stdin.readline()
                if not line:
                    break

                request = json.loads(line.strip())
                request_id = request['id']
                start_time = os.times().elapsed

                try:
                    output = await self.handle_request(request)

                    elapsed_ms = int((os.times().elapsed - start_time) * 1000)

                    response = {
                        'type': 'response',
                        'id': request_id,
                        'output': output,
                        'elapsedMs': elapsed_ms
                    }
                except Exception as e:
                    response = {
                        'type': 'response',
                        'id': request_id,
                        'error': str(e),
                        'elapsedMs': 0
                    }

                print(json.dumps(response), flush=True)

            except Exception as e:
                print(f"Runtime error: {e}", file=sys.stderr, flush=True)


def main():
    """入口函数"""
    if '--runtime-mode' in sys.argv:
        import asyncio
        skill = FileOperationsSkill()
        asyncio.run(skill.run_runtime_mode())
    else:
        print("Usage: python index.py --runtime-mode")
        sys.exit(1)


if __name__ == '__main__':
    main()
