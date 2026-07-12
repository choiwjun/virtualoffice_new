import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.cwd(), '..');
const registry = JSON.parse(fs.readFileSync(path.join(root, '05_registries/asset-registry-v10.json'), 'utf8'));
const missing = [];
for (const asset of registry.assets) {
  if (!asset.file) continue;
  const file = path.join(root, asset.file);
  if (!fs.existsSync(file)) missing.push(asset.file);
}
for (const preset of fs.readdirSync(path.join(root, '12_layout_presets')).filter((f) => f.startsWith('PRESET_') && f.endsWith('.json'))) {
  const data = JSON.parse(fs.readFileSync(path.join(root, '12_layout_presets', preset), 'utf8'));
  for (const item of data.instances) if (!registry.assets.some((a) => a.asset_id === item.asset_id)) missing.push(`${preset}: ${item.asset_id}`);
}
if (missing.length) { console.error('Missing:', missing); process.exit(1); }
console.log(JSON.stringify({ status: 'PASS', assets: registry.assets.length, pbr: registry.assets.filter((a) => a.pbr_v10?.embedded).length }, null, 2));
