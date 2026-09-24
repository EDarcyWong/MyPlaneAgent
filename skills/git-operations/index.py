#!/usr/bin/env python3
"""
Git Operations Skill
提供 Git 版本控制操作
"""

import sys
import json
import os
import subprocess
from typing import Dict, Any, List, Optional


class GitOperationsSkill:
    """Git 操作 Skill"""

    def __init__(self):
        self.skill_id = os.getenv('SKILL_ID', 'git-operations')
        print("READY", flush=True)

    async def handle_request(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """处理请求"""
        tool = request['tool']
        args = request['args']
        workspace = request.get('workspace', '.')

        if tool == 'status':
            return await self.git_status(workspace, args)
        elif tool == 'add':
            return await self.git_add(workspace, args)
        elif tool == 'commit':
            return await self.git_commit(workspace, args)
        elif tool == 'push':
            return await self.git_push(workspace, args)
        elif tool == 'pull':
            return await self.git_pull(workspace, args)
        elif tool == 'log':
            return await self.git_log(workspace, args)
        elif tool == 'diff':
            return await self.git_diff(workspace, args)
        elif tool == 'branch':
            return await self.git_branch(workspace, args)
        else:
            raise ValueError(f"Unknown tool: {tool}")

    def run_git(self, workspace: str, args: List[str]) -> Dict[str, Any]:
        """运行 Git 命令"""
        try:
            result = subprocess.run(
                ['git'] + args,
                cwd=workspace,
                capture_output=True,
                text=True,
                timeout=30
            )

            return {
                'success': result.returncode == 0,
                'stdout': result.stdout,
                'stderr': result.stderr,
                'returncode': result.returncode
            }
        except subprocess.TimeoutExpired:
            raise ValueError('Git command timeout (30s)')
        except FileNotFoundError:
            raise ValueError('Git not found. Please install Git.')
        except Exception as e:
            raise ValueError(f'Git command failed: {e}')

    async def git_status(self, workspace: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """获取 Git 状态"""
        short = args.get('short', False)

        cmd = ['status']
        if short:
            cmd.append('--short')

        result = self.run_git(workspace, cmd)

        if not result['success']:
            raise ValueError(f"Git status failed: {result['stderr']}")

        return {
            'status': result['stdout'],
            'clean': 'nothing to commit' in result['stdout']
        }

    async def git_add(self, workspace: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """添加文件到暂存区"""
        files = args.get('files', [])
        all_files = args.get('all', False)

        if all_files:
            cmd = ['add', '-A']
        elif files:
            cmd = ['add'] + files
        else:
            raise ValueError('Either "files" or "all" must be specified')

        result = self.run_git(workspace, cmd)

        if not result['success']:
            raise ValueError(f"Git add failed: {result['stderr']}")

        return {
            'success': True,
            'message': 'Files added to staging area'
        }

    async def git_commit(self, workspace: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """提交更改"""
        message = args.get('message')
        amend = args.get('amend', False)

        if not message:
            raise ValueError('Commit message is required')

        cmd = ['commit', '-m', message]
        if amend:
            cmd.append('--amend')

        result = self.run_git(workspace, cmd)

        if not result['success']:
            raise ValueError(f"Git commit failed: {result['stderr']}")

        return {
            'success': True,
            'message': result['stdout'],
            'hash': self._extract_commit_hash(result['stdout'])
        }

    def _extract_commit_hash(self, output: str) -> Optional[str]:
        """从 commit 输出中提取 hash"""
        import re
        match = re.search(r'\[[\w-]+ ([0-9a-f]{7,})\]', output)
        return match.group(1) if match else None

    async def git_push(self, workspace: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """推送到远程仓库"""
        remote = args.get('remote', 'origin')
        branch = args.get('branch')
        force = args.get('force', False)

        cmd = ['push', remote]
        if branch:
            cmd.append(branch)
        if force:
            cmd.append('--force')

        result = self.run_git(workspace, cmd)

        if not result['success']:
            raise ValueError(f"Git push failed: {result['stderr']}")

        return {
            'success': True,
            'message': result['stderr'] or result['stdout']
        }

    async def git_pull(self, workspace: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """从远程仓库拉取"""
        remote = args.get('remote', 'origin')
        branch = args.get('branch')

        cmd = ['pull', remote]
        if branch:
            cmd.append(branch)

        result = self.run_git(workspace, cmd)

        if not result['success']:
            raise ValueError(f"Git pull failed: {result['stderr']}")

        return {
            'success': True,
            'message': result['stdout'],
            'upToDate': 'Already up to date' in result['stdout']
        }

    async def git_log(self, workspace: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """查看提交历史"""
        limit = args.get('limit', 10)
        oneline = args.get('oneline', False)

        cmd = ['log', f'-{limit}']
        if oneline:
            cmd.append('--oneline')

        result = self.run_git(workspace, cmd)

        if not result['success']:
            raise ValueError(f"Git log failed: {result['stderr']}")

        return {
            'log': result['stdout'],
            'commits': self._parse_commits(result['stdout'], oneline)
        }

    def _parse_commits(self, log: str, oneline: bool) -> List[Dict[str, str]]:
        """解析提交历史"""
        commits = []
        if oneline:
            for line in log.strip().split('\n'):
                if line:
                    parts = line.split(' ', 1)
                    if len(parts) == 2:
                        commits.append({'hash': parts[0], 'message': parts[1]})
        return commits[:20]  # 最多返回 20 条

    async def git_diff(self, workspace: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """查看差异"""
        cached = args.get('cached', False)
        files = args.get('files', [])

        cmd = ['diff']
        if cached:
            cmd.append('--cached')
        if files:
            cmd.extend(files)

        result = self.run_git(workspace, cmd)

        if not result['success']:
            raise ValueError(f"Git diff failed: {result['stderr']}")

        return {
            'diff': result['stdout'],
            'hasChanges': bool(result['stdout'].strip())
        }

    async def git_branch(self, workspace: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """分支操作"""
        action = args.get('action')
        name = args.get('name')

        if action == 'list':
            cmd = ['branch', '-a']
        elif action == 'create':
            if not name:
                raise ValueError('Branch name is required for create')
            cmd = ['branch', name]
        elif action == 'delete':
            if not name:
                raise ValueError('Branch name is required for delete')
            cmd = ['branch', '-d', name]
        elif action == 'checkout':
            if not name:
                raise ValueError('Branch name is required for checkout')
            cmd = ['checkout', name]
        else:
            raise ValueError(f'Unknown action: {action}')

        result = self.run_git(workspace, cmd)

        if not result['success']:
            raise ValueError(f"Git branch {action} failed: {result['stderr']}")

        return {
            'success': True,
            'output': result['stdout'],
            'branches': self._parse_branches(result['stdout']) if action == 'list' else None
        }

    def _parse_branches(self, output: str) -> List[str]:
        """解析分支列表"""
        branches = []
        for line in output.strip().split('\n'):
            branch = line.strip().lstrip('* ').strip()
            if branch and not branch.startswith('remotes/'):
                branches.append(branch)
        return branches

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
        skill = GitOperationsSkill()
        asyncio.run(skill.run_runtime_mode())
    else:
        print("Usage: python index.py --runtime-mode")
        sys.exit(1)


if __name__ == '__main__':
    main()
