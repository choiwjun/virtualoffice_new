#!/usr/bin/env python3
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os, webbrowser, threading

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()
    def do_GET(self):
        if self.path in ('/', ''):
            self.send_response(302)
            self.send_header('Location', '/07_runtime/index.html')
            self.end_headers()
            return
        super().do_GET()

URL='http://127.0.0.1:8765/07_runtime/index.html'
threading.Timer(.7, lambda: webbrowser.open(URL)).start()
print('Virtual Office 2.5D v2.2:', URL)
ThreadingHTTPServer(('127.0.0.1', 8765), Handler).serve_forever()
