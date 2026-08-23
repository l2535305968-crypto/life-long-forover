#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 spark-asr-dialect\\数据集 里的四川话数据，整理成 ASR 训练的标准格式。

输入：D:\\AI\\skills\\spark-asr-dialect\\数据集\\*\\list.txt
      每行：`wavs/SCC00001.wav<TAB>四川话转写文本`
输出：tools/asr-data/ 下的
      - wav.scp        utt_id → wav 绝对路径
      - text           utt_id → 转写文本
      - train/wav.scp + train/text   训练集（90%）
      - val/wav.scp   + val/text     验证集（10%）

纯标准库，任何 Python 3 都能跑，不需要 torch / funasr。
"""
import os
import random
import pathlib

DATA_ROOT = r"D:\AI\skills\spark-asr-dialect\数据集"
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "asr-data")
VAL_RATIO = 0.10
SEED = 42


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    records = []  # (utt_id, wav_abs, text)

    for list_path in sorted(pathlib.Path(DATA_ROOT).rglob("list.txt")):
        base = list_path.parent
        with open(list_path, encoding="utf-8") as f:
            for line in f:
                line = line.rstrip("\n")
                if not line.strip() or "\t" not in line:
                    continue
                wav_rel, txt = line.split("\t", 1)
                txt = txt.strip()
                wav_abs = (base / wav_rel.strip()).resolve()
                if not txt or not wav_abs.exists():
                    continue
                # utt_id：相对数据根、去 .wav、把分隔符压成下划线，保证全局唯一
                utt = (
                    str(wav_abs.relative_to(pathlib.Path(DATA_ROOT)))
                    .replace("\\", "/")
                    .replace(".wav", "")
                    .replace("/", "_")
                )
                records.append((utt, str(wav_abs), txt))

    random.seed(SEED)
    random.shuffle(records)
    n_val = max(1, int(len(records) * VAL_RATIO))
    val = records[:n_val]
    train = records[n_val:]

    def write_split(folder, subset):
        d = os.path.join(OUT_DIR, folder)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "wav.scp"), "w", encoding="utf-8") as scp, \
             open(os.path.join(d, "text"), "w", encoding="utf-8") as txt_f:
            for utt, wav, txt in subset:
                scp.write(f"{utt} {wav}\n")
                txt_f.write(f"{utt} {txt}\n")

    # 全量
    with open(os.path.join(OUT_DIR, "wav.scp"), "w", encoding="utf-8") as scp, \
         open(os.path.join(OUT_DIR, "text"), "w", encoding="utf-8") as txt_f:
        for utt, wav, txt in sorted(records):
            scp.write(f"{utt} {wav}\n")
            txt_f.write(f"{utt} {txt}\n")

    write_split("train", train)
    write_split("val", val)

    print(f"共 {len(records)} 条（train {len(train)} / val {len(val)}）")
    print(f"输出目录：{OUT_DIR}")
    print("文件：wav.scp / text / train/{wav.scp,text} / val/{wav.scp,text}")


if __name__ == "__main__":
    main()
