# install-qwen3tts.ps1 - 给《人生之书》装温暖声音朗读（Qwen3-TTS，docs/07 路 A）。
# 在【你自己的终端】里跑（沙箱装不了外部环境）：
#   powershell -ExecutionPolicy Bypass -File D:\life-long-forover\tools\install-qwen3tts.ps1
# 模型不用下载：直接复用配音台已就位的本地模型（约 7.3GB）。
# 装完跑 tools\start-voice-servers.ps1 一起起服务。

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Venv = 'D:\AI\ai_voice\Qwen3TTS-Env\venv'
$VenvPy = "$Venv\Scripts\python.exe"
$Mirror = 'https://pypi.tuna.tsinghua.edu.cn/simple'
$ModelRoot = 'D:\AI\dyjx\video-voiceover-cloner\video-voiceover-cloner\.runtime\models'

if (-not (Test-Path $VenvPy)) {
    Write-Host "没找到 $VenvPy" -ForegroundColor Red
    Write-Host '先建环境：python -m venv D:\AI\ai_voice\Qwen3TTS-Env\venv'
    exit 1
}
if (-not (Test-Path "$ModelRoot\Qwen3-TTS-12Hz-0.6B-Base")) {
    Write-Host "没找到本地模型目录 $ModelRoot" -ForegroundColor Red
    exit 1
}

Write-Host '==> 先对齐 torch：qwen-tts 0.1.1 锁 transformers 4.57.3，需要 torch>=2.2；这台机器有 NVIDIA，用 cu121 版（跟已有驱动兼容）...' -ForegroundColor Cyan
& $VenvPy -m pip install --upgrade pip --index-url $Mirror
# torch 2.5.1+cu121：兼容 transformers 4.57.3，也支持 numpy 2（2.1.0 太老会崩）
& $VenvPy -m pip install "torch==2.5.1+cu121" "torchaudio==2.5.1+cu121" --index-url https://download.pytorch.org/whl/cu121 --extra-index-url $Mirror

Write-Host '==> 装 qwen-tts 及依赖（清华镜像）...' -ForegroundColor Cyan
# qwen-tts 0.1.1 与配音台测试过的版本一致
& $VenvPy -m pip install "qwen-tts==0.1.1" "soundfile" "numpy" --index-url $Mirror

Write-Host '==> 快速自检（import + 版本）...' -ForegroundColor Cyan
& $VenvPy -c "from qwen_tts import Qwen3TTSModel; import torch, transformers; print('qwen-tts OK, torch', torch.__version__, '+cu121, transformers', transformers.__version__)"

Write-Host ''
Write-Host '装好了。现在可以：' -ForegroundColor Green
Write-Host '  1) 起温暖声音服务： powershell -ExecutionPolicy Bypass -File ' (Join-Path $Root 'tools\start-voice-servers.ps1')
Write-Host '  2) 确认 .env 有 TTS_URL=http://127.0.0.1:7861/tts（默认就是这个）'
Write-Host '  3) 重启人生之书： node server/server.mjs'
Write-Host '  4) 浏览器打开 /api/health，hasTts 应为 true；AI 说话就是暖声音了'
Write-Host '首次念第一句会先设计音色（1~3 分钟），之后每句约 1~5 秒。'
