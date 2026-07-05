"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { Node, Edge } from "reactflow";
import { ApiError, OrgApi, OrgGroup, OrgGroupNode } from "@/lib/api";
import { isAdmin, useAuth } from "@/lib/auth";

const OrgFlow = dynamic(() => import("@/components/org/OrgFlow"), {
  ssr: false,
  loading: () => <div className="grid h-[560px] w-full place-items-center text-sub">조직도 로딩…</div>,
});

const TYPE_COLOR: Record<string, string> = {
  division: "#6366f1",
  department: "#0ea5e9",
  part: "#22c55e",
};
const TYPE_LABEL: Record<string, string> = { division: "본부", department: "부서", part: "파트" };

interface FlatNode {
  node: OrgGroup;
  depth: number;
}

// 트리 → React Flow 노드/엣지 (레벨=y, 리프순서=x)
function layout(roots: OrgGroupNode[]): { nodes: Node[]; edges: Edge[]; flat: FlatNode[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const flat: FlatNode[] = [];
  let leafX = 0;

  function walk(n: OrgGroupNode, depth: number): number {
    flat.push({ node: n, depth });
    let myX: number;
    if (n.children.length === 0) {
      myX = leafX;
      leafX += 1;
    } else {
      const childXs = n.children.map((c) => walk(c, depth + 1));
      myX = (Math.min(...childXs) + Math.max(...childXs)) / 2;
    }
    const color = TYPE_COLOR[n.type] ?? "#64748b";
    nodes.push({
      id: n.id,
      position: { x: myX * 190, y: depth * 120 },
      data: { label: `${n.name}\n(${TYPE_LABEL[n.type] ?? n.type})` },
      style: {
        background: "#1e293b",
        color: "#e2e8f0",
        border: `2px solid ${n.color || color}`,
        borderRadius: 8,
        fontSize: 12,
        width: 150,
        whiteSpace: "pre-line",
        textAlign: "center",
      },
    });
    if (n.parent_id) edges.push({ id: `${n.parent_id}-${n.id}`, source: n.parent_id, target: n.id });
    return myX;
  }

  roots.forEach((r) => walk(r, 0));
  return { nodes, edges, flat };
}

export default function OrgChartPage() {
  const { user } = useAuth();
  const admin = isAdmin(user?.role);
  const [roots, setRoots] = useState<OrgGroupNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 생성 폼
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("division");

  const notify = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 2500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await OrgApi.tree();
      setRoots(d.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "조직도 로딩 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const { nodes, edges, flat } = useMemo(() => layout(roots), [roots]);
  const selected = flat.find((f) => f.node.id === selectedId)?.node ?? null;

  async function addNode() {
    if (!newName.trim()) {
      notify("이름을 입력하세요.");
      return;
    }
    try {
      await OrgApi.create({ name: newName, type: newType, parent_id: selectedId ?? undefined });
      notify(selectedId ? "하위 조직이 추가되었습니다" : "루트 조직이 추가되었습니다");
      setNewName("");
      load();
    } catch (err) {
      notify(err instanceof ApiError ? `추가 실패: ${err.detail}` : "추가 실패");
    }
  }

  async function rename() {
    if (!selected) return;
    const name = window.prompt("새 이름:", selected.name);
    if (!name || name === selected.name) return;
    try {
      await OrgApi.update(selected.id, { name });
      notify("이름이 변경되었습니다");
      load();
    } catch (err) {
      notify(err instanceof ApiError ? `변경 실패: ${err.detail}` : "변경 실패");
    }
  }

  async function remove() {
    if (!selected) return;
    if (!window.confirm(`"${selected.name}" 조직을 삭제하시겠습니까? (하위/참조가 있으면 실패)`)) return;
    try {
      await OrgApi.remove(selected.id);
      notify("삭제되었습니다");
      setSelectedId(null);
      load();
    } catch (err) {
      notify(err instanceof ApiError ? `삭제 실패: ${err.detail}` : "삭제 실패");
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">조직도</h1>
          <p className="mt-1 text-sm text-sub">
            본부·부서·파트 계층 (ERP 팀=리프는 불변). {admin ? "노드 선택 후 하위 추가/편집" : "열람 전용"}
          </p>
        </div>
        <button className="btn-ghost" onClick={load}>
          새로고침
        </button>
      </header>

      {error && <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}

      <div className="flex flex-wrap gap-4">
        <div className="min-w-[420px] flex-1">
          {loading ? (
            <div className="grid h-[560px] place-items-center text-sub">불러오는 중…</div>
          ) : nodes.length === 0 ? (
            <div className="card text-sub">조직 그룹이 없습니다. {admin ? "오른쪽에서 루트 조직을 추가하세요." : ""}</div>
          ) : (
            <OrgFlow nodes={nodes} edges={edges} onNodeClick={setSelectedId} />
          )}
        </div>

        {admin && (
          <div className="w-72 shrink-0 space-y-4">
            <div className="card space-y-2">
              <h2 className="text-sm font-medium">선택 노드</h2>
              {selected ? (
                <>
                  <div className="text-sm">
                    {selected.name}{" "}
                    <span className="badge bg-panel2 text-sub">{TYPE_LABEL[selected.type] ?? selected.type}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="btn-ghost" onClick={rename}>
                      이름 변경
                    </button>
                    <button className="btn-ghost text-danger" onClick={remove}>
                      삭제
                    </button>
                    <button className="btn-ghost" onClick={() => setSelectedId(null)}>
                      선택 해제
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-xs text-sub">노드를 클릭하면 여기서 편집하거나 하위를 추가할 수 있습니다.</p>
              )}
            </div>

            <div className="card space-y-2">
              <h2 className="text-sm font-medium">{selected ? `"${selected.name}" 하위 추가` : "루트 조직 추가"}</h2>
              <input className="input" placeholder="조직명" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <select className="input" value={newType} onChange={(e) => setNewType(e.target.value)}>
                <option value="division">본부(division)</option>
                <option value="department">부서(department)</option>
                <option value="part">파트(part)</option>
              </select>
              <button className="btn w-full" onClick={addNode}>
                추가
              </button>
            </div>
          </div>
        )}
      </div>

      {toast && <div className="fixed bottom-6 right-6 z-50 rounded-md bg-panel2 px-4 py-2 text-sm shadow-lg">{toast}</div>}
    </div>
  );
}
