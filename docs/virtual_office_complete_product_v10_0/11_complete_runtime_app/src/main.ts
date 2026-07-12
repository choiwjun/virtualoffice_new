import './styles.css';
import { OfficeApp } from './runtime/OfficeApp.js';
import type { AssetRecord } from './types.js';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app not found');
root.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div class="brand"><span class="brand-mark">◉</span><div><strong>Virtual Office</strong><small>Complete Product v10</small></div></div>
      <div class="top-actions">
        <button id="moveMode">이동 G</button><button id="rotateMode">회전 R</button>
        <button id="save">저장</button><button id="load">불러오기</button><button id="export">JSON 내보내기</button>
      </div>
    </header>
    <aside class="catalog panel">
      <div class="panel-title"><span>에셋 카탈로그</span><input id="search" placeholder="검색" /></div>
      <div id="categories" class="categories"></div>
      <div id="assetList" class="asset-list"></div>
    </aside>
    <main id="viewport" class="viewport"><div id="loading" class="loading">패키지 로딩 중…</div></main>
    <aside class="inspector panel">
      <div class="panel-title">인스펙터</div>
      <div id="selection" class="selection-empty">에셋을 선택하세요.</div>
      <div class="separator"></div>
      <label>레이아웃 프리셋</label>
      <select id="preset">
        <option value="/12_layout_presets/PRESET_OPEN_OFFICE_V10_001.json">Open Office HQ</option>
        <option value="/12_layout_presets/PRESET_COMPACT_STARTUP_V10_001.json">Compact Startup</option>
        <option value="/12_layout_presets/PRESET_EXECUTIVE_FLOOR_V10_001.json">Executive Floor</option>
      </select>
      <button id="loadPreset" class="primary">프리셋 적용</button>
      <div class="separator"></div>
      <button id="interact" class="primary">좌석/업무 상호작용 E</button>
      <button id="stand">일어나기 Esc</button>
      <div class="help">
        바닥 클릭: 캐릭터 이동<br />에셋 클릭: 선택<br />G/R: 이동·회전<br />Ctrl/Cmd+D: 복제<br />Delete: 삭제
      </div>
    </aside>
    <footer class="statusbar"><span class="online-dot"></span><span id="status">초기화 중</span><span class="spacer"></span><span>PBR GLB · Rigged · 12 Clips · Layout Editor · A* Navigation</span></footer>
  </div>`;

const viewport = document.querySelector<HTMLElement>('#viewport')!;
const app = new OfficeApp(viewport);
const loading = document.querySelector<HTMLElement>('#loading')!;
const status = document.querySelector<HTMLElement>('#status')!;
app.onStatus = (text) => { status.textContent = text; };

let allAssets: AssetRecord[] = [];
let activeCategory = 'all';

function renderCatalog(): void {
  const query = (document.querySelector<HTMLInputElement>('#search')!.value ?? '').trim().toLowerCase();
  const filtered = allAssets.filter((a) =>
    (activeCategory === 'all' || a.category === activeCategory) &&
    (!query || `${a.asset_id} ${a.category} ${a.type ?? ''}`.toLowerCase().includes(query))
  ).slice(0, 120);
  document.querySelector('#assetList')!.innerHTML = filtered.map((a) => `
    <button class="asset-card" data-id="${a.asset_id}">
      <span class="asset-icon">${iconFor(a.category)}</span>
      <span><strong>${pretty(a.asset_id)}</strong><small>${a.category} · ${a.type ?? 'asset'}</small></span>
    </button>`).join('');
  document.querySelectorAll<HTMLButtonElement>('.asset-card').forEach((button) => {
    button.onclick = () => void app.addAsset(button.dataset.id!);
  });
}

function iconFor(category: string): string {
  return ({ architecture: '▦', workstation: '▰', meeting: '◫', reception: '◒', lounge: '◉', focus: '▣', pantry: '◆', props: '◇', storage: '▤', plants: '♣', decor: '▧', lighting: '✦', character: '●', characters: '●' } as Record<string, string>)[category] ?? '□';
}
function pretty(id: string): string { return id.replace(/_00\d$/, '').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); }

async function start(): Promise<void> {
  await app.initialize();
  allAssets = app.availableAssets().filter((a) => !a.asset_id.includes('RIGGED') && a.category !== 'scene');
  const cats = ['all', ...new Set(allAssets.map((a) => a.category))];
  document.querySelector('#categories')!.innerHTML = cats.map((c) => `<button data-category="${c}" class="category ${c === 'all' ? 'active' : ''}">${c}</button>`).join('');
  document.querySelectorAll<HTMLButtonElement>('.category').forEach((button) => button.onclick = () => {
    activeCategory = button.dataset.category!;
    document.querySelectorAll('.category').forEach((b) => b.classList.remove('active'));
    button.classList.add('active'); renderCatalog();
  });
  renderCatalog();
  await app.loadPreset('/12_layout_presets/PRESET_OPEN_OFFICE_V10_001.json');
  loading.remove();
  app.editor.addEventListener('selectionchange', (event) => {
    const item = (event as CustomEvent).detail as { spec: { asset_id: string; instance_id: string }, record: AssetRecord } | undefined;
    const node = document.querySelector<HTMLElement>('#selection')!;
    node.innerHTML = item ? `<strong>${pretty(item.spec.asset_id)}</strong><small>${item.spec.instance_id}</small><small>${item.record.category} · ${item.record.type ?? ''}</small><button id="duplicate">복제</button><button id="delete" class="danger">삭제</button>` : '에셋을 선택하세요.';
    document.querySelector<HTMLButtonElement>('#duplicate')?.addEventListener('click', () => void app.editor.duplicateSelected());
    document.querySelector<HTMLButtonElement>('#delete')?.addEventListener('click', () => app.editor.deleteSelected());
  });
}

document.querySelector<HTMLInputElement>('#search')!.oninput = renderCatalog;
document.querySelector<HTMLButtonElement>('#moveMode')!.onclick = () => app.editor.setMode('translate');
document.querySelector<HTMLButtonElement>('#rotateMode')!.onclick = () => app.editor.setMode('rotate');
document.querySelector<HTMLButtonElement>('#save')!.onclick = () => app.saveLocal();
document.querySelector<HTMLButtonElement>('#load')!.onclick = () => void app.loadLocal();
document.querySelector<HTMLButtonElement>('#export')!.onclick = () => app.exportLayout();
document.querySelector<HTMLButtonElement>('#interact')!.onclick = () => app.interact();
document.querySelector<HTMLButtonElement>('#stand')!.onclick = () => app.avatar.stand();
document.querySelector<HTMLButtonElement>('#loadPreset')!.onclick = () => void app.loadPreset(document.querySelector<HTMLSelectElement>('#preset')!.value);

void start().catch((error) => {
  console.error(error);
  loading.textContent = `초기화 실패: ${error instanceof Error ? error.message : String(error)}`;
  status.textContent = '오류';
});
