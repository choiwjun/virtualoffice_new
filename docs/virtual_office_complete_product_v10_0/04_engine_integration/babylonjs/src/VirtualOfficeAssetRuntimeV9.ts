import "@babylonjs/loaders/glTF";
import { AbstractMesh, AssetContainer, Scene, SceneLoader } from "@babylonjs/core";

export interface RegistryAsset {
  asset_id: string;
  category: string;
  type: string;
  file: string;
  rig?: { skinned?: boolean; embedded_clips?: string[] };
}

export interface AssetRegistry {
  version: string;
  asset_count: number;
  assets: RegistryAsset[];
}

function splitUrl(url: string): { rootUrl: string; fileName: string } {
  const lastSlash = url.lastIndexOf("/");
  return { rootUrl: url.slice(0, lastSlash + 1), fileName: url.slice(lastSlash + 1) };
}

export class VirtualOfficeAssetRuntimeV9 {
  private registry?: AssetRegistry;
  private byId = new Map<string, RegistryAsset>();
  private containers = new Map<string, Promise<AssetContainer>>();

  constructor(public readonly packageBaseUrl: string, public readonly scene: Scene) {}

  async initialize(): Promise<AssetRegistry> {
    const url = new URL("05_registries/asset-registry-v9.json", this.packageBaseUrl);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Registry request failed: ${response.status}`);
    this.registry = (await response.json()) as AssetRegistry;
    for (const asset of this.registry.assets) this.byId.set(asset.asset_id, asset);
    return this.registry;
  }

  getAsset(assetId: string): RegistryAsset {
    const asset = this.byId.get(assetId);
    if (!asset) throw new Error(`Unknown asset id: ${assetId}`);
    return asset;
  }

  private loadContainer(asset: RegistryAsset): Promise<AssetContainer> {
    const cached = this.containers.get(asset.asset_id);
    if (cached) return cached;
    const url = new URL(asset.file, this.packageBaseUrl).toString();
    const { rootUrl, fileName } = splitUrl(url);
    const request = SceneLoader.LoadAssetContainerAsync(rootUrl, fileName, this.scene);
    this.containers.set(asset.asset_id, request);
    return request;
  }

  async instantiate(assetId: string): Promise<{ rootNodes: AbstractMesh[]; container: AssetContainer }> {
    const asset = this.getAsset(assetId);
    const container = await this.loadContainer(asset);
    const instance = container.instantiateModelsToScene((name) => `${assetId}_${name}`, true, {
      doNotInstantiate: false,
    });
    const roots = instance.rootNodes.filter((node): node is AbstractMesh => node instanceof AbstractMesh);
    return { rootNodes: roots, container };
  }
}
