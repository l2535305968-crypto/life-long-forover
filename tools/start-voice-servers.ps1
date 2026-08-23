# start-voice-servers.ps1 - 一起起《人生之书》的两个本地语音服务：
#   8789  FunASR 本地方言识别（tools/funasr_asr_server.py）
#   7861  Qwen3-TTS 温暖声音朗读（tools/qwen3_tts_server.py）
# 在【你自己的终端】里跑（会常驻两个后台进程）：
#   powershell -ExecutionPolicy Bypass -File D:\life-long-forover\tools\start-voice-servers.ps1
# 没装对应环境时对应服务会跳过并提示先跑 install-*.ps1。

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$RenshengPy = 'D:\computer-caozuo\miniconda\envs\renshengzhishu\python.exe'
$QwenVenvPy = 'D:\AI\ai_voice\Qwen3TTS-Env\venv\Scripts\python.exe'

# ---- FunASR（8789）----
Write-Host ''
Write-Host '==== FunASR 本地方言识别（8789）====' -ForegroundColor Cyan
$asrOk = $false
if (Test-Path $RenshengPy) {
    try {
        & $RenshengPy -c "import funasr" 2>$null
        if ($LASTEXITCODE -eq 0) {
            Start-Process -WindowStyle Hidden -FilePath $RenshengPy -ArgumentList @((Join-Path $Root 'tools\funasr_asr_server.py'), '--port', '8789')
            $asrOk = $true
            Write-Host '已启动（后台）。验证：Get-NetTCPConnection -LocalPort 8789'
        } else {
            Write-Host 'renshengzhishu 环境里还没装 funasr，跳过。先跑 tools\install-funasr.ps1' -ForegroundColor Yellow
        }
    } catch {
        Write-Host 'funasr 启动失败：' $_.Exception.Message -ForegroundColor Yellow
    }
} else {
    Write-Host "没找到 $RenshengPy，跳过 FunASR" -ForegroundColor Yellow
}

# ---- Qwen3-TTS（7861）----
Write-Host ''
Write-Host '==== Qwen3-TTS 温暖声音（7861）====' -ForegroundColor Cyan
$ttsOk = $false
if (Test-Path $QwenVenvPy) {
    try {
        & $QwenVenvPy -c "from qwen_tts import Qwen3TTSModel" 2>$null
        if ($LASTEXITCODE -eq 0) {
            Start-Process -WindowStyle Hidden -FilePath $QwenVenvPy -ArgumentList @((Join-Path $Root 'tools\qwen3_tts_server.py'), '--port', '7861')
            $ttsOk = $true
            Write-Host '已启动（后台）。首次 /tts 会先设计音色，可能等 1~3 分钟。'
        } else {
            Write-Host 'Qwen3TTS 环境里还没装 qwen-tts，跳过。先跑 tools\install-qwen3tts.ps1' -ForegroundColor Yellow
        }
    } catch {
        Write-Host 'qwen3tts 启动失败：' $_.Exception.Message -ForegroundColor Yellow
    }
} else {
    Write-Host "没找到 $QwenVenvPy，跳过 Qwen3-TTS" -ForegroundColor Yellow
}

Write-Host ''
if ($asrOk -or $ttsOk) {
    Start-Sleep -Seconds 2
    if ($asrOk) {
        try { $h = Invoke-RestMethod 'http://127.0.0.1:8789/health' -TimeoutSec 5; Write-Host ("FunASR /health: ok=" + $h.ok) } catch { Write-Host 'FunASR /health 还没起来（模型加载中？稍后手动验证）' -ForegroundColor Yellow }
    }
    if ($ttsOk) {
        try { $h = Invoke-RestMethod 'http://127.0.0.1:7861/health' -TimeoutSec 5; Write-Host ("Qwen3-TTS /health: ok=" + $h.ok) } catch { Write-Host 'Qwen3-TTS /health 还没起来（首次加载中？稍后手动验证）' -ForegroundColor Yellow }
    }
    Write-Host ''
    Write-Host '两个服务起完后，重启人生之书 node server/server.mjs，打开 /api/health 确认：' -ForegroundColor Green
    Write-Host '  hasLocalAsr: true   （本地识别）'
    Write-Host '  hasTts:      true   （温暖声音）'
} else {
    Write-Host '两个服务都没起来。先分别跑 install-funasr.ps1 和 install-qwen3tts.ps1。' -ForegroundColor Yellow
}
