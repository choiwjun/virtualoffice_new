using System;
using System.Collections.Generic;
using UnityEngine;

namespace VirtualOffice.V10 {
    [Serializable] public class LayoutItem { public string asset_id; public string instance_id; public float[] position; public float rotation_z_deg; }
    [Serializable] public class LayoutPreset { public string preset_id; public LayoutItem[] instances; }
    public sealed class VirtualOfficeLayoutSpawnerV10 : MonoBehaviour {
        [Serializable] public class AssetPrefab { public string assetId; public GameObject prefab; }
        public AssetPrefab[] catalog;
        public void Spawn(TextAsset layoutJson) {
            var preset = JsonUtility.FromJson<LayoutPreset>(layoutJson.text);
            var map = new Dictionary<string, GameObject>(); foreach (var item in catalog) map[item.assetId] = item.prefab;
            foreach (var item in preset.instances) if (map.TryGetValue(item.asset_id, out var prefab)) {
                var p = item.position; Instantiate(prefab, new Vector3(p[0], p[2], p[1]), Quaternion.Euler(0, -item.rotation_z_deg, 0), transform).name = item.instance_id;
            }
        }
    }
}
