using UnityEngine;
using UnityEngine.AI;

namespace VirtualOffice.V10 {
    [RequireComponent(typeof(NavMeshAgent), typeof(Animator))]
    public sealed class VirtualOfficeNavAgentV10 : MonoBehaviour {
        [SerializeField] private Camera inputCamera;
        private NavMeshAgent agent;
        private Animator animator;
        private static readonly int Speed = Animator.StringToHash("Speed");
        private void Awake() { agent = GetComponent<NavMeshAgent>(); animator = GetComponent<Animator>(); if (!inputCamera) inputCamera = Camera.main; }
        private void Update() {
            if (Input.GetMouseButtonDown(0) && Physics.Raycast(inputCamera.ScreenPointToRay(Input.mousePosition), out var hit, 500f)) agent.SetDestination(hit.point);
            animator.SetFloat(Speed, agent.velocity.magnitude, 0.12f, Time.deltaTime);
        }
    }
}
