# Mixamo FBX 임포트 진단 — 왜 몸이 안 보이는가
import bpy
import sys

argv = sys.argv[sys.argv.index("--") + 1 :]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=argv[0])

print("=== OBJECTS ===")
for o in bpy.data.objects:
    print(f"  {o.type:9s} {o.name:28s} scale={tuple(round(s,3) for s in o.scale)} loc_z={round(o.location.z,3)} hide_render={o.hide_render} hide_vp={o.hide_viewport}")
    if o.type == "MESH":
        print(f"            verts={len(o.data.vertices)} mats={[m.name if m else None for m in o.data.materials]}")

print("=== MATERIALS ===")
for m in bpy.data.materials:
    if not m.node_tree:
        print(f"  {m.name}: (no nodes)")
        continue
    for n in m.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED":
            alpha = n.inputs["Alpha"]
            base = n.inputs["Base Color"]
            info = {
                "alpha_val": round(alpha.default_value, 3),
                "alpha_linked": alpha.is_linked,
                "base_linked": base.is_linked,
            }
            print(f"  {m.name}: {info}")
    # 출력 노드에 연결된 최종 셰이더 종류
    out = next((n for n in m.node_tree.nodes if n.type == "OUTPUT_MATERIAL"), None)
    if out and out.inputs["Surface"].is_linked:
        print(f"    -> surface: {out.inputs['Surface'].links[0].from_node.type}")

print("=== IMAGES ===")
for img in bpy.data.images:
    print(f"  {img.name}: size={tuple(img.size)} packed={img.packed_file is not None} filepath={img.filepath[:60]}")
print("DIAG DONE")
