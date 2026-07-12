using System;
using System.Collections.Generic;
using UnityEngine;

namespace VirtualOffice.Assets.V9
{
    [DisallowMultipleComponent]
    public sealed class VirtualOfficeAvatarControllerV9 : MonoBehaviour
    {
        [SerializeField] private Animator animator;
        [SerializeField, Min(0f)] private float defaultCrossFadeSeconds = 0.18f;
        [SerializeField] private VirtualOfficeClipId initialClip = VirtualOfficeClipId.ANIM_IDLE_001;

        private readonly Dictionary<VirtualOfficeClipId, int> stateHashes = new();
        public VirtualOfficeClipId CurrentClip { get; private set; }

        private void Awake()
        {
            if (animator == null) animator = GetComponentInChildren<Animator>();
            if (animator == null) throw new InvalidOperationException("A rigged avatar Animator is required.");
            foreach (VirtualOfficeClipId value in Enum.GetValues(typeof(VirtualOfficeClipId)))
                stateHashes[value] = Animator.StringToHash(value.ToString());
        }

        private void Start() => Play(initialClip, 0f);

        public void Play(VirtualOfficeClipId clip, float crossFadeSeconds = -1f)
        {
            float fade = crossFadeSeconds >= 0f ? crossFadeSeconds : defaultCrossFadeSeconds;
            animator.CrossFade(stateHashes[clip], fade, 0, 0f);
            CurrentClip = clip;
        }

        public void SetMovementSpeed(float metersPerSecond)
            => Play(metersPerSecond > 0.1f ? VirtualOfficeClipId.ANIM_WALK_001 : VirtualOfficeClipId.ANIM_IDLE_001);

        public void SetDeskState(bool working)
            => Play(working ? VirtualOfficeClipId.ANIM_TYPING_001 : VirtualOfficeClipId.ANIM_SIT_001);

        public void EnterSeat(bool working)
        {
            Play(VirtualOfficeClipId.ANIM_SIT_DOWN_001);
            // The application may use an Animation Event or StateMachineBehaviour to advance to SIT/TYPING.
        }

        public void ExitSeat() => Play(VirtualOfficeClipId.ANIM_STAND_UP_001);
    }
}
