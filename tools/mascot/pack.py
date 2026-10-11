"""Crop all frames to one shared bbox, scale, and pack per-state WebP sprite sheets + manifest."""
import os, sys, json, math
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
import anims
SRC, DST, H = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 360
os.makedirs(DST, exist_ok=True)
states = list(anims.STATES)
frames = {s: [Image.open(f'{SRC}/{s}/{f}') for f in sorted(os.listdir(f'{SRC}/{s}'))] for s in states}
x0 = y0 = 10**9; x1 = y1 = 0
for s in states:
    for im in frames[s]:
        a = np.array(im)[:, :, 3]; ys, xs = np.nonzero(a > 4)
        x0, y0, x1, y1 = min(x0, xs.min()), min(y0, ys.min()), max(x1, xs.max()), max(y1, ys.max())
pad = 4; x0 -= pad; y0 -= pad; x1 += pad; y1 += pad
bw, bh = x1 - x0, y1 - y0
W = round(bw * H / bh); W += W % 2
print('bbox', (x0, y0, x1, y1), 'frame', W, H)
man = {'fps': anims.FPS, 'frameW': W, 'frameH': H, 'states': {}}
total = 0
for s in states:
    fs = [im.crop((x0, y0, x1, y1)).resize((W, H), Image.LANCZOS) for im in frames[s]]
    n = len(fs); cols = min(n, 8); rows = math.ceil(n / cols)
    sheet = Image.new('RGBA', (cols * W, rows * H), (0, 0, 0, 0))
    for i, f in enumerate(fs): sheet.paste(f, ((i % cols) * W, (i // cols) * H))
    sheet.save(f'{DST}/{s}.webp', 'WEBP', quality=82, method=6, alpha_quality=90)
    fs[0].save(f'{DST}/{s}_still.webp', 'WEBP', quality=85, method=6)
    sz = os.path.getsize(f'{DST}/{s}.webp') + os.path.getsize(f'{DST}/{s}_still.webp'); total += sz
    man['states'][s] = {'frames': n, 'cols': cols, 'rows': rows, 'loop': anims.STATES[s][1]}
    print(s, n, 'frames', sz // 1024, 'KB')
man['bytes'] = total
json.dump(man, open(f'{DST}/manifest.json', 'w'), indent=1)
print('TOTAL', total // 1024, 'KB')
