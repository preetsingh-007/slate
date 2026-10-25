#!/usr/bin/env python3
"""
Mixes the voice-over and the music for one video (called by build.mjs).

  python mix.py <job.json>

job.json: { "duration": s, "music": wav (already at the music loudness), "out": wav,
            "lines": [{ "file": wav, "t": s }], "duckDb": -8, "duckAttack": s, "duckRelease": s }

The voice clips are placed at their times (centred, -3 dB per side); the music is ducked under them by
volume automation: it starts to dip `duckAttack` s before each line, sits `duckDb` lower while
the voice speaks and comes back over `duckRelease` s after it (raised-cosine ramps, so the
movement is smooth). Writes 48 kHz stereo float WAV of exactly `duration` s, plus the ducked
music alone (<out>.music.wav) and the voice alone (<out>.voice.wav) for measurement.
"""
import json
import sys

import numpy as np
import soundfile as sf

SR = 48_000


def ramp(n):
    return 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, max(n, 1)))


def main():
    job = json.load(open(sys.argv[1]))
    n = int(round(job['duration'] * SR))
    voice = np.zeros(n)
    duck = np.zeros(n)  # 0 = full music, 1 = fully ducked
    att, rel = int(job.get('duckAttack', 0.3) * SR), int(job.get('duckRelease', 0.8) * SR)
    for ln in job['lines']:
        a, sr = sf.read(ln['file'], dtype='float64')
        assert sr == SR, f'{ln["file"]}: {sr} Hz'
        if a.ndim > 1:
            a = a.mean(axis=1)
        i = int(round(ln['t'] * SR))
        j = min(n, i + len(a))
        if i >= n:
            continue
        voice[i:j] += a[: j - i]
        # the duck: ramp down before the line, hold, ramp up after it
        s0 = max(0, i - att)
        if i > s0:
            duck[s0:i] = np.maximum(duck[s0:i], ramp(att)[att - (i - s0) :])
        duck[i:j] = 1.0
        e1 = min(n, j + rel)
        duck[j:e1] = np.maximum(duck[j:e1], ramp(rel)[::-1][: e1 - j])
    gain = 10 ** (job.get('duckDb', -8) * duck / 20)
    music, sr = sf.read(job['music'], dtype='float64', always_2d=True)
    assert sr == SR, f'music: {sr} Hz'
    m = np.zeros((n, 2))
    k = min(n, len(music))
    m[:k] = music[:k, :2] if music.shape[1] >= 2 else np.repeat(music[:k], 2, axis=1)
    m *= gain[:, None]
    # the voice in the centre at -3 dB per side, so the stereo voice keeps its loudness
    v2 = np.repeat(voice[:, None], 2, axis=1) * np.sqrt(0.5)
    out = m + v2
    base = job['out']
    sf.write(base, out.astype(np.float32), SR, subtype='FLOAT')
    sf.write(base.replace('.wav', '.music.wav'), m.astype(np.float32), SR, subtype='FLOAT')
    sf.write(base.replace('.wav', '.voice.wav'), v2.astype(np.float32), SR, subtype='FLOAT')
    print(f'{base}: {n / SR:.2f} s, peak {20 * np.log10(np.abs(out).max() + 1e-12):.1f} dBFS')


if __name__ == '__main__':
    main()
