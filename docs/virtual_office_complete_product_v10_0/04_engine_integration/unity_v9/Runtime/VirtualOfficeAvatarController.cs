using UnityEngine;

namespace VirtualOffice {
    [RequireComponent(typeof(Animator))]
    public sealed class VirtualOfficeAvatarController : MonoBehaviour {
        [SerializeField] private Animator animator;
        [SerializeField, Min(0f)] private float defaultFade = 0.18f;

        private void Reset() => animator = GetComponent<Animator>();
        private void Awake() { if (!animator) animator = GetComponent<Animator>(); }

        public void Play(VirtualOfficeClipId clip, float? fade = null) {
            if (!animator) throw new MissingComponentException("Animator is required.");
            animator.CrossFade(clip.ToString(), fade ?? defaultFade, 0);
        }
    }
}
