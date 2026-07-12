#if UNITY_EDITOR
using System.IO;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

namespace VirtualOffice.Editor {
    public static class VirtualOfficeAnimatorControllerBuilder {
        [MenuItem("Virtual Office/Build Animator Controller From Selected Clips")]
        public static void Build() {
            const string output = "Assets/VirtualOffice/VirtualOfficeAvatar.controller";
            Directory.CreateDirectory(Path.GetDirectoryName(output)!);
            var controller = AnimatorController.CreateAnimatorControllerAtPath(output);
            var sm = controller.layers[0].stateMachine;
            foreach (var obj in Selection.objects) {
                if (obj is AnimationClip clip && clip.name.StartsWith("ANIM_")) {
                    var state = sm.AddState(clip.name);
                    state.motion = clip;
                    if (clip.name == "ANIM_IDLE_001") sm.defaultState = state;
                }
            }
            AssetDatabase.SaveAssets();
            Selection.activeObject = controller;
            Debug.Log($"Created {output}");
        }
    }
}
#endif
