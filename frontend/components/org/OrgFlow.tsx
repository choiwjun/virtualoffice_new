"use client";

import ReactFlow, { Background, Controls, Node, Edge } from "reactflow";
import "reactflow/dist/style.css";

export interface OrgFlowProps {
  nodes: Node[];
  edges: Edge[];
  onNodeClick: (id: string) => void;
}

export default function OrgFlow({ nodes, edges, onNodeClick }: OrgFlowProps) {
  return (
    <div className="h-[560px] w-full overflow-hidden rounded-lg border border-panel2 bg-panel">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={(_, node) => onNodeClick(node.id)}
        fitView
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
      >
        <Background color="#334155" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
