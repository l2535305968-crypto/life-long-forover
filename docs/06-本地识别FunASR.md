# 本地方言识别：FunASR

> 替代讯飞（有额度限制）的免费本地方案。**决定：用 FunASR，不用 spark-asr-dialect。**

## 为什么是这个决定

| | FunASR | spark-asr-dialect |
|--|--------|-------------------|
| 预训练权重 | ✅ 自带（SenseVoice / Paraformer / Fun-ASR-Nano） | ❌ 没有，要自己训 |
| 四川话 | ✅ Fun-ASR-Nano 覆盖四川/重庆等 26 种地域口音 | 需要从头训练，训完也难超 FunASR |
| 开箱即用 | ✅ `funasr-server` 一条命令起服务 | ❌ 需 GPU + 训练数天 |

## 四川数据集（5.8GB / 48,444 条）的用法

不是用来从零训练，而是**微调 FunASR 的 SenseVoice**（官方有"给 SenseVoice 增加方言/口音"的持续微调方案）。

### 数据已预处理好

```bash
python tools/prep_sichuan_data.py
```

产出 `tools/asr-data/`：
- `wav.scp` / `text`（全量 48,444 条）
- `train/wav.scp` + `train/text`（43,600 条）
- `val/wav.scp` + `val/text`（4,844 条）

### 微调（需 GPU，后续做）

SenseVoice 微调用 FunASR 官方 `sensevoice2jsonl` + `funasr-train`，参考
`D:\AI\skills\FunASR\examples\industrial_data_pretraining\sense_voice\CONTINUAL_FINETUNING_zh.md`。
从零训 spark-asr-dialect 不推荐（无基线、需 GPU+数天、不如 FunASR）。

## 本地识别服务（FunASR 自带的 OpenAI 兼容服务）

```bash
# 1. 在 conda 环境里装（需 torch，较大）
conda run -p D:\computer-caozuo\miniconda\envs\renshengzhishu pip install "funasr>=1.4.0" torch torchaudio modelscope

# 2. 起服务（CPU 用 sensevoice；有 NVIDIA 显卡用 fun-asr-nano 可识别四川话）
conda run -p D:\computer-caozuo\miniconda\envs\renshengzhishu funasr-server --model sensevoice --device cpu --port 8789
# 有 GPU：
#   funasr-server --model fun-asr-nano --device cuda --port 8789
```

## 接入《人生之书》

`.env` 里加一行，`/api/asr` 就会优先走本地 FunASR，失败再回讯飞：

```
LOCAL_ASR_URL=http://localhost:8789/v1/audio/transcriptions
```

（服务端已按 `LOCAL_ASR_URL` 做了本地兜底，详见 `server/server.mjs` 的 `handleAsr`。）

## 三条识别路线（最终）

1. **本地 FunASR**（`LOCAL_ASR_URL` 配了就用，免费无限额，四川话用 GPU 的 fun-asr-nano）
2. **讯飞云**（本地没配 FunASR 时用，有额度限制）
3. **浏览器内置 / 打字**（都没配时的最后兜底）
---

## 实现状态（本轮已落地，代码层完成）

| 环节 | 文件 | 状态 |
|------|------|------|
| 本地识别服务 | tools/funasr_asr_server.py | 已有（纯标准库 HTTP，模型启动时加载一次）；本轮加了 /health 与 --self-check |
| 服务端「本地优先、讯飞兜底」 | server/app.mjs 的 /api/asr | 已有；本轮修了 health：只配 LOCAL_ASR_URL 时 hasAsr 也认（原来只认讯飞 Key） |
| 前端开关 | web/js/asr.js | 已有（hasAsr 为真就开「按住说话」） |
| 测试 | test/local-asr-check.mjs | 全过（本地透传 / 本地空→讯飞兜底 / 本地挂掉优雅 503 / health.hasLocalAsr） |
| 安装脚本 | tools/install-funasr.ps1 | 已写（pip 装 funasr+torch+modelscope，清华镜像；--self-check 自动下模型） |
| 启动脚本 | tools/start-voice-servers.ps1 | 已写（8789 FunASR + 7861 Qwen3-TTS 一起起） |

### 怎么把它跑起来（在你自己终端里，沙箱装不了外部环境）

1. 装依赖（一次，约 2~3GB）：powershell -ExecutionPolicy Bypass -File tools\install-funasr.ps1
2. 起识别服务：powershell -ExecutionPolicy Bypass -File tools\start-voice-servers.ps1
   或单独：conda run -p D:\computer-caozuo\miniconda\envs\renshengzhishu python tools\funasr_asr_server.py --port 8789
3. .env 加一行：LOCAL_ASR_URL=http://127.0.0.1:8789/asr，重启 node server/server.mjs
4. 验证：浏览器开 http://localhost:8788/api/health → hasLocalAsr: true

> 四川话优先用 GPU 的 Fun-ASR-Nano：--model FunAudioLLM/Fun-ASR-Nano-2512 --device cuda
> （CPU 用默认 SenseVoiceSmall 就够，普通话/常见方言都能认）
