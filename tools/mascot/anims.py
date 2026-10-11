"""Procedural animation states for the I AM mascot (no skeleton in source: part-based rig).
Each state -> list of pose dicts. 12 fps. Loops start/end on the same pose; one-shots start/end at REST."""
import math, json, sys

FPS = 12
REST = dict(armLDown=66, armRDown=66, armLFwd=8, armRFwd=8)
TAU = 2 * math.pi

def ease(x):  # smoothstep
    x = max(0.0, min(1.0, x)); return x * x * (3 - 2 * x)

def env(t, a=0.18, b=0.18):  # 0 -> 1 -> 0 envelope for one-shots
    return ease(t / a) * ease((1 - t) / b)

def pose(**kw):
    p = dict(REST); p.update(kw); return p

def idle(n=24):
    out = []
    for i in range(n):
        t = i / n; s = math.sin(TAU * t)
        out.append(pose(squash=0.012 * s, y=0.012 * s, sway=1.0 * math.sin(TAU * t + 0.6),
                        headTilt=2.5 * math.sin(TAU * t + 1.2), armLDown=66 + 2 * s, armRDown=66 + 2 * s))
    return out

def greet(n=24):
    out = []
    for i in range(n):
        t = i / (n - 1); e = env(t, 0.25, 0.2)
        wave = math.sin(TAU * 2.0 * ease((t - 0.2) / 0.65)) * e
        out.append(pose(armRDown=66 - 128 * e + 12 * wave, armRFwd=8 + 14 * e, armRTwist=-20 * e,
                        headTilt=-9 * e, sway=-2.5 * e, squash=0.02 * e, y=0.03 * e))
    return out

def focus(n=24):
    out = []
    for i in range(n):
        t = i / n; s = math.sin(TAU * t)
        out.append(pose(armLDown=72, armRDown=72, armLFwd=28, armRFwd=28, nod=7 + 1.0 * s,
                        squash=0.007 * s, y=0.006 * s))
    return out

def think(n=24):
    out = []
    for i in range(n):
        t = i / n; s = math.sin(TAU * t)
        out.append(pose(armRDown=22 + 3 * s, armRFwd=78, armRTwist=10, armLDown=70, armLFwd=20,
                        headTilt=11 + 3 * s, headTurn=-12, nod=-4, sway=1.5 * s, squash=0.006 * s))
    return out

def joy(n=16):
    out = []
    for i in range(n):
        t = i / n
        # anticipation crouch (0-.2), jump (.2-.75), land squash (.75-1)
        if t < 0.2: k = ease(t / 0.2); y = -0.06 * k; sq = -0.07 * k; up = 0.3 * k
        elif t < 0.75: u = (t - 0.2) / 0.55; y = 0.55 * math.sin(math.pi * u); sq = 0.06 * math.sin(math.pi * u); up = 1.0
        else: u = (t - 0.75) / 0.25; y = -0.05 * math.sin(math.pi * u); sq = -0.06 * math.sin(math.pi * u); up = 1 - ease(u)
        out.append(pose(y=y, squash=sq, armLDown=66 - 125 * up, armRDown=66 - 125 * up, armLFwd=12, armRFwd=12,
                        headTilt=4 * math.sin(TAU * t), legLLift=0.06 * up, legRLift=0.06 * up, legSpread=6 * up))
    return out

def stretch(n=24):  # напоминание о перерыве: потягивается
    out = []
    for i in range(n):
        t = i / n; s = math.sin(TAU * t); up = 0.75 + 0.25 * math.sin(TAU * t - math.pi / 2) * -1
        out.append(pose(armLDown=66 - 140 * up, armRDown=66 - 140 * up, armLFwd=4, armRFwd=4,
                        lean=7 * s, headTilt=-5 * s, nod=-6 * up, squash=0.03 * up, y=0.02 * up))
    return out

def exercise(n=16):  # зарядка: прыжки «звёздочка»
    out = []
    for i in range(n):
        t = i / n; k = 0.5 - 0.5 * math.cos(TAU * t)  # 0 closed -> 1 open
        hop = abs(math.sin(TAU * t)) * 0.18
        out.append(pose(armLDown=66 - 150 * k, armRDown=66 - 150 * k, armLFwd=4, armRFwd=4,
                        legSpread=14 * k, y=hop, squash=-0.03 + 0.06 * (hop / 0.18)))
    return out

def dance(n=24):
    out = []
    for i in range(n):
        t = i / n; s = math.sin(TAU * t); b = abs(math.sin(TAU * 2 * t))
        out.append(pose(x=0.22 * s, y=0.14 * b, turn=22 * s, lean=-6 * s, sway=5 * math.sin(TAU * 2 * t),
                        armLDown=66 - 110 * (0.5 + 0.5 * s), armRDown=66 - 110 * (0.5 - 0.5 * s),
                        armLFwd=20, armRFwd=20, headTilt=-8 * math.sin(TAU * 2 * t),
                        legLLift=0.12 * max(0, s), legRLift=0.12 * max(0, -s), squash=0.04 * b - 0.02))
    return out

def silly(n=24):  # дурачится: подпрыгивает с оборотом и трясёт головой
    out = []
    for i in range(n):
        t = i / (n - 1)
        spin = 360 * ease((t - 0.1) / 0.5)
        y = 0.4 * math.sin(math.pi * min(1, max(0, (t - 0.1) / 0.5)))
        shake = math.sin(TAU * 3 * t) * env(max(0, (t - 0.6) / 0.4) if t > 0.6 else 0, 0.2, 0.3)
        e = env(t, 0.1, 0.15)
        out.append(pose(turn=spin % 360, y=y, squash=0.05 * math.sin(math.pi * min(1, max(0, (t - 0.1) / 0.5))),
                        armLDown=66 - 90 * e, armRDown=66 - 90 * e, armLFwd=30 * e, armRFwd=30 * e,
                        headTurn=18 * shake, headTilt=14 * shake, legLKick=25 * e * math.sin(TAU * 2 * t)))
    return out

STATES = {
    'idle': (idle, True), 'greet': (greet, False), 'focus': (focus, True), 'think': (think, True),
    'joy': (joy, False), 'break': (stretch, True), 'exercise': (exercise, True), 'dance': (dance, True),
    'silly': (silly, False),
}

if __name__ == '__main__':
    print(json.dumps({k: {'loop': lp, 'frames': f()} for k, (f, lp) in STATES.items()}))
