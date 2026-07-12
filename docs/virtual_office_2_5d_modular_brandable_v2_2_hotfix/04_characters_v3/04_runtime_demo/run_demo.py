#!/usr/bin/env python3
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os, webbrowser, threading
ROOT=Path(__file__).resolve().parents[2]
os.chdir(ROOT)
URL='http://127.0.0.1:8766/04_characters_v3/04_runtime_demo/index.html'
threading.Timer(.7,lambda:webbrowser.open(URL)).start()
print('Character Demo:',URL)
ThreadingHTTPServer(('127.0.0.1',8766),SimpleHTTPRequestHandler).serve_forever()
