#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
qwen3_tts_server.py — 《人生之书》温暖声音朗读服务（docs/07 路 A 落地）。

把 AI 的话念成有烟火气的 wav，替代浏览器机器音。调用方式照搬配音台技能
（D:\AI\dyjx\video-voiceover-cloner\video-voiceover-cloner\scripts\voiceover_engine.py）：
  1. 第一次启动时用 Qwen3-TTS VoiceDesign 模型设计一个"自然亲和"的合成音色（锚点），
     存成 tools/voice/anchor.wav；
  2. 之后每句都用 Qwen3-TTS Base 模型克隆这个合成锚点来念（generate_voice_clone），
     声音稳定、不飘，完全离线。

接口：
  POST /tts   {"text": "要念的话", "rate": 0.95}   → 200 audio/wav（24k PCM16）
  GET  /health                                      → {"ok": true, "device": "...", "anchor": true, "ready": true}

用法（先装好环境，见 tools/install-qwen3tts.ps1）：
  & 'D:\AI\ai_voice\Qwen3TTS-Env\venv\Scripts\python.exe' tools\qwen3_tts_server.py --port 7861
  有 NVIDIA 显卡会自动走 CUDA；CPU 也能跑（慢一些）。

模型路径默认指向配音台的本地模型（不用重复下载）；也可用 --model-root 或
环境变量 QWEN3_MODEL_ROOT 改。纯标准库 HTTP 服务，模型只在需要时加载。
"""
import argparse
import base64
import gc
import json
import os
import re
import struct
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# ---------- 默认路径 ----------
HERE = Path(__file__).resolve().parent

# SoX 是 qwen_tts 音频归一化（speech_vq.sox_norm）的硬依赖。
# 优先用项目内自带的（tools 同级 .runtime\sox），找不到再靠系统 PATH。
_SOX_DIR = HERE.parent / ".runtime" / "sox" / "sox-14.4.2"
if _SOX_DIR.exists() and (_SOX_DIR / "sox.exe").exists():
    os.environ["PATH"] = str(_SOX_DIR) + os.pathsep + os.environ.get("PATH", "")
else:
    print("[qwen3tts] 提示：项目内没找到 SoX（.runtime\sox），若后面报 sox 错误，"
          "请把 sox-14.4.2 解压到 tools 目录旁的 .runtime\sox 下", flush=True)
DEFAULT_MODEL_ROOT = (
    r"D:\AI\dyjx\video-voiceover-cloner\video-voiceover-cloner\.runtime\models"
)
ANCHOR_DIR = HERE / "voice"
ANCHOR_WAV = ANCHOR_DIR / "anchor.wav"
ANCHOR_META = ANCHOR_DIR / "anchor.json"

# 锚点音色设计指令：自然亲和、像有耐心的晚辈陪长辈说话
ANCHOR_INSTRUCT = (
    "成年、自然亲和，音色清晰温暖，音高中等，语速适中，情绪亲切自然，"
    "像一位有耐心的晚辈陪长辈聊天，声音里有笑意，不端着、不播音腔。"
)
ANCHOR_TEXT = (
    "姥爷，您慢慢说，我听着呢。"
    "那些年的事儿，您还记得的真不少，咱们一样一样聊。"
)

QWEN_BASE_ID = "Qwen/Qwen3-TTS-12Hz-0.6B-Base"
QWEN_DESIGN_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"

_lock = threading.Lock()
_model = None          # 当前加载的 Qwen3TTSModel（Base 克隆模型）
_model_kind = None     # "base" | "design"
_anchor_prompt = None  # 克隆用音色 prompt（模型无关，Base 模型用它念）
_ready = False


def log(msg: str) -> None:
    print(f"[qwen3tts] {time.strftime('%H:%M:%S')} {msg}", flush=True)


# ---------- 设备选择（同配音台：有显存够的卡走 CUDA，否则 CPU） ----------
def pick_device(torch_module) -> tuple[str, object]:
    if os.environ.get("QWEN3TTS_FORCE_CPU") == "1" or not torch_module.cuda.is_available():
        return "cpu", torch_module.float32
    try:
        cands = [
            (i, int(torch_module.cuda.get_device_properties(i).total_memory))
            for i in range(torch_module.cuda.device_count())
        ]
        i, mem = max(cands, key=lambda x: x[1])
        if mem < 7 * 1024**3:
            return "cpu", torch_module.float32
        cap = int(torch_module.cuda.get_device_capability(i)[0])
        dtype = torch_module.bfloat16 if cap >= 8 else torch_module.float16
        return f"cuda:{i}", dtype
    except Exception:
        return "cpu", torch_module.float32


def load_model(kind: str, model_root: Path, cache_dir: Path):
    """加载 Base（克隆）或 VoiceDesign（设计）模型。kind: 'base' | 'design'"""
    global _model, _model_kind
    if _model is not None and _model_kind == kind:
        return _model
    if _model is not None:
        del _model
        _model = None
        gc.collect()
    # 内存护栏：可用内存不够就直接说明，别让系统把进程杀掉
    try:
        import psutil
        free_gb = psutil.virtual_memory().available / 1024**3
        need_gb = 8.0 if os.environ.get('QWEN3TTS_FORCE_CPU') == '1' else 3.0
        if free_gb < need_gb:
            raise RuntimeError(
                f'可用内存只有 {free_gb:.1f} GB，加载模型至少需要约 {need_gb} GB。'
                '请先关掉浏览器、剪映等大程序，腾出内存再起服务。'
            )
    except RuntimeError:
        raise
    except Exception:
        pass
    import torch
    from qwen_tts import Qwen3TTSModel

    device_map, dtype = pick_device(torch)
    log(f"设备选择：{device_map} / {dtype}（cuda 可用={torch.cuda.is_available()}）")
    if kind == "design":
        local = model_root / "Qwen3-TTS-12Hz-1.7B-VoiceDesign"
        remote = QWEN_DESIGN_ID
    else:
        local = model_root / "Qwen3-TTS-12Hz-0.6B-Base"
        remote = QWEN_BASE_ID
    source = str(local) if (local / "model.safetensors").exists() else remote
    log(f"加载 {kind} 模型：{source}（device={device_map}）")
    m = Qwen3TTSModel.from_pretrained(
        source,
        device_map=device_map,
        dtype=dtype,
        attn_implementation="sdpa",
        cache_dir=str(cache_dir),
    )
    _model = m
    _model_kind = kind
    return m


def ensure_anchor(model_root: Path, cache_dir: Path) -> None:
    """没有锚点时，用 VoiceDesign 设计一个合成音色并落盘。"""
    global _anchor_prompt, _ready
    if ANCHOR_WAV.exists() and ANCHOR_META.exists():
        _ready = True
        return
    ANCHOR_DIR.mkdir(parents=True, exist_ok=True)
    design = load_model("design", model_root, cache_dir)
    try:
        log("设计合成音色（首次约 1~3 分钟）…")
        wavs, sr = design.generate_voice_design(
            text=ANCHOR_TEXT,
            language="Chinese",
            instruct=ANCHOR_INSTRUCT,
            do_sample=True,
            temperature=0.85,
            top_p=0.9,
            repetition_penalty=1.05,
        )
        if not wavs or not sr:
            raise RuntimeError("generate_voice_design 返回空")
        wave = wavs[0]
        import numpy as np
        arr = np.asarray(wave, dtype=np.float32).reshape(-1)
        with open(ANCHOR_WAV, "wb") as f:
            f.write(pcm16_wav(arr, int(sr)))
        ANCHOR_META.write_text(
            json.dumps({"sr": int(sr), "text": ANCHOR_TEXT, "instruct": ANCHOR_INSTRUCT}, ensure_ascii=False),
            encoding="utf-8",
        )
        log(f"锚点音色已生成：{ANCHOR_WAV.name}（{int(sr)}Hz）")
    finally:
        # 设计完就卸掉，省内存，换成 Base 克隆模型
        global _model, _model_kind
        if _model is not None and _model_kind == "design":
            del _model
            _model = None
            _model_kind = None
            gc.collect()
    _ready = True


def get_anchor_prompt(model_root: Path, cache_dir: Path):
    """用 Base 模型把锚点 wav 编成克隆 prompt（只编一次，缓存）。"""
    global _anchor_prompt
    if _anchor_prompt is not None:
        return _anchor_prompt
    meta = json.loads(ANCHOR_META.read_text(encoding="utf-8"))
    base = load_model("base", model_root, cache_dir)
    _anchor_prompt = base.create_voice_clone_prompt(
        ref_audio=str(ANCHOR_WAV),
        ref_text=meta.get("text") or None,
        x_vector_only_mode=False,
    )
    return _anchor_prompt


# ---------- wav 与变速 ----------
def pcm16_wav(samples, rate: int) -> bytes:
    import numpy as np
    pcm = np.clip(samples, -1.0, 1.0)
    pcm = (pcm * 32767).astype("<i2")
    data = pcm.tobytes()
    byte_rate = rate * 2
    hdr = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", 36 + len(data), b"WAVE", b"fmt ", 16, 1, 1, rate, byte_rate, 2, 16,
        b"data", len(data),
    )
    return hdr + data


def resample_speed(samples, rate: float):
    """线性重采样实现变速（rate<1 变慢，>1 变快），不依赖 scipy。"""
    import numpy as np
    n = len(samples)
    out_len = max(1, int(n / rate))
    idx = np.minimum((np.arange(out_len, dtype=np.float64) * rate), n - 1)
    i0 = idx.astype(np.int64)
    frac = (idx - i0).astype(np.float32)
    i1 = np.minimum(i0 + 1, n - 1)
    return (samples[i0] * (1 - frac) + samples[i1] * frac).astype(np.float32)


def estimate_max_tokens(text: str) -> int:
    """按配音台的估算：中文字数→秒数→token 数，夹在 [640, 2048]。"""
    import math
    cjk = len(re.findall(r"[\u3400-\u9fff]", text))
    word = len(re.findall(r"[A-Za-z0-9]+", text))
    other = max(0, len(text.strip()) - cjk)
    seconds = cjk / 3.2 + word / 2.3 + other / 18.0
    est = math.ceil(max(4.0, seconds) * 12 * 2.5 + 128)
    return max(640, min(2048, est))


def synthesize(text: str, rate: float, model_root: Path, cache_dir: Path) -> bytes:
    """整段文字 → 24k PCM16 wav 字节。一次只合成一句。"""
    global _ready
    with _lock:
        if not _ready:
            ensure_anchor(model_root, cache_dir)
        prompt = get_anchor_prompt(model_root, cache_dir)
        base = load_model("base", model_root, cache_dir)
        wavs, sr = base.generate_voice_clone(
            text=text,
            language="Chinese",
            voice_clone_prompt=prompt,
            non_streaming_mode=True,
            do_sample=True,
            temperature=0.78,
            top_p=0.90,
            top_k=50,
            repetition_penalty=1.05,
            subtalker_dosample=True,
            subtalker_temperature=0.78,
            subtalker_top_p=0.90,
            subtalker_top_k=50,
            max_new_tokens=estimate_max_tokens(text),
        )
        if not wavs or not sr:
            raise RuntimeError("generate_voice_clone 返回空")
        import numpy as np
        wave = np.asarray(wavs[0], dtype=np.float32).reshape(-1)
        if abs(rate - 1.0) > 0.001:
            wave = resample_speed(wave, max(0.7, min(1.3, rate)))
        return pcm16_wav(wave, int(sr))


# ---------- HTTP ----------
class Handler(BaseHTTPRequestHandler):
    model_root = None
    cache_dir = None

    def _send_json(self, status, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.rstrip("/") == "/health":
            self._send_json(200, {
                "ok": True,
                "ready": _ready,
                "anchor": ANCHOR_WAV.exists(),
                "device": _model_kind or "idle",
                "port": self.server.server_port,
            })
        else:
            self._send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if self.path.rstrip("/") != "/tts":
            self._send_json(404, {"ok": False, "error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            text = (body.get("text") or "").strip()
            if not text:
                self._send_json(400, {"ok": False, "error": "缺少 text"})
                return
            if len(text) > 2000:
                self._send_json(413, {"ok": False, "error": "text 太长（最多 2000 字）"})
                return
            rate = float(body.get("rate") or 1.0)
            started = time.time()
            wav = synthesize(text, rate, self.model_root, self.cache_dir)
            log(f"念完 {len(text)} 字，用时 {time.time() - started:.1f}s")
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(wav)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(wav)
        except Exception as e:  # noqa: BLE001
            log(f"合成失败：{e}")
            self._send_json(500, {"ok": False, "error": str(e)})

    def log_message(self, *args):
        pass  # 不打印请求正文，保护隐私


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=7861)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--model-root", default=os.environ.get("QWEN3_MODEL_ROOT", DEFAULT_MODEL_ROOT))
    ap.add_argument("--cache-dir", default=os.environ.get("HF_HUB_CACHE", str(HERE / ".hf-cache")))
    args = ap.parse_args()

    model_root = Path(args.model_root)
    cache_dir = Path(args.cache_dir)
    if not (model_root / "Qwen3-TTS-12Hz-0.6B-Base").exists():
        log(f"警告：{model_root} 下没找到 Qwen3-TTS 模型。先跑 tools/install-qwen3tts.ps1 下载模型。")
    Handler.model_root = model_root
    Handler.cache_dir = cache_dir
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    log(f"温暖声音服务已就绪：http://{args.host}:{args.port}  （模型：{model_root}）")
    log("首次 /tts 会先设计音色再加载克隆模型，可能等 1~3 分钟，之后每句约 1~5 秒。")
    srv.serve_forever()


if __name__ == "__main__":
    main()
