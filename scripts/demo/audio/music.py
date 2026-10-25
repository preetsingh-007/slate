#!/usr/bin/env python3
"""
Original background music for the Slate demo, synthesised from scratch with numpy and scipy
(no samples, no downloaded music): a calm lo-fi / ambient piece at 84 BPM in C major.

  python music.py --duration 312.4 --sections 0,10.6,99.8,... --out music.wav

Layers: a warm detuned pad (I–V–vi–IV and related progressions), a plucked arpeggio, an
FM electric piano, a few bell notes, a sine bass and a soft kick, hat and rim. The texture
changes at every section start (snapped to the bar), so nothing loops: each section picks its
own progression, arpeggio pattern, voicing brightness and which layers play. It opens with a
filtered swell and ends on a held C chord that fades to silence exactly at --duration.
Output: 48 kHz stereo float WAV, peak-normalised to -3 dBFS (the mix sets the loudness).
"""
import argparse

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, oaconvolve, sosfilt

SR = 48_000
BPM = 84
BEAT = 60 / BPM
BAR = 4 * BEAT

# chords as (root pitch class, chord tones as pitch classes); colour tones keep it soft
CHORDS = {
    'C': (0, [0, 4, 7, 11, 2]),
    'G': (7, [7, 11, 2, 4]),
    'Am': (9, [9, 0, 4, 7]),
    'F': (5, [5, 9, 0, 4, 7]),
    'Em': (4, [4, 7, 11, 2]),
    'Dm': (2, [2, 5, 9, 0]),
}
PROGRESSIONS = [
    ['C', 'G', 'Am', 'F'],  # I–V–vi–IV
    ['Am', 'F', 'C', 'G'],  # vi–IV–I–V
    ['F', 'G', 'Em', 'Am'],  # IV–V–iii–vi
    ['C', 'Am', 'F', 'G'],  # I–vi–IV–V
    ['F', 'C', 'G', 'Am'],  # IV–I–V–vi
    ['Dm', 'G', 'C', 'Am'],  # ii–V–I–vi
]

# per-section textures: which layers play and how
TEXTURES = {
    'intro': dict(prog=0, arp=None, ep=False, bass=False, drums=0, bells=True, bright=0.35),
    'a': dict(prog=0, arp='up', ep=False, bass=True, drums=1, bells=False, bright=0.55),
    'b': dict(prog=1, arp='updown', ep=False, bass=True, drums=2, bells=False, bright=0.6),
    'c': dict(prog=3, arp=None, ep=True, bass=True, drums=2, bells=False, bright=0.5),
    'd': dict(prog=2, arp='sparse', ep=False, bass=False, drums=0, bells=True, bright=0.4),
    'e': dict(prog=4, arp='broken', ep=True, bass=True, drums=1, bells=False, bright=0.65),
    'f': dict(prog=5, arp='up', ep=False, bass=True, drums=1, bells=True, bright=0.5),
    'outro': dict(prog=0, arp='sparse', ep=False, bass=False, drums=0, bells=False, bright=0.4),
}
# section textures in order (repeating after the last); the final section is always the outro
ORDER = ['intro', 'a', 'b', 'c', 'd', 'e', 'b', 'f', 'd', 'c']


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def voicing(name, lo=55, hi=74):
    """Pad notes for a chord: each chord tone once, in a mid register."""
    _, pcs = CHORDS[name]
    notes = []
    for pc in pcs:
        n = lo + ((pc - lo) % 12)
        if n >= hi:
            n -= 12
        notes.append(n)
    return sorted(notes)


def lowpass(x, fc, order=2):
    return sosfilt(butter(order, fc, 'low', fs=SR, output='sos'), x, axis=0)


def highpass(x, fc, order=2):
    return sosfilt(butter(order, fc, 'high', fs=SR, output='sos'), x, axis=0)


def bandpass(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], 'band', fs=SR, output='sos'), x, axis=0)


