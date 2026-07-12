import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { AssetStore } from './AssetStore.js';
import { GridNav } from './GridNav.js';
import { AvatarController } from './AvatarController.js';
import { LayoutEditor } from './LayoutEditor.js';
import type { AssetRecord, LayoutPreset } from '../types.js';

export class OfficeApp {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  labels = new CSS2DRenderer();
  controls: OrbitControls;
  composer: EffectComposer;
  store = new AssetStore();
  nav = new GridNav();
  avatar = new AvatarController(this.nav);
  editor!: LayoutEditor;
  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();
  ground = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), new THREE.MeshStandardMaterial({ color: 0x64676b, roughness: 0.92, metalness: 0.0 }));
  clock = new THREE.Clock();
  nameTag = document.createElement('div');
  status = '준비 중';
  onStatus?: (text: string) => void;

  constructor(public container: HTMLElement) {
    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
    this.scene.background = new THREE.Color(0x151b24);
    this.scene.fog = new THREE.FogExp2(0x151b24, 0.006);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.05, 120);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(12.8, -15.8, 13.6);
    this.camera.lookAt(0, 0, 0.65);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.72;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.append(this.renderer.domElement);
    this.labels.domElement.className = 'label-layer';
    container.append(this.labels.domElement);
    this.controls = new OrbitControls(this.camera, this.labels.domElement);
    this.controls.target.set(0, 0, 0.65);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 28;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.10, 0.24, 0.92);
    this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());
    this.setupEnvironment();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private setupEnvironment(): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();
    const hemi = new THREE.HemisphereLight(0xbfd4ef, 0x342d27, 0.42);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0dc, 1.65);
    sun.position.set(-5, -6, 11);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -10; sun.shadow.camera.right = 10;
    sun.shadow.camera.top = 8; sun.shadow.camera.bottom = -8;
    sun.shadow.bias = -0.00015;
    sun.shadow.normalBias = 0.025;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x91b5ea, 0.28);
    fill.position.set(8, 4, 7); this.scene.add(fill);
    this.ground.rotation.x = 0;
    this.ground.position.z = -0.02;
    this.ground.receiveShadow = true;
    this.ground.name = 'RuntimeGround';
    this.scene.add(this.ground);
    const grid = new THREE.GridHelper(14, 56, 0x49617a, 0x2c3744);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = 0.005;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.18;
    grid.visible = false; // editor에서만 필요할 때 켜기
    this.scene.add(grid);
  }

  async initialize(): Promise<void> {
    this.setStatus('레지스트리 로딩');
    await this.store.initialize();
    this.editor = new LayoutEditor(this.scene, this.camera, this.renderer, this.controls, this.store);
    this.editor.addEventListener('layoutchange', () => this.nav.setObstacles(this.editor.getObstacles()));
    this.scene.add(this.avatar.root);
    this.setStatus('캐릭터 로딩');
    await this.avatar.load();
    this.avatar.root.position.set(0, -3.2, 0);
    this.addNameTag();
    this.bindPointer();
    this.animate();
    this.setStatus('준비 완료');
  }

  async loadPreset(url: string): Promise<LayoutPreset> {
    this.setStatus('프리셋 로딩');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Preset failed: ${response.status}`);
    const preset = await response.json() as LayoutPreset;
    await this.editor.loadPreset(preset);
    this.nav.bounds = preset.bounds_xy;
    this.nav.setObstacles(this.editor.getObstacles());
    this.avatar.root.position.fromArray(preset.avatar_spawn);
    this.avatar.stop();
    this.setStatus(`${preset.name} 로드 완료`);
    return preset;
  }

  private addNameTag(): void {
    this.nameTag.className = 'name-tag';
    this.nameTag.innerHTML = '<span class="status-dot"></span>내 아바타';
    const label = new CSS2DObject(this.nameTag);
    label.position.set(0, 0, 2.0);
    this.avatar.root.add(label);
  }

  private bindPointer(): void {
    this.labels.domElement.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const rect = this.labels.domElement.getBoundingClientRect();
      this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const selected = this.editor.pick(this.raycaster);
      if (selected) { this.editor.select(selected); return; }
      const groundHit = this.raycaster.intersectObject(this.ground, false)[0];
      if (groundHit) {
        this.editor.select(undefined);
        const ok = this.avatar.moveTo(groundHit.point);
        this.setStatus(ok ? '이동 중' : '목적지에 접근할 수 없습니다');
      }
    });
    window.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === 'Delete' || event.key === 'Backspace') this.editor.deleteSelected();
      if (event.key.toLowerCase() === 'g') this.editor.setMode('translate');
      if (event.key.toLowerCase() === 'r') this.editor.setMode('rotate');
      if (event.key.toLowerCase() === 'd' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void this.editor.duplicateSelected(); }
      if (event.key.toLowerCase() === 'e') this.interact();
      if (event.key === 'Escape') { if (this.avatar.seated) this.avatar.stand(); else this.editor.select(undefined); }
    });
  }

  interact(): void {
    if (this.avatar.seated) { this.avatar.stand(); this.setStatus('일어섰습니다'); return; }
    const interaction = this.editor.nearestInteraction(this.avatar.root.position);
    if (!interaction) { this.setStatus('가까운 좌석/업무 지점이 없습니다'); return; }
    this.avatar.sitAt(interaction.position, interaction.yaw, interaction.typing);
    this.setStatus(interaction.typing ? '업무 중' : '착석');
  }

  async addAsset(assetId: string): Promise<void> {
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const p = this.controls.target.clone().add(forward.multiplyScalar(0.1));
    p.z = 0;
    const item = await this.editor.spawn(assetId, [p.x, p.y, 0]);
    this.editor.select(item);
    this.setStatus(`${assetId} 추가`);
  }

  availableAssets(): AssetRecord[] { return this.store.list(); }

  exportLayout(): void {
    const data = this.editor.exportLayout();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'virtual-office-layout-v10.json'; a.click();
    URL.revokeObjectURL(url);
  }

  saveLocal(): void {
    localStorage.setItem('virtual-office-layout-v10', JSON.stringify(this.editor.exportLayout()));
    this.setStatus('브라우저에 저장했습니다');
  }

  async loadLocal(): Promise<void> {
    const raw = localStorage.getItem('virtual-office-layout-v10');
    if (!raw) { this.setStatus('저장된 레이아웃이 없습니다'); return; }
    await this.editor.loadPreset(JSON.parse(raw) as LayoutPreset);
    this.nav.setObstacles(this.editor.getObstacles());
    this.setStatus('저장된 레이아웃을 불러왔습니다');
  }

  setStatus(text: string): void { this.status = text; this.onStatus?.(text); }

  private resize(): void {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / Math.max(h, 1); this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.labels.setSize(w, h); this.composer.setSize(w, h);
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.avatar.update(dt);
    this.editor?.update(dt);
    this.controls.update();
    this.composer.render();
    this.labels.render(this.scene, this.camera);
  };
}
