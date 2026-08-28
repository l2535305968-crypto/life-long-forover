#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""阿里云 ECS 部署辅助：通过 Paramiko 执行远程命令 / 上传文件。
用法:
  python tools/ecs_ssh.py run   "<命令>"    # 执行单条远程命令
  python tools/ecs_ssh.py upload <本地> <远程>   # 上传文件（scp 风格）
"""
import sys
import paramiko

HOST = '8.137.13.183'
USER = 'root'
PASS = 'l123ch456aL@'
PORT = 22

def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, port=PORT, username=USER, password=PASS, timeout=15)
    return c

def main():
    if len(sys.argv) < 2:
        print(__doc__); return 1
    action = sys.argv[1]
    c = connect()
    if action == 'run':
        cmd = sys.argv[2]
        stdin, stdout, stderr = c.exec_command(cmd, timeout=300)
        out = stdout.read().decode('utf-8', 'replace')
        err = stderr.read().decode('utf-8', 'replace')
        if out: print(out)
        if err: print('[stderr]', err, file=sys.stderr)
    elif action == 'upload':
        local, remote = sys.argv[2], sys.argv[3]
        # 确保远端父目录存在
        rdir = remote.rsplit('/', 1)[0]
        c.exec_command('mkdir -p "' + rdir + '"', timeout=30)[1].read()
        sftp = c.open_sftp()
        with open(local, 'rb') as f_in, sftp.open(remote, 'wb') as f_out:
            import shutil
            shutil.copyfileobj(f_in, f_out, 1024 * 256)
        sftp.close()
        stat = c.exec_command('ls -la "' + remote + '"', timeout=30)[1].read().decode('utf-8', 'replace')
        print(stat.strip())
        print('uploaded', local, '->', remote)
    else:
        print('unknown action', action); return 1
    c.close()
    return 0

if __name__ == '__main__':
    sys.exit(main())
