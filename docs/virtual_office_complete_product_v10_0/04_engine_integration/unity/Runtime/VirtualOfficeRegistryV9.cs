using System;
using System.Collections.Generic;
using UnityEngine;

namespace VirtualOffice.Assets.V9
{
    [Serializable]
    public sealed class VirtualOfficeRegistryV9
    {
        public string version;
        public int asset_count;
        public List<VirtualOfficeRegistryAssetV9> assets;
    }

    [Serializable]
    public sealed class VirtualOfficeRegistryAssetV9
    {
        public string asset_id;
        public string category;
        public string type;
        public string file;
        public bool runtime_ready;
    }

    public sealed class VirtualOfficeRegistryLoaderV9 : MonoBehaviour
    {
        [SerializeField] private TextAsset registryJson;
        public VirtualOfficeRegistryV9 Registry { get; private set; }

        private void Awake()
        {
            if (registryJson == null) throw new InvalidOperationException("Assign asset-registry-v9.json as a TextAsset.");
            Registry = JsonUtility.FromJson<VirtualOfficeRegistryV9>(registryJson.text);
            if (Registry?.assets == null) throw new InvalidOperationException("Asset registry JSON could not be parsed.");
        }

        public VirtualOfficeRegistryAssetV9 Find(string assetId)
            => Registry.assets.Find(asset => asset.asset_id == assetId);
    }
}
