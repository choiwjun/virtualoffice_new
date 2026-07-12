#!/usr/bin/env python3
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os, webbrowser, threading
root=Path(__file__).resolve().parents[1]
os.chdir(root)
class H(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control','no-store')
        super().end_headers()
url='http://127.0.0.1:8765/07_runtime/'
threading.Timer(.7,lambda:webbrowser.open(url)).start()
print('Virtual Office 2.5D:',url)
ThreadingHTTPServer(('127.0.0.1',8765),H).serve_forever()
