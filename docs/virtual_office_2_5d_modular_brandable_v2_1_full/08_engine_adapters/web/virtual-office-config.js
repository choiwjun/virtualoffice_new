export async function loadVirtualOfficeConfig(root = './') {
  const sceneRegistry = await fetch(root + '06_metadata/scene-registry.json').then(r=>r.json());
  const assets = await fetch(root + '06_metadata/asset-registry-v2.json').then(r=>r.json());
  const brandAnchors = await fetch(root + '06_metadata/brand-anchors.json').then(r=>r.json());
  return { sceneRegistry, assets, brandAnchors };
}
export function normalizedToPixels(point, width, height){ return {x:point.x*width,y:point.y*height}; }
export function depthFromY(y, offset=0){ return Math.round((y+offset)*10000); }
