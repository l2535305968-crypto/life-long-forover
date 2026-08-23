# install-funasr.ps1 - 给《人生之书》装本地方言识别（FunASR，docs/06 路线）。
# 在【你自己的终端】里跑（沙箱装不了外部环境）：
#   powershell -ExecutionPolicy Bypass -File D:\life-long-forover\tools\install-funasr.ps1
# 装完再跑 tools\start-voice-servers.ps1 一起起服务。
# 然后在 .env 里加一行：LOCAL_ASR_URL=http://127.0.0.1:8789/asr

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Py = 'D:\computer-caozuo\miniconda\envs\renshengzhishu\python.exe'
$Mirror = 'https://pypi.tuna.tsinghua.edu.cn/simple'

if (-not (Test-Path $Py)) {
    Write-Host "没找到 $Py" -ForegroundColor Red
    Write-Host '先建环境：conda create -n renshengzhishu python=3.10 -y'
    exit 1
}

Write-Host '==> 安装 funasr + torch + torchaudio + modelscope（约 2~3GB，请耐心）...' -ForegroundColor Cyan
& $Py -m pip install --upgrade pip --index-url $Mirror
& $Py -m pip install "funasr>=1.4.0" torch torchaudio modelscope --index-url $Mirror

Write-Host '==> 环境自检（会自动下载 SenseVoice 模型，约 1GB）...' -ForegroundColor Cyan
& $Py (Join-Path $Root 'tools\funasr_asr_server.py') --self-check

Write-Host ''
Write-Host '装好了。现在可以：' -ForegroundColor Green
Write-Host '  1) 起识别服务：   powershell -ExecutionPolicy Bypass -File ' (Join-Path $Root 'tools\start-voice-servers.ps1')
Write-Host '  2) .env 加一行： LOCAL_ASR_URL=http://127.0.0.1:8789/asr'
Write-Host '  3) 重启人生之书： node server/server.mjs'
Write-Host '  4) 浏览器打开 /api/health，hasLocalAsr 应为 true'
