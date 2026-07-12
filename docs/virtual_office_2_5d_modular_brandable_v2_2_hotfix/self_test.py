#!/usr/bin/env python3
from pathlib import Path
import json, sys
root=Path(__file__).resolve().parent
errors=[]
def check_file(rel):
    p=root/rel
    if not p.is_file(): errors.append(f'MISSING: {rel}')
    return p
cat=json.loads(check_file('06_metadata/module-catalog.json').read_text(encoding='utf-8'))
if not isinstance(cat,list) or len(cat)<18: errors.append(f'MODULE_CATALOG_COUNT={len(cat) if isinstance(cat,list) else "invalid"}')
for item in cat: check_file(item['file'])
cr=json.loads(check_file('04_characters_v3/03_registry/character-registry-v3.json').read_text(encoding='utf-8'))
if len(cr.get('characters',[]))!=8: errors.append('CHARACTER_COUNT_NOT_8')
for ch in cr.get('characters',[]):
    for state,rel in ch.get('states',{}).items(): check_file('04_characters_v3/'+rel)
app=check_file('07_runtime/app.js').read_text(encoding='utf-8')
if 'if(!charFile)return' in app or 'let charFile=null' in app: errors.append('DEAD_SETUP_ACTOR_STUB_PRESENT')
runner=check_file('run_demo.py').read_text(encoding='utf-8')
if 'parents[1]' in runner: errors.append('WRONG_SERVER_ROOT')
if errors:
    print('FAIL')
    print('\n'.join(errors))
    sys.exit(1)
print(f'PASS: {len(cat)} modules, {len(cr["characters"])} characters, runtime actor enabled')
