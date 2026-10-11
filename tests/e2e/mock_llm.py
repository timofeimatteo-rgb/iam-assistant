"""Мок OpenAI-совместимого сервера (как llama-server) для автотестов интерфейса."""
import http.server, json, time, sys
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*'); self.send_header('Access-Control-Allow-Headers', '*'); self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    def do_OPTIONS(self): self.send_response(204); self.cors(); self.end_headers()
    def do_GET(self): self.send_response(200); self.cors(); self.end_headers(); self.wfile.write(b'{"status":"ok"}')
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        last = body['messages'][-1]['content']; sys_ = body['messages'][0]['content']
        if 'нумерованный список' in sys_:
            text = '1. Открыть бриф и выписать цели\n2. Собрать 10 референсов\n3. Набросать три эскиза\n4. Выбрать лучший и доработать'
        elif 'встреч' in last or 'созвон' in last:
            text = 'Хорошая мысль! Я поставил напоминание на 16:00, чтобы ты не забыл.\n[[напомнить: 16:00 | Созвон с клиентом]]'
        elif 'долго' in last:
            text = 'Сейчас расскажу очень подробно. ' * 40
        else:
            text = 'Привет! Я тут, готов помочь. Давай начнём с самой маленькой задачи — так проще разогнаться.'
        self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.cors(); self.end_headers()
        try:
            for i in range(0, len(text), 6):
                chunk = {'choices': [{'delta': {'content': text[i:i+6]}}]}
                self.wfile.write(f'data: {json.dumps(chunk, ensure_ascii=False)}\n\n'.encode()); self.wfile.flush(); time.sleep(0.02)
            self.wfile.write(b'data: [DONE]\n\n')
        except (BrokenPipeError, ConnectionResetError): pass
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 8799), H).serve_forever()
