'use client';

import React from 'react';

export interface OrganizedBubbleAtlasNode {
  id: string;
  label: string;
  x: number;
  y: number;
  paperCount: number;
  claimCount?: number;
  markerColor?: string;
  haloColor?: string;
  dimmed?: boolean;
  connected?: boolean;
}

export interface OrganizedBubbleAtlasEdge {
  source: string;
  target: string;
  weight: number;
  color?: string;
}

export interface OrganizedBubbleAtlasProps
  extends Omit<React.SVGAttributes<SVGSVGElement>, 'onSelect'> {
  nodes: OrganizedBubbleAtlasNode[];
  edges: OrganizedBubbleAtlasEdge[];
  selectedNodeId?: string | null;
  width?: number;
  height?: number;
  onNodeSelect?: (node: OrganizedBubbleAtlasNode) => void;
}

function polarArcPath(x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 - 40;
  return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
}

export function OrganizedBubbleAtlas({
  nodes,
  edges,
  selectedNodeId = null,
  width = 1120,
  height = 760,
  onNodeSelect,
  className,
  ...props
}: OrganizedBubbleAtlasProps) {
  const connectedNodeIds = new Set<string>();
  if (selectedNodeId) {
    for (const edge of edges) {
      if (edge.source === selectedNodeId) connectedNodeIds.add(edge.target);
      if (edge.target === selectedNodeId) connectedNodeIds.add(edge.source);
    }
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      {...props}
    >
      <defs>
        <pattern id="rd-atlas-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="12" cy="12" r="1" fill="rgba(190, 174, 156, 0.45)" />
        </pattern>
        <filter id="rd-atlas-blur">
          <feGaussianBlur stdDeviation="18" />
        </filter>
      </defs>
      <rect width={width} height={height} fill="url(#rd-atlas-grid)" />
      {edges.map((edge) => {
        const source = nodes.find((node) => node.id === edge.source);
        const target = nodes.find((node) => node.id === edge.target);
        if (!source || !target) return null;
        return (
          <path
            key={`${edge.source}-${edge.target}`}
            d={polarArcPath(source.x, source.y, target.x, target.y)}
            fill="none"
            stroke={edge.color || 'rgba(211, 196, 174, 0.9)'}
            strokeOpacity={Math.min(0.9, 0.18 + edge.weight * 0.12)}
            strokeWidth={1 + edge.weight * 0.6}
          />
        );
      })}
      {nodes.map((node) => {
        const active = node.id === selectedNodeId;
        const connected = active || connectedNodeIds.has(node.id);
        const dimmed = Boolean(selectedNodeId) && !connected;
        const haloFill = node.haloColor || '#e8cda6';
        const markerFill = node.markerColor || '#c87b14';

        return (
          <g
            key={node.id}
            transform={`translate(${node.x}, ${node.y})`}
            style={{ cursor: onNodeSelect ? 'pointer' : 'default' }}
            opacity={dimmed ? 0.34 : connected ? 1 : 0.7}
            onClick={() => onNodeSelect?.(node)}
          >
            <circle
              r={56 + node.paperCount * 0.62}
              fill={haloFill}
              opacity="0.12"
              filter="url(#rd-atlas-blur)"
            />
            <circle r={30 + node.paperCount * 0.34} fill={haloFill} opacity="0.28" />
            <circle r="14" fill={markerFill} />
            {active && <circle r="24" fill="none" stroke={markerFill} strokeWidth="1.5" />}
            <text
              y="-26"
              textAnchor="middle"
              fill="var(--rd-color-text-primary)"
              style={{
                fontFamily: 'var(--rd-font-body)',
                fontSize: `${14 + Math.min(18, node.paperCount * 0.4)}px`,
                fontWeight: 600,
              }}
            >
              {node.label}
            </text>
            <text
              y="30"
              textAnchor="middle"
              fill="var(--rd-color-text-secondary)"
              style={{
                fontFamily: 'var(--rd-font-body)',
                fontSize: '12px',
              }}
            >
              {node.paperCount} papers{node.claimCount != null ? ` · ${node.claimCount} claims` : ''}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
