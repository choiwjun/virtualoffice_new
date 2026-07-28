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

/** 조직도 그룹 — 그래프의 계층 정본(D39). `erp_team_id`가 있으면 그 팀 사람들이 매달린다. */
export interface OrgGroupNode {
  id: string;
  name: string;
  type: string;
  parent_id: string | null;
  color?: string | null;
  sort_order?: number | null;
  erp_team_id?: number | null;
}

const ROLE_COLOR: Record<string, string> = {
  admin: '#4f46e5',
  super_admin: '#4f46e5',
  leader: '#0891b2',
  employee: '#64748b',
};

const TYPE_LABEL: Record<string, string> = { division: '본부', department: '부서', part: '파트' };

const NODE_W = 168;
const X_GAP = 22;
const Y_GAP = 104;

type Kind = 'company' | 'group' | 'unmapped' | 'person';

interface TreeNode {
  id: string;
  label: string;
  sub?: string;
  kind: Kind;
  color?: string;
  children: TreeNode[];
  /** measure()가 채우는 서브트리 폭. */
  width?: number;
}

function measure(n: TreeNode): number {
  if (n.children.length === 0) {
    n.width = NODE_W;
    return n.width;
  }
  const inner =
    n.children.reduce((sum, c) => sum + measure(c), 0) + X_GAP * (n.children.length - 1);
  n.width = Math.max(NODE_W, inner);
  return n.width;
}

function styleFor(n: TreeNode): React.CSSProperties {
  const base: React.CSSProperties = {
    borderRadius: 8,
    padding: 8,
    width: NODE_W,
    fontSize: 12,
    whiteSpace: 'pre-line',
    textAlign: 'center',
  };
  if (n.kind === 'company') {
    return { ...base, background: '#111827', color: '#fff', border: 'none', fontWeight: 700 };
  }
  if (n.kind === 'unmapped') {
    // 이름을 이어 주지 않은 팀 — 점선으로 "조직도에 아직 없다"를 표시한다(D39-d).
    return { ...base, background: '#f1f5f9', color: '#64748b', border: '1px dashed #94a3b8', fontWeight: 600 };
  }
  if (n.kind === 'group') {
    // 배경은 **불투명**이어야 한다 — 반투명으로 두면 어두운 캔버스가 비쳐 짙은 글자가 묻힌다.
    // 그룹 색은 테두리로만 쓴다(조직 색 정체성은 유지하면서 대비는 배경이 보장).
    const c = n.color || '#a5b4fc';
    return { ...base, background: '#eef2ff', color: '#1e293b', border: `2px solid ${c}`, fontWeight: 700 };
  }
  return { ...base, background: '#fff', color: '#1f2937', border: `2px solid ${n.color ?? '#64748b'}` };
}

/**
 * 조직도 그래프 — **`org_group` 계층을 그대로 그린다**(회사 → 본부 → 부서 → 파트 → 구성원).
 *
 * 예전에는 `회사 → 팀(erp_team_id) → 사람` 2단이었다. D39로 이름은 조직도를 따르게 했지만
 * **구조는 여전히 둘**이라, 같은 화면에서 좌측 트리는 3단인데 그래프는 2단이었다.
 * 사람은 자기 팀 번호를 맡은 그룹에 매달린다. 맡은 그룹이 없는 팀은 회사 직속 점선 노드로
 * 남겨 "아직 안 이었다"가 보이게 한다 — 숨기면 그 사람들이 조직도에서 사라진다.
 */
function buildTree(
  employees: OrgEmployee[],
  groups: OrgGroupNode[],
  companyName: string,
): TreeNode {
  const byTeam = new Map<number, OrgEmployee[]>();
  for (const e of employees) {
    const list = byTeam.get(e.erp_team_id);
    if (list) list.push(e);
    else byTeam.set(e.erp_team_id, [e]);
  }

  const sorted = [...groups].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const childrenOf = new Map<string | null, OrgGroupNode[]>();
  for (const g of sorted) {
    const key = g.parent_id ?? null;
    const list = childrenOf.get(key);
    if (list) list.push(g);
    else childrenOf.set(key, [g]);
  }

  const person = (m: OrgEmployee): TreeNode => ({
    id: `emp-${m.id}`,
    label: m.name,
    sub: m.position ?? m.role,
    kind: 'person',
    color: ROLE_COLOR[m.role] ?? '#64748b',
    children: [],
  });

  const claimed = new Set<number>();
  const toNode = (g: OrgGroupNode): TreeNode => {
    const members = g.erp_team_id != null ? byTeam.get(g.erp_team_id) ?? [] : [];
    if (g.erp_team_id != null) claimed.add(g.erp_team_id);
    return {
      id: `grp-${g.id}`,
      label: g.name,
      sub: TYPE_LABEL[g.type] ?? g.type,
      kind: 'group',
      color: g.color ?? undefined,
      children: [...(childrenOf.get(g.id) ?? []).map(toNode), ...members.map(person)],
    };
  };

  const roots = (childrenOf.get(null) ?? []).map(toNode);

  // 조직도에 자리가 없는 팀 — 0(미배정) 포함. 회사 직속으로 남긴다.
  const orphans: TreeNode[] = [];
  byTeam.forEach((members, teamId) => {
    if (claimed.has(teamId)) return;
    orphans.push({
      id: `team-${teamId}`,
      label: teamId === 0 ? '미배정' : `팀 ${teamId}`,
      sub: '조직도 미연결',
      kind: 'unmapped',
      children: members.map(person),
    });
  });
  orphans.sort((a, b) => a.label.localeCompare(b.label));

  return {
    id: 'company',
    label: companyName,
    kind: 'company',
    children: [...roots, ...orphans],
  };
}

function toFlow(root: TreeNode): { nodes: Node[]; edges: Edge[] } {
  measure(root);
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const place = (n: TreeNode, left: number, depth: number, parentId?: string) => {
    const w = n.width ?? NODE_W;
    const cx = left + w / 2;
    nodes.push({
      id: n.id,
      position: { x: cx - NODE_W / 2, y: depth * Y_GAP },
      data: { label: n.sub ? `${n.label}\n${n.sub}` : n.label },
      style: styleFor(n),
    });
    if (parentId) edges.push({ id: `e-${parentId}-${n.id}`, source: parentId, target: n.id });

    if (n.children.length === 0) return;
    const inner =
      n.children.reduce((sum, c) => sum + (c.width ?? NODE_W), 0) + X_GAP * (n.children.length - 1);
    let x = left + (w - inner) / 2; // 자식 묶음을 부모 아래 가운데 정렬
    for (const c of n.children) {
      place(c, x, depth + 1, n.id);
      x += (c.width ?? NODE_W) + X_GAP;
    }
  };

  place(root, 0, 0);
  return { nodes, edges };
}

export default function OrgChartFlow({
  employees,
  groups,
  companyName = '회사',
}: {
  employees: OrgEmployee[];
  groups: OrgGroupNode[];
  companyName?: string;
}) {
  const initial = useMemo(
    () => toFlow(buildTree(employees, groups, companyName)),
    [employees, groups, companyName],
  );
  const [nodes, setNodes] = useState<Node[]>(initial.nodes);
  // 조직도는 따로 불러와 첫 렌더 뒤에 도착한다. 초기값으로만 두면 그래프가 옛 구조에 멈춘다.
  useEffect(() => setNodes(initial.nodes), [initial]);
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );

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
