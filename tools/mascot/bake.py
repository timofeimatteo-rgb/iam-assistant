import asyncio, json, os, sys, base64
sys.path.insert(0, os.path.dirname(__file__))
import anims, shot
OUT = sys.argv[1]
async def run():
    data = {k: f() for k, (f, lp) in anims.STATES.items()}
    flat = []; idx = []
    for k, frames in data.items():
        os.makedirs(f'{OUT}/{k}', exist_ok=True)
        for i, p in enumerate(frames): flat.append(p); idx.append((k, i))
    tmp = f'{OUT}/_all_'
    await shot.main(flat, tmp)
    for j, (k, i) in enumerate(idx):
        os.replace(f'{tmp}{j:03d}.png', f'{OUT}/{k}/{i:02d}.png')
asyncio.run(run())
