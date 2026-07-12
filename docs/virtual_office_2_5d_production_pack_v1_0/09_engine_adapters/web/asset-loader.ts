export async function loadRegistry(base='../'){return fetch(base+'07_metadata/asset-registry.json').then(r=>r.json())}
