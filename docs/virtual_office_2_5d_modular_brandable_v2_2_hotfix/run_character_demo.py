#!/usr/bin/env python3
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os, webbrowser, threading
ROOT=Path(__file__).resolve().parent
os.chdir(ROOT)
class H(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control','no-store')
        super().end_headers()
URL='http://127.0.0.1:8766/04_characters_v3/04_runtime_demo/index.html'
threading.Timer(.7,lambda:webbrowser.open(URL)).start()
print('Character Demo:',URL)
ThreadingHTTPServer(('127.0.0.1',8766),H).serve_forever()
