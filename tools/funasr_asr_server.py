#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地 FunASR 识别服务 —— 给《人生之书》server.mjs 的 LOCAL_ASR_URL 用。

接收：POST /asr  body={"audio": "<base64 16k/16bit 单声道 PCM>", "dialect": "chuanyu"}
返回：{"text": "识别文本"}

用法（先装 funasr + torch）：
  conda run -p D:\\computer-caozuo\\miniconda\\envs\\renshengzhishu \
    python tools\\funasr_asr_server.py --model iic/SenseVoiceSmall --device cpu --port 8789

有 NVIDIA 显卡、想要四川话口音更强，换：
  --model FunAudioLLM/Fun-ASR-Nano-2512 --device cuda

纯标准库 HTTP 服务，不依赖 Flask。模型只在启动时加载一次。
"""
import argparse
import base64
import json
import os
import struct
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer

MODEL = None
MODEL_NAME = "iic/SenseVoiceSmall"
DEVICE = "cpu"


def pcm16_to_wav(pcm: bytes, rate=16000, channels=1) -> bytes:
    """给裸 PCM16 加 WAV 头，供 FunASR 读取。"""
    bits = 16
    byte_rate = rate * channels * bits // 8
    block_align = channels * bits // 8
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", 36 + len(pcm),
        b"WAVE", b"fmt ", 16, 1, channels, rate, byte_rate, block_align, bits,
        b"data", len(pcm),
    )
    return header + pcm


def transcribe(pcm: bytes) -> str:
    wav = pcm16_to_wav(pcm)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(wav)
        path = f.name
    try:
        res = MODEL.generate(input=path)
        text = ""
        if res and isinstance(res, list) and res[0]:
            text = (res[0].get("text") or "").strip()
        return text
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.rstrip("/") == "/health":
            self._reply(200, {
                "ok": True,
                "model": MODEL_NAME,
                "device": DEVICE,
                "ready": MODEL is not None,
            })
        else:
            self._reply(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if self.path.rstrip("/") != "/asr":
            self.send_response(404)
            self.end_headers()
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length)
            body = json.loads(raw or b"{}")
            pcm = base64.b64decode(body.get("audio", "") or "")
            text = transcribe(pcm)
            self._reply(200, {"text": text})
        except Exception as e:  # noqa: BLE001
            self._reply(500, {"text": "", "error": str(e)})

    def _reply(self, status, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):  # 不打印正文，保护隐私
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="iic/SenseVoiceSmall")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--port", type=int, default=8789)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--self-check", action="store_true", help="只检查环境/模型是否就绪，不加载模型不起服务")
    args = ap.parse_args()

    global MODEL, MODEL_NAME, DEVICE
    MODEL_NAME = args.model
    DEVICE = args.device

    if args.self_check:
        try:
            import funasr  # noqa: F401
            print(f"  funasr 已安装（{getattr(funasr, '__version__', '?')}）")
        except Exception as e:
            print(f"  funasr 未安装：{e}")
            print("  先跑：tools/install-funasr.ps1（或 conda run -p D:\\computer-caozuo\\miniconda\\envs\\renshengzhishu pip install funasr torch torchaudio modelscope）")
            sys.exit(2)
        try:
            from modelscope.hub.snapshot_download import snapshot_download
            p = snapshot_download(args.model)
            print(f"  模型 {args.model} 已就位：{p}")
        except Exception as e:
            print(f"  模型未就位：{e}（首次会自动下载约 1GB，稍等）")
        print("  环境检查完成。")
        return

    from funasr import AutoModel  # 延迟导入，装好 funasr 才需要
    MODEL = AutoModel(model=args.model, device=args.device, disable_update=True)

    srv = HTTPServer((args.host, args.port), Handler)
    print(f"FunASR 本地识别已就绪：http://{args.host}:{args.port}/asr  (model={args.model}, device={args.device})")
    srv.serve_forever()


if __name__ == "__main__":
    main()
