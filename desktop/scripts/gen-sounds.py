#!/usr/bin/env python3
"""Genera los sonidos propios de Hocki (sintetizados, sin muestras de nadie).

Uso:  python3 scripts/gen-sounds.py        → escribe desktop/sounds/*.wav
Cada sonido es corto y suave (el volumen general de Hocki ya es bajo)."""
import os
import wave
import numpy as np
from scipy.signal import butter, lfilter

SR = 22050
OUT = os.path.join(os.path.dirname(__file__), "..", "sounds")
rng = np.random.default_rng(7)


def t_(d): return np.arange(int(SR * d)) / SR


def env(n, a=0.005, r=0.08):
    e = np.ones(n)
    na = max(1, min(int(SR * a), n // 2))
    nr = max(1, min(int(SR * r), n - na))
    e[:na] = np.linspace(0, 1, na)
    e[-nr:] *= np.linspace(1, 0, nr)
    return e


def tone(f0, d, f1=None, wave_="sine", a=0.005, r=0.08, vib=0.0, vol=1.0):
    t = t_(d)
    f = np.linspace(f0, f1 if f1 is not None else f0, len(t))
    if vib:
        f = f * (1 + vib * np.sin(2 * np.pi * 6 * t))
    ph = 2 * np.pi * np.cumsum(f) / SR
    if wave_ == "sine": s = np.sin(ph)
    elif wave_ == "tri": s = 2 / np.pi * np.arcsin(np.sin(ph))
    elif wave_ == "soft": s = np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph)
    else: s = np.sign(np.sin(ph)) * 0.5
    return s * env(len(t), a, r) * vol


def noise(d, lo=None, hi=None, a=0.005, r=0.08, vol=1.0):
    n = rng.standard_normal(int(SR * d))
    if lo and hi:
        b, aa = butter(2, [lo / (SR / 2), hi / (SR / 2)], btype="band")
        n = lfilter(b, aa, n)
    n = n / (np.max(np.abs(n)) + 1e-9)
    return n * env(len(n), a, r) * vol


def oink(d=0.28, f0=260, vol=1.0):
    """Gruñido: sierra con glissando descendente y dos formantes."""
    t = t_(d)
    f = f0 * (1.35 - 0.55 * (t / d)) * (1 + 0.03 * np.sin(2 * np.pi * 28 * t))
    ph = 2 * np.pi * np.cumsum(f) / SR
    saw = 2 * ((ph / (2 * np.pi)) % 1) - 1
    out = 0
    for lo, hi, g in [(500, 800, 1.0), (1100, 1500, 0.6)]:
        b, a = butter(2, [lo / (SR / 2), hi / (SR / 2)], btype="band")
        out = out + g * lfilter(b, a, saw)
    out = out / (np.max(np.abs(out)) + 1e-9)
    return out * env(len(out), 0.02, 0.1) * vol


def seq(parts, gap=0.0):
    out = []
    for p in parts:
        out.append(p)
        if gap: out.append(np.zeros(int(SR * gap)))
    return np.concatenate(out)


def mix(*layers):
    n = max(len(x) + off for x, off in layers)
    out = np.zeros(n)
    for x, off in layers:
        i = int(SR * off)
        out[i:i + len(x)] += x
    return out


def norm(x, peak=0.8):
    return x / (np.max(np.abs(x)) + 1e-9) * peak


N = {  # notas (Hz)
    "C5": 523.25, "D5": 587.33, "E5": 659.25, "G5": 783.99, "A5": 880.0, "C6": 1046.5, "E6": 1318.5, "G6": 1568.0,
    "A4": 440.0, "C4": 261.63, "G4": 392.0, "B5": 987.77,
}

S = {}
S["peek"] = seq([tone(N["E5"], .07, vol=.8, wave_="soft"), tone(N["A5"], .12, vol=.9, wave_="soft")])
S["open"] = tone(420, .16, 720, "soft", r=.1)
S["close"] = tone(640, .14, 360, "soft", r=.1)
S["hover"] = tone(1250, .035, wave_="sine", r=.03, vol=.5)
S["blip"] = tone(880, .06, wave_="tri", r=.05, vol=.8)
S["slap"] = mix((noise(.07, 800, 4000, r=.06), 0), (tone(130, .12, 70, "sine", r=.1), 0))
S["annoyed"] = seq([oink(.18, 210), oink(.2, 190)], gap=.05)
S["dizzy"] = tone(380, .6, 520, "soft", vib=.12, a=.03, r=.2)
S["greet"] = seq([tone(N["C5"], .09, wave_="soft"), tone(N["E5"], .09, wave_="soft"), tone(N["G5"], .16, wave_="soft")])
S["work"] = seq([tone(700, .04, wave_="tri", r=.03, vol=.6), tone(540, .05, wave_="tri", r=.04, vol=.6)], gap=.03)
S["finish"] = seq([tone(N[k], .1, wave_="soft") for k in ["C5", "E5", "G5"]] + [tone(N["C6"], .28, wave_="soft", r=.2)])
S["error"] = seq([tone(300, .13, 240, "sq", r=.1, vol=.5), tone(240, .2, 170, "sq", r=.15, vol=.5)], gap=.03)
S["approval"] = seq([tone(N["A5"], .09, wave_="soft"), tone(N["E6"], .16, wave_="soft")], gap=.04)
S["question"] = seq([tone(N["E5"], .09, wave_="soft"), tone(N["A5"], .15, 960, "soft")])
S["approve"] = seq([tone(N["G5"], .07, wave_="soft"), tone(N["C6"], .16, wave_="soft")])
S["gulp"] = mix((tone(260, .14, 110, "soft", r=.1), 0), (noise(.1, 300, 1200, vol=.25), 0.02))
S["tick"] = tone(2000, .018, wave_="sine", r=.015, vol=.5)
S["send"] = mix((tone(520, .2, 1500, "soft", r=.12), 0), (noise(.18, 2000, 6000, r=.14, vol=.15), 0))
S["love"] = seq([tone(N["A4"], .12, wave_="soft"), tone(554.37, .24, wave_="soft", r=.18)], gap=.02)
S["pop"] = tone(320, .09, 980, "sine", r=.07)
S["proud"] = seq([tone(N["C5"], .1, wave_="soft"), tone(N["G5"], .1, wave_="soft"), tone(N["C6"], .3, wave_="soft", r=.22)])
S["wink"] = tone(1000, .09, 1700, "soft", r=.07, vol=.7)
S["yawn"] = mix((tone(520, .7, 190, "soft", a=.1, r=.35, vol=.6), 0), (noise(.6, 400, 1500, a=.1, r=.3, vol=.12), 0.05))
S["attach"] = seq([noise(.02, 1500, 5000, r=.015, vol=.5), tone(660, .09, 990, "soft", r=.06)])
S["think"] = seq([tone(620, .1, 680, "soft", vol=.6), tone(680, .1, 620, "soft", vol=.6)], gap=.04)
S["search"] = tone(600, .35, 800, "soft", vib=.08, a=.03, r=.18, vol=.6)
S["rate"] = seq([tone(N["G5"], .06, wave_="tri"), tone(N["E5"], .06, wave_="tri"), tone(N["C5"], .1, wave_="tri")], gap=.02)
S["sleep"] = tone(150, 1.0, 140, "soft", a=.25, r=.5, vol=.5)

# La bienvenida (≈4,6 s) sigue la coreografía de greeting.ts, instante por instante:
#   0,2-0,6 cae del notch · 0,6 aterriza · 0,95-2,5 trota · 2,95 resopla · 3,1 se sienta · 3,15 saluda
g = np.zeros(int(SR * 4.8))


def put(x, at):
    i = int(SR * at)
    g[i:i + len(x)] += x[: len(g) - i]


put(tone(900, .38, 280, "soft", a=.04, r=.2, vol=.35), 0.2)             # cae
put(mix((tone(120, .14, 70, "sine", r=.12), 0), (noise(.05, 300, 900, r=.04, vol=.3), 0)), 0.6)  # aterriza
t = 0.95
while t < 2.5:                                                           # patitas al trotar
    put(tone(1500 if int(t * 100) % 2 else 1900, .03, wave_="sine", r=.025, vol=.28), t)
    t += 0.222
put(noise(.2, 500, 3500, a=.01, r=.16, vol=.5), 2.95)                    # resoplido
put(tone(210, .16, 120, "soft", r=.12, vol=.5), 3.1)                     # se sienta
for k, (name, at) in enumerate([("C6", 3.15), ("E6", 3.27), ("G6", 3.39)]):  # "¡Hola!"
    put(tone(N[name], .22 if k < 2 else .6, wave_="soft", r=.2 if k < 2 else .45, vol=.55), at)
S["greeting"] = g

os.makedirs(OUT, exist_ok=True)
for name, x in S.items():
    x = norm(x, 0.8)
    pcm = (x * 32767).astype("<i2").tobytes()
    with wave.open(os.path.join(OUT, f"{name}.wav"), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm)
print(f"{len(S)} sonidos en {os.path.abspath(OUT)}")
