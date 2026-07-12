from __future__ import annotations
import http.server
import os
import socketserver
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get('PORT', '8765'))

class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        original = os.getcwd()
        try:
            os.chdir(ROOT)
            return super().translate_path(path)
        finally:
            os.chdir(original)

    def do_GET(self):
        if self.path in ('/', '/index.html'):
            self.send_response(302)
            self.send_header('Location', '/11_complete_runtime_app/dist/index.html')
            self.end_headers()
            return
        return super().do_GET()

with socketserver.ThreadingTCPServer(('0.0.0.0', PORT), Handler) as server:
    print(f'Virtual Office v10: http://localhost:{PORT}')
    try: webbrowser.open(f'http://localhost:{PORT}')
    except Exception: pass
    server.serve_forever()
