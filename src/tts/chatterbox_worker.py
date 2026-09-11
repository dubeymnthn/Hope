#!/usr/bin/env python3
"""
Chatterbox TTS Worker script for local speech synthesis.
Loads ChatterboxTTS once into memory, processes synthesis requests, and outputs 24kHz PCM WAV.
"""

import sys
import os

# Disable noisy tqdm stdout/stderr flooding to prevent Node buffer overflow
os.environ["TQDM_DISABLE"] = "1"

import time
import json
import argparse
from pathlib import Path

# Fix resemble-perth dummy watermarker fallback if C-extension is absent
import perth
if perth.PerthImplicitWatermarker is None:
    perth.PerthImplicitWatermarker = perth.DummyWatermarker

import torch
# Optimize PyTorch CPU threading for 12-core system
torch.set_num_threads(8)

import soundfile as sf
from chatterbox import ChatterboxTTS

_model = None

def get_model(device="cpu"):
    global _model
    if _model is None:
        t0 = time.time()
        print(f"[ChatterboxWorker] Loading model onto {device}...", file=sys.stderr)
        _model = ChatterboxTTS.from_pretrained(device=device)
        print(f"[ChatterboxWorker] Model loaded in {time.time()-t0:.2f}s", file=sys.stderr)
    return _model

def synthesize_text(text: str, output_path: str, device: str = "cpu"):
    model = get_model(device)
    t0 = time.time()
    wav = model.generate(text)
    duration = time.time() - t0
    
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    audio_data = wav.squeeze(0).numpy()
    sf.write(output_path, audio_data, model.sr)
    audio_len = len(audio_data) / float(model.sr)
    
    result = {
        "audioPath": output_path,
        "sampleRate": model.sr,
        "duration": round(audio_len, 3),
        "computeTime": round(duration, 3)
    }
    return result

def main():
    parser = argparse.ArgumentParser(description="Chatterbox Local TTS Worker")
    parser.add_argument("--text", type=str, help="Text to synthesize")
    parser.add_argument("--output", type=str, help="Output WAV path")
    parser.add_argument("--batch-json", type=str, help="Path to JSON file containing array of {id, text, output}")
    parser.add_argument("--device", type=str, default="cpu", help="Compute device (cpu)")
    args = parser.parse_args()

    if args.batch_json:
        with open(args.batch_json, "r", encoding="utf-8") as f:
            items = json.load(f)
        
        results = []
        for idx, item in enumerate(items):
            print(f"[ChatterboxWorker] Synthesizing Scene {idx+1}/{len(items)} ({item.get('id', '')})...", file=sys.stderr)
            res = synthesize_text(item["text"], item["output"], args.device)
            res["id"] = item.get("id", "")
            print(f"[ChatterboxWorker] Completed Scene {idx+1}/{len(items)} in {res['computeTime']}s (Audio duration: {res['duration']}s)", file=sys.stderr)
            results.append(res)
        
        print(json.dumps(results))
        return

    if not args.text or not args.output:
        print("Error: either --batch-json or both --text and --output are required", file=sys.stderr)
        sys.exit(1)

    result = synthesize_text(args.text, args.output, args.device)
    print(json.dumps(result))

if __name__ == "__main__":
    main()
