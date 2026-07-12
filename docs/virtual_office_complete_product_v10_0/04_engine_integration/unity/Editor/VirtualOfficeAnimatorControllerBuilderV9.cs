#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

namespace VirtualOffice.Assets.V9.Editor
{
    public static class VirtualOfficeAnimatorControllerBuilderV9
    {
        private static readonly HashSet<string> Looping = new()
        {
            "ANIM_IDLE_001", "ANIM_WALK_001", "ANIM_SIT_001", "ANIM_TYPING_001",
            "ANIM_TALK_001", "ANIM_MEETING_IDLE_001", "ANIM_PHONE_CALL_001", "ANIM_CLAP_001"
        };

        [MenuItem("Assets/Virtual Office v9/Create Animator Controller From Selected Clips")]
        public static void CreateController()
        {
            AnimationClip[] clips = Selection.objects.OfType<AnimationClip>()
                .Where(clip => Enum.TryParse<VirtualOfficeClipId>(clip.name, out _))
                .OrderBy(clip => clip.name)
                .ToArray();

            if (clips.Length == 0)
            {
                EditorUtility.DisplayDialog("Virtual Office v9", "Select the imported animation clips first.", "OK");
                return;
            }

            string target = EditorUtility.SaveFilePanelInProject(
                "Create Virtual Office Animator Controller",
                "VirtualOfficeAvatarV9",
                "controller",
                "Choose the controller asset location."
            );
            if (string.IsNullOrWhiteSpace(target)) return;

            AnimatorController controller = AnimatorController.CreateAnimatorControllerAtPath(target);
            AnimatorStateMachine stateMachine = controller.layers[0].stateMachine;
            foreach (AnimationClip clip in clips)
            {
                AnimatorState state = stateMachine.AddState(clip.name);
                state.motion = clip;
                state.writeDefaultValues = false;
                if (clip.name == "ANIM_IDLE_001") stateMachine.defaultState = state;

                SerializedObject serializedClip = new SerializedObject(clip);
                SerializedProperty loopTime = serializedClip.FindProperty("m_AnimationClipSettings.m_LoopTime");
                if (loopTime != null)
                {
                    loopTime.boolValue = Looping.Contains(clip.name);
                    serializedClip.ApplyModifiedProperties();
                }
            }
            AssetDatabase.SaveAssets();
            Selection.activeObject = controller;
        }
    }
}
#endif
