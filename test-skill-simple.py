#!/usr/bin/env python3
"""
简单的 Python 测试：直接测试 file-operations Skill
"""

import sys
import json
import subprocess
import os

def test_skill_direct():
    """直接测试 Skill Python 进程"""
    print("=== 测试 file-operations Skill ===\n")

    skill_path = os.path.join(os.path.dirname(__file__), 'skills/file-operations')

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

        # 测试 1: list 文件
        print("\n测试 1: file.list")
        request = {
            'id': 'test-1',
            'tool': 'list',
            'args': {'path': '.', 'depth': 2},
            'workspace': os.path.dirname(__file__)
        }
        proc.stdin.write(json.dumps(request) + '\n')
        proc.stdin.flush()

        response = json.loads(proc.stdout.readline())
        if response.get('error'):
            print(f"  ✗ 错误: {response['error']}")
        else:
            output = response['output']
            print(f"  ✓ 成功，找到 {len(output['paths'])} 个文件")
            print(f"  前 5 个文件: {output['paths'][:5]}")

        # 测试 2: write 文件
        print("\n测试 2: file.write")
        test_content = "测试内容\n来自 Python 测试脚本\n"
        request = {
            'id': 'test-2',
            'tool': 'write',
            'args': {
                'path': '.test-data/python-test.txt',
                'content': test_content
            },
            'workspace': os.path.dirname(__file__)
        }
        proc.stdin.write(json.dumps(request) + '\n')
        proc.stdin.flush()

        response = json.loads(proc.stdout.readline())
        if response.get('error'):
            print(f"  ✗ 错误: {response['error']}")
        else:
            output = response['output']
            print(f"  ✓ 成功，写入 {output['bytes']} 字节")

        # 测试 3: read 文件
        print("\n测试 3: file.read")
        request = {
            'id': 'test-3',
            'tool': 'read',
            'args': {'path': '.test-data/python-test.txt'},
            'workspace': os.path.dirname(__file__)
        }
        proc.stdin.write(json.dumps(request) + '\n')
        proc.stdin.flush()

        response = json.loads(proc.stdout.readline())
        if response.get('error'):
            print(f"  ✗ 错误: {response['error']}")
        else:
            output = response['output']
            print(f"  ✓ 成功，读取 {output['totalLines']} 行")
            print(f"  内容预览:\n{output['text'][:200]}")

        print("\n✓ 所有测试通过！")
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
    success = test_skill_direct()
    sys.exit(0 if success else 1)
