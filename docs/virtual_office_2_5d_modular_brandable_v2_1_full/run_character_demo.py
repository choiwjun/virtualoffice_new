from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os, webbrowser
root=Path(__file__).resolve().parent/'04_characters_v3'
os.chdir(root)
url='http://127.0.0.1:8766/04_runtime_demo/'
print(url)
webbrowser.open(url)
ThreadingHTTPServer(('127.0.0.1',8766),SimpleHTTPRequestHandler).serve_forever()
