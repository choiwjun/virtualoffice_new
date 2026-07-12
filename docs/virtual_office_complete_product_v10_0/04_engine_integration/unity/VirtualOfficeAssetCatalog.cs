using System;
using System.Collections.Generic;
using UnityEngine;

[Serializable]
public class VirtualOfficeAssetRecord {
    public string asset_id;
    public string category;
    public string type;
    public string file;
    public string deliverable_kind;
    public bool runtime_ready;
}

[Serializable]
public class VirtualOfficeAssetRegistry {
    public string version;
    public string name;
    public List<VirtualOfficeAssetRecord> assets;
}

public class VirtualOfficeAssetCatalog : MonoBehaviour {
    public TextAsset assetRegistryJson;
    public VirtualOfficeAssetRegistry Registry { get; private set; }

    void Awake() {
        if (assetRegistryJson != null) {
            Registry = JsonUtility.FromJson<VirtualOfficeAssetRegistry>(assetRegistryJson.text);
            Debug.Log($"Virtual Office assets loaded: {Registry.assets.Count}");
        }
    }
}
