'use client';

import { useMemo, useState, useCallback } from 'react';
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

function buildGraph(employees: OrgEmployee[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const rootId = 'company';
  nodes.push({
    id: rootId,
    position: { x: 400, y: 20 },
    data: { label: '회사 (company #1)' },
    style: { background: '#111827', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, padding: 8, width: 180 },
  });

  const teams = Array.from(new Set(employees.map((e) => e.erp_team_id))).sort((a, b) => a - b);
  teams.forEach((teamId, ti) => {
    const teamNodeId = `team-${teamId}`;
    const teamX = 120 + ti * 320;
    nodes.push({
      id: teamNodeId,
      position: { x: teamX, y: 160 },
      data: { label: `팀 #${teamId}` },
      style: { background: '#e0e7ff', color: '#3730a3', border: '1px solid #a5b4fc', borderRadius: 8, fontWeight: 600, padding: 8, width: 160 },
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

export default function OrgChartFlow({ employees }: { employees: OrgEmployee[] }) {
  const initial = useMemo(() => buildGraph(employees), [employees]);
  const [nodes, setNodes] = useState<Node[]>(initial.nodes);
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
