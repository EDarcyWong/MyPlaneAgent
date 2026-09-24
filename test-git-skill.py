#!/usr/bin/env python3
"""
测试 Git Operations Skill
"""

import sys
import json
import subprocess
import os

def test_git_skill():
    """测试 Git Skill"""
    print("=== 测试 Git Operations Skill ===\n")

    skill_path = os.path.join(os.path.dirname(__file__), 'skills/git-operations')
    workspace = os.path.dirname(__file__)

    # 启动 Skill 进程
    proc = subprocess.Popen(
        [sys.executable, 'index.py', '--runtime-mode'],
        cwd=skill_path,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1
    )

    try:
        # 等待 READY 信号
        ready_line = proc.stdout.readline()
        print(f"Skill 启动: {ready_line.strip()}")

        # 测试 1: git.status
        print("\n测试 1: git.status")
        request = {
            'id': 'test-1',
            'tool': 'status',
            'args': {'short': True},
            'workspace': workspace
        }
        proc.stdin.write(json.dumps(request) + '\n')
        proc.stdin.flush()

        response = json.loads(proc.stdout.readline())
        if response.get('error'):
            print(f"  ✗ 错误: {response['error']}")
        else:
            output = response['output']
            print(f"  ✓ 成功")
            print(f"  仓库状态: {'干净' if output.get('clean') else '有更改'}")

        # 测试 2: git.log
        print("\n测试 2: git.log")
        request = {
            'id': 'test-2',
            'tool': 'log',
            'args': {'limit': 5, 'oneline': True},
            'workspace': workspace
        }
        proc.stdin.write(json.dumps(request) + '\n')
        proc.stdin.flush()

        response = json.loads(proc.stdout.readline())
        if response.get('error'):
            print(f"  ✗ 错误: {response['error']}")
        else:
            output = response['output']
            commits = output.get('commits', [])
            print(f"  ✓ 成功，找到 {len(commits)} 个提交")
            for commit in commits[:3]:
                print(f"    - {commit.get('hash', 'N/A')}: {commit.get('message', 'N/A')[:50]}")

        # 测试 3: git.branch (list)
        print("\n测试 3: git.branch list")
        request = {
            'id': 'test-3',
            'tool': 'branch',
            'args': {'action': 'list'},
            'workspace': workspace
        }
        proc.stdin.write(json.dumps(request) + '\n')
        proc.stdin.flush()

        response = json.loads(proc.stdout.readline())
        if response.get('error'):
            print(f"  ✗ 错误: {response['error']}")
        else:
            output = response['output']
            branches = output.get('branches', [])
            print(f"  ✓ 成功，找到 {len(branches)} 个分支")
            for branch in branches[:5]:
                print(f"    - {branch}")

        # 测试 4: git.diff
        print("\n测试 4: git.diff")
        request = {
            'id': 'test-4',
            'tool': 'diff',
            'args': {},
            'workspace': workspace
        }
        proc.stdin.write(json.dumps(request) + '\n')
        proc.stdin.flush()

        response = json.loads(proc.stdout.readline())
        if response.get('error'):
            print(f"  ✗ 错误: {response['error']}")
        else:
            output = response['output']
            has_changes = output.get('hasChanges', False)
            print(f"  ✓ 成功")
            print(f"  工作区{'有' if has_changes else '无'}未提交的更改")

        print("\n✓ Git Skill 测试通过！")
        return True

    except Exception as e:
        print(f"\n✗ 测试失败: {e}")
        stderr = proc.stderr.read()
        if stderr:
            print(f"stderr: {stderr}")
        return False

    finally:
        proc.terminate()
        proc.wait(timeout=3)

if __name__ == '__main__':
    success = test_git_skill()
    sys.exit(0 if success else 1)