class Track:
    """A stereo buffer that notes are added into."""

    def __init__(self, seconds):
        self.buf = np.zeros((int(seconds * SR) + SR, 2))

    def add(self, t, sig, pan=0.0, gain=1.0):
        i = int(round(t * SR))
        if i >= len(self.buf):
            return
        sig = sig[: len(self.buf) - i]
        l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        if sig.ndim == 1:
            self.buf[i : i + len(sig), 0] += sig * l * gain * np.sqrt(2)
            self.buf[i : i + len(sig), 1] += sig * r * gain * np.sqrt(2)
        else:
            self.buf[i : i + len(sig)] += sig * gain


def pad_note(freq, dur, bright, rng):
    """Detuned additive saw-ish voice pair (L/R), soft attack and long release."""
    n = int((dur + 1.6) * SR)
    t = np.arange(n) / SR
    out = np.zeros((n, 2))
    nh = 7
    roll = 2.2 - 1.0 * bright  # higher = darker
    for ch, cents in ((0, -7), (1, 6), (0, 2), (1, -3)):
        f = freq * 2 ** (cents / 1200)
        ph = rng.uniform(0, 2 * np.pi, nh)
        w = np.zeros(n)
        for k in range(1, nh + 1):
            if f * k > 9000:
                break
            w += np.sin(2 * np.pi * f * k * t + ph[k - 1]) / k**roll
        out[:, ch] += w
    a = 0.9
    e = np.clip(t / a, 0, 1) ** 2
    e *= np.where(t < dur, 1.0, np.exp(-(t - dur) / 0.45))
    trem = 1 + 0.06 * np.sin(2 * np.pi * 0.17 * t + rng.uniform(0, 6))
    return out * (e * trem)[:, None] * 0.08


