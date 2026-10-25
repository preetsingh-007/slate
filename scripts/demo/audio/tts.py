#!/usr/bin/env python3
"""
Text to speech for the demo's voice-over, run locally with Kokoro-82M (hexgrad/Kokoro-82M).

  python tts.py --narration narration.json --work <dir>

Reads every line of narration.json (the demo's parts and the trailer), applies the lexicon
(respellings, or Kokoro phonemes written /like this/), and writes one clip per line to
<dir>/tts/<hash>.wav: 48 kHz mono, leading and trailing silence trimmed, a light high-pass and
gentle compression, loudness normalised to -16 LUFS (measured, then a linear gain) and peaks
limited to -3 dBFS. Clips are cached by
text, voice and speed, so only changed lines are spoken again. <dir>/tts/manifest.json lists
each line's clip, duration and word timings (seconds into the clip), which the subtitles use.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys

import numpy as np
import soundfile as sf

FFMPEG = os.environ.get('FFMPEG', 'ffmpeg')
VERSION = 3  # bump to re-render every clip after changing the processing below
TARGET_LUFS = -16.0


def lines_of(narr):
    """(id, text, say) for every line: parts first, then the trailer."""
    out = []
    for part, lines in narr['parts'].items():
        for i, ln in enumerate(lines):
            out.append((f'{part}#{i}', ln['text'], ln.get('say', ln['text'])))
    for i, ln in enumerate(narr.get('trailer', {}).get('lines', [])):
        out.append((f'trailer#{i}', ln['text'], ln.get('say', ln['text'])))
    return out


def apply_lexicon(text, lexicon):
    """Respell words for the voice; a value in /slashes/ is a Kokoro phoneme string."""
    for word, spoken in lexicon.items():
        rep = f'[{word}]({spoken})' if spoken.startswith('/') else spoken
        pattern = r'(?<![\w\[])' + re.escape(word) + r'(?![\w\]])'
        text = re.sub(pattern, lambda _m, rep=rep: rep, text)
    return text


def run(args):
    return subprocess.run([FFMPEG, '-hide_banner', '-nostats', *args], capture_output=True, text=True, check=True)


def loudness(src, chain):
    """Integrated loudness (LUFS) of `src` after the filter `chain`."""
    o = run(['-i', src, '-af', f'{chain},ebur128=framelog=quiet', '-f', 'null', '-']).stderr
    return float(re.findall(r'I:\s+(-?[\d.]+) LUFS', o)[-1])


def normalise(src, dst):
    """
    Voice processing: a light high-pass, gentle compression (it evens out the level and lowers
    the peaks), a linear gain to TARGET_LUFS and a peak limiter at -3 dBFS; 48 kHz mono float.
    """
    chain = 'highpass=f=80:poles=2,acompressor=threshold=-22dB:ratio=2.5:attack=6:release=120:knee=4,aresample=48000'
    gain = TARGET_LUFS - loudness(src, chain)
    limit = 10 ** (-3 / 20)
    run(['-y', '-i', src, '-af', f'{chain},volume={gain:.2f}dB,alimiter=limit={limit:.4f}:level=0:attack=3:release=40', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_f32le', dst])


def trim(audio, sr, words, thresh_db=-42, pad=0.04):
    """Cuts leading and trailing silence (keeping `pad` s) and shifts the word timings."""
    hop = int(sr * 0.01)
    frames = np.abs(audio[: len(audio) // hop * hop]).reshape(-1, hop).max(axis=1)
    on = np.where(frames > 10 ** (thresh_db / 20))[0]
    if not len(on):
        return audio, words
    a = max(0, on[0] * hop - int(pad * sr))
    b = min(len(audio), (on[-1] + 1) * hop + int(pad * sr))
    off = a / sr
    return audio[a:b], [(w, max(0.0, s - off), max(0.0, e - off)) for w, s, e in words]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--narration', required=True)
    ap.add_argument('--work', required=True)
    ap.add_argument('--voice', help='override the voice in narration.json (e.g. af_bella, am_michael, bf_emma)')
    ap.add_argument('--speed', type=float)
    a = ap.parse_args()

    narr = json.load(open(a.narration, encoding='utf-8'))
    voice = a.voice or narr.get('voice', 'af_heart')
    speed = a.speed or narr.get('speed', 1.0)
    lexicon = narr.get('lexicon', {})
    out_dir = os.path.join(a.work, 'tts')
    os.makedirs(out_dir, exist_ok=True)
    manifest_path = os.path.join(out_dir, 'manifest.json')

    pipeline = None
    manifest = {}
    for lid, text, say in lines_of(narr):
        spoken = apply_lexicon(say, lexicon)
        key = hashlib.sha1(json.dumps([VERSION, voice, speed, spoken]).encode()).hexdigest()[:16]
        wav = os.path.join(out_dir, f'{key}.wav')
        meta = os.path.join(out_dir, f'{key}.json')
        if not (os.path.exists(wav) and os.path.exists(meta)):
            if pipeline is None:
                from kokoro import KPipeline

                # 'a' = American English; British voices (bf_*, bm_*) use 'b'
                pipeline = KPipeline(lang_code='b' if voice.startswith('b') else 'a', repo_id='hexgrad/Kokoro-82M')
            chunks, words, t = [], [], 0.0
            for r in pipeline(spoken, voice=voice, speed=speed, split_pattern=None):
                audio = r.audio.numpy()
                for tk in r.tokens or []:
                    if tk.start_ts is not None and tk.text.strip() and re.search(r'\w', tk.text):
                        words.append((tk.text, t + tk.start_ts, t + (tk.end_ts or tk.start_ts)))
                chunks.append(audio)
                t += len(audio) / 24000
            audio, words = trim(np.concatenate(chunks), 24000, words)
            raw = os.path.join(out_dir, f'{key}.raw.wav')
            sf.write(raw, audio, 24000, subtype='FLOAT')
            normalise(raw, wav)
            os.remove(raw)
            json.dump({'words': words}, open(meta, 'w'))
            print(f'  spoke {lid}: {text[:60]}', file=sys.stderr)
        info = sf.info(wav)
        manifest[lid] = {'file': wav, 'duration': info.frames / info.samplerate, 'text': text, 'spoken': spoken, 'words': json.load(open(meta))['words']}
    json.dump({'voice': voice, 'speed': speed, 'lines': manifest}, open(manifest_path, 'w'), indent=1, ensure_ascii=False)
    print(manifest_path)


if __name__ == '__main__':
    main()
