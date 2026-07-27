'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  type Node,
  type Edge,
  type NodeChange,
} from 'reactflow';
import 'reactflow/dist/style.css';

export interface OrgEmployee {
  id: number;
  name: string;
  email: string;
  erp_team_id: number;
  role: string;
  position?: string | null;
}

const ROLE_COLOR: Record<string, string> = {
  admin: '#4f46e5',
  super_admin: '#4f46e5',
  leader: '#0891b2',
  employee: '#64748b',
};

/** 팀 번호 → 이름. 조직도(org_group)에서 이어 준 것만 들어온다. */
export type TeamNames = Map<number, string>;

/** 이름을 안 이어 준 팀은 번호를 그대로 보여 준다 — 지어낸 이름보다 낫고, 이으면 사라진다. */
function teamLabel(teamId: number, names: TeamNames): string {
  if (teamId === 0) return '미배정';
  return names.get(teamId) ?? `팀 ${teamId}`;
}

function buildGraph(
  employees: OrgEmployee[],
  names: TeamNames,
  companyName: string,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const rootId = 'company';
  nodes.push({
    id: rootId,
    position: { x: 400, y: 20 },
    data: { label: companyName },
    style: { background: '#111827', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, padding: 8, width: 180 },
  });

  const teams = Array.from(new Set(employees.map((e) => e.erp_team_id))).sort((a, b) => a - b);
  teams.forEach((teamId, ti) => {
    const teamNodeId = `team-${teamId}`;
    const teamX = 120 + ti * 320;
    const named = names.has(teamId);
    nodes.push({
      id: teamNodeId,
      position: { x: teamX, y: 160 },
      data: { label: teamLabel(teamId, names) },
      style: {
        background: named ? '#e0e7ff' : '#f1f5f9',
        color: named ? '#3730a3' : '#64748b',
        // 이름 없는 팀은 점선 — 조직도에 아직 안 이어졌다는 뜻이 한눈에 보인다.
        border: named ? '1px solid #a5b4fc' : '1px dashed #94a3b8',
        borderRadius: 8, fontWeight: 600, padding: 8, width: 160,
      },
    });
    edges.push({ id: `e-${rootId}-${teamNodeId}`, source: rootId, target: teamNodeId, animated: false });

    const members = employees.filter((e) => e.erp_team_id === teamId);
    members.forEach((m, mi) => {
      const empNodeId = `emp-${m.id}`;
      nodes.push({
        id: empNodeId,
        position: { x: teamX - 40 + (mi % 2) * 200, y: 300 + Math.floor(mi / 2) * 90 },
        data: { label: `${m.name}\n${m.position ?? m.role}` },
        style: {
          background: '#fff',
          color: '#1f2937',
          border: `2px solid ${ROLE_COLOR[m.role] ?? '#64748b'}`,
          borderRadius: 8,
          padding: 8,
          width: 150,
          whiteSpace: 'pre-line',
          fontSize: 12,
        },
      });
      edges.push({ id: `e-${teamNodeId}-${empNodeId}`, source: teamNodeId, target: empNodeId });
    });
  });
  return { nodes, edges };
}

export default function OrgChartFlow({
  employees,
  teamNames,
  companyName = '회사',
}: {
  employees: OrgEmployee[];
  teamNames: TeamNames;
  companyName?: string;
}) {
  const initial = useMemo(
    () => buildGraph(employees, teamNames, companyName),
    [employees, teamNames, companyName],
  );
  const [nodes, setNodes] = useState<Node[]>(initial.nodes);
  // 이름은 조직도를 따로 불러와 채우므로 첫 렌더 뒤에 도착한다. 초기값으로만 두면
  // 그래프가 "팀 1"에 멈춘 채 좌측 트리와 계속 어긋난다.
  useEffect(() => setNodes(initial.nodes), [initial]);
  const onNodesChange = useCallback((changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)), []);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow nodes={nodes} edges={initial.edges} onNodesChange={onNodesChange} fitView proOptions={{ hideAttribution: true }}>
        <Background gap={16} color="#e5e7eb" />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
