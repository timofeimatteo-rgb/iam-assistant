import asyncio, base64, json, sys, http.server, threading, functools
from playwright.async_api import async_playwright
DIR = '/home/claude/tools/baker'
def serve():
    class Q(http.server.SimpleHTTPRequestHandler):
        def log_message(self,*a): pass
    h = functools.partial(Q, directory=DIR)
    s = http.server.ThreadingHTTPServer(('127.0.0.1', 8765), h); threading.Thread(target=s.serve_forever, daemon=True).start(); return s
async def main(poses, out_prefix, w=360, h=440):
    srv = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width': w, 'height': h})
        pg.on('console', lambda m: print('console', m.text)); pg.on('pageerror', lambda e: print('err', e))
        await pg.goto(f'http://127.0.0.1:8765/baker.html?w={w}&h={h}')
        await pg.wait_for_function('window.ready===true', timeout=60000)
        for i, pose in enumerate(poses):
            url = await pg.evaluate('p => window.render(p)', pose)
            open(f'{out_prefix}{i:03d}.png', 'wb').write(base64.b64decode(url.split(',')[1]))
        await b.close()
    srv.shutdown()
if __name__ == '__main__':
    poses = json.loads(sys.argv[1]); asyncio.run(main(poses, sys.argv[2]))
