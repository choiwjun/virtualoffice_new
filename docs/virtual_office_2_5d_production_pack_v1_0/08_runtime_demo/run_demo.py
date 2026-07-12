from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
import os,webbrowser
package_root=Path(__file__).resolve().parent.parent
os.chdir(package_root)
url='http://127.0.0.1:8765/08_runtime_demo/'
print('Virtual Office 2.5D Demo:',url)
try:webbrowser.open(url)
except:pass
ThreadingHTTPServer(('127.0.0.1',8765),SimpleHTTPRequestHandler).serve_forever()