def pluck(freq, vel=1.0, decay=1.4):
    """A soft plucked note: harmonics that decay faster the higher they are."""
    n = int((decay * 2.2) * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for k, a in ((1, 1.0), (2, 0.42), (3, 0.2), (4, 0.11), (5, 0.06), (6, 0.03)):
        if freq * k > 12000:
            break
        s += a * np.sin(2 * np.pi * freq * k * t) * np.exp(-t * (1.0 / decay) * (1 + 0.9 * (k - 1)))
    att = np.clip(t / 0.004, 0, 1)
    return s * att * vel * 0.22


def epiano(freq, dur, vel=1.0):
    """FM electric piano (ratio 1:1, decaying index) with a little bell partial."""
    n = int((dur + 0.8) * SR)
    t = np.arange(n) / SR
    idx = 1.6 * np.exp(-t / 0.35) + 0.25
    car = np.sin(2 * np.pi * freq * t + idx * np.sin(2 * np.pi * freq * t))
    tine = 0.15 * np.sin(2 * np.pi * freq * 14 * t) * np.exp(-t / 0.05)
    e = np.exp(-t / 1.1) * np.clip(t / 0.003, 0, 1) * np.where(t < dur, 1, np.exp(-(t - dur) / 0.12))
    return (car + tine) * e * vel * 0.12


def bell(freq, vel=1.0):
    n = int(4.0 * SR)
    t = np.arange(n) / SR
    idx = 2.2 * np.exp(-t / 0.6)
    s = np.sin(2 * np.pi * freq * t + idx * np.sin(2 * np.pi * freq * 3.5 * t))
    return s * np.exp(-t / 1.3) * np.clip(t / 0.002, 0, 1) * vel * 0.08


def bass(freq, dur, vel=1.0):
    n = int((dur + 0.3) * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(4 * np.pi * freq * t) + 0.08 * np.sin(6 * np.pi * freq * t)
    e = np.clip(t / 0.012, 0, 1) * np.exp(-t / 1.6) * np.where(t < dur, 1, np.exp(-(t - dur) / 0.06))
    return s * e * vel * 0.2


def kick(vel=1.0):
    n = int(0.6 * SR)
    t = np.arange(n) / SR
    f = 46 + 75 * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t / 0.22) * vel * 0.32


def hat(rng, vel=1.0):
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    s = highpass(rng.standard_normal(n), 7000, 2)
    return s * np.exp(-t / 0.028) * vel * 0.05


def rim(rng, vel=1.0):
    n = int(0.25 * SR)
    t = np.arange(n) / SR
    s = bandpass(rng.standard_normal(n), 1200, 4200) * np.exp(-t / 0.05) * 0.5 + np.sin(2 * np.pi * 330 * t) * np.exp(-t / 0.03) * 0.4
    return s * vel * 0.12


def reverb_ir(seconds=2.6, seed=7):
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    decay = np.exp(-6.9 * t / seconds)
    ir = rng.standard_normal((n, 2)) * decay[:, None]
    ir = lowpass(ir, 5200, 2)
    ir[: int(0.018 * SR)] = 0  # pre-delay
    return ir / np.sqrt((ir**2).sum(axis=0))


def render(duration, sections, seed=3):
    rng = np.random.default_rng(seed)
    nbars = int(np.ceil(duration / BAR)) + 1
    # each section's texture starts at the bar nearest its start time
    starts = sorted({int(round(s / BAR)) for s in sections if s < duration - BAR} | {0})
    tex_of_bar = []
    for b in range(nbars):
        k = max(i for i, s in enumerate(starts) if s <= b)
        name = 'outro' if k == len(starts) - 1 and len(starts) > 2 else ORDER[k % len(ORDER)]
        tex_of_bar.append((k, name))
    end_bar = int(np.floor((duration - 4.5) / BAR))  # the held final chord
    for b in range(end_bar, nbars):
        tex_of_bar[b] = (len(starts), 'outro')

    pad, keys, drums, low = Track(duration), Track(duration), Track(duration), Track(duration)
    swing = 0.06 * BEAT
    for b in range(nbars):
        t0 = b * BAR
        if t0 >= duration:
            break
        sec, name = tex_of_bar[b]
        tx = TEXTURES[name]
        bar_in_sec = b - (starts[sec] if sec < len(starts) else end_bar)
        # a texture that comes back later in the piece comes back with another progression
        prog = PROGRESSIONS[(tx['prog'] + (1 if sec >= 6 else 0)) % len(PROGRESSIONS)]
        final = b >= end_bar
        chord = 'C' if final else prog[bar_in_sec % 4]
        root, _ = CHORDS[chord]
        notes = voicing(chord)
        hold = (duration - t0 + 0.2) if final else BAR + 0.05
        if final and b > end_bar:
            continue
        # pad: always
        for m in notes:
            pad.add(t0, pad_note(mtof(m), hold, tx['bright'], rng), gain=1.0)
        # a soft sub octave in the pad on the first beat
        if tx['bass']:
            pad.add(t0, pad_note(mtof(36 + root if root < 8 else 24 + root), hold, 0.1, rng) * 0.4)
        if final:
            # last chord: a gentle broken arpeggio and a bell to close
            for i, m in enumerate([60, 64, 67, 72, 74, 79]):
                keys.add(t0 + i * BEAT / 2, pluck(mtof(m), 0.6 - i * 0.05, 1.8), pan=(-0.4 + 0.16 * i))
            keys.add(t0 + 3 * BEAT, bell(mtof(84), 0.5), pan=0.2)
            continue
        # arpeggio
        arp_notes = [n + 12 for n in notes]
        pattern = tx['arp']
        if pattern:
            if pattern == 'up':
                seq = [arp_notes[i % len(arp_notes)] for i in range(8)]
            elif pattern == 'updown':
                ud = arp_notes + arp_notes[-2:0:-1]
                seq = [ud[i % len(ud)] for i in range(8)]
            elif pattern == 'broken':
                order = [0, 2, 1, 3, 2, 4, 3, 1]
                seq = [arp_notes[o % len(arp_notes)] for o in order]
            else:  # sparse
                seq = [arp_notes[0], None, None, arp_notes[2], None, arp_notes[1], None, None]
            if bar_in_sec % 8 == 7 and pattern != 'sparse':
                seq = seq[:5] + [None, None, None]  # breathe at the end of a phrase
            for i, m in enumerate(seq):
                if m is None:
                    continue
                tt = t0 + i * BEAT / 2 + (swing if i % 2 else 0)
                vel = (0.85 if i % 2 == 0 else 0.6) * rng.uniform(0.85, 1.0)
                keys.add(tt, pluck(mtof(m), vel), pan=0.35 * np.sin(i * 1.3 + b))
        # electric piano: chord on 1 and a lighter one on the "and" of 2
        if tx['ep']:
            ep_notes = [n for n in notes[:4]]
            for tt, vel, d in ((0, 0.8, BEAT * 1.4), (1.5 * BEAT + swing, 0.5, BEAT * 0.6), (3 * BEAT, 0.55, BEAT * 0.9)):
                for j, m in enumerate(ep_notes):
                    keys.add(t0 + tt + j * 0.008, epiano(mtof(m), d, vel), pan=-0.25 + 0.17 * j)
        # bells: a few notes from the chord, high and sparse
        if tx['bells'] and bar_in_sec % 2 == 0:
            m = 72 + (notes[(b * 3) % len(notes)] % 12)
            keys.add(t0 + BEAT * rng.choice([0.5, 1, 2]), bell(mtof(m), rng.uniform(0.5, 0.8)), pan=rng.uniform(-0.5, 0.5))
        # bass
        if tx['bass']:
            f = mtof(36 + root if root < 5 else 24 + root)
            low.add(t0, bass(f, BEAT * 1.5, 0.9))
            low.add(t0 + 2.5 * BEAT + swing, bass(f, BEAT * 0.8, 0.6))
            if bar_in_sec % 4 == 3:
                low.add(t0 + 3.5 * BEAT + swing, bass(f * 2 ** (7 / 12), BEAT * 0.4, 0.45))
        # drums: 1 = kick and hat, 2 = also a rim on 2 and 4
        if tx['drums']:
            drums.add(t0, kick(0.9))
            drums.add(t0 + 2.5 * BEAT + swing, kick(0.55))
            if bar_in_sec % 2 == 1:
                drums.add(t0 + 3.5 * BEAT + swing, kick(0.35))
            for i in range(8):
                vel = (0.55 if i % 2 else 0.9) * rng.uniform(0.7, 1.0)
                drums.add(t0 + i * BEAT / 2 + (swing if i % 2 else 0), hat(rng, vel), pan=0.25)
            if tx['drums'] == 2:
                for beat in (1, 3):
                    drums.add(t0 + beat * BEAT, rim(rng, rng.uniform(0.75, 0.9)), pan=-0.1)

    n = int(round(duration * SR))
    t = np.arange(len(pad.buf)) / SR
    # the intro swell: the pad opens from dark to bright over the first bars
    dark, bright = lowpass(pad.buf, 450), lowpass(pad.buf, 2600)
    w = np.clip((t - 0.5) / 7.0, 0, 1)[:, None]
    padf = dark * (1 - w) + bright * w
    keysf = lowpass(keys.buf, 6000)
    lowf = lowpass(low.buf, 900)
    drumsf = lowpass(drums.buf, 8000)
    dry = padf * 1.0 + keysf * 0.9 + lowf * 0.9 + drumsf * 0.8
    send = padf * 0.45 + keysf * 0.55 + drumsf * 0.06
    ir = reverb_ir()
    wet = np.stack([oaconvolve(send[:, c], ir[:, c])[: len(send)] for c in range(2)], axis=1)
    mix = dry + wet * 0.55
    mix = highpass(mix, 32, 2)
    mix = lowpass(mix, 9000, 2)  # warm top
    mix = mix[:n]
    t = np.arange(n) / SR
    fade_in = np.clip(t / 3.0, 0, 1) ** 1.5
    fade_out = np.clip((duration - t) / 4.0, 0, 1) ** 2
    mix *= (fade_in * fade_out)[:, None]
    mix *= 0.8 / max(1e-9, np.abs(mix).max())
    mix = np.tanh(mix * 1.2) / 1.2  # gentle saturation on the peaks
    mix *= 10 ** (-3 / 20) / max(1e-9, np.abs(mix).max())
    return mix.astype(np.float32)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--duration', type=float, required=True, help='seconds')
    ap.add_argument('--sections', default='', help='comma-separated section start times (s)')
    ap.add_argument('--seed', type=int, default=3)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    sections = [float(x) for x in a.sections.split(',') if x.strip()]
    wavfile.write(a.out, SR, render(a.duration, sections, a.seed))


if __name__ == '__main__':
    main()
