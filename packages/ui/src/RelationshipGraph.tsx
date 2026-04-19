'use client';

import React, { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';

export interface RelationshipGraphNode {
  id: string;
  label: string;
  kind: string;
  href?: string;
  connectionCount?: number;
  detail?: string;
}

export interface RelationshipGraphEdge {
  source: string;
  target: string;
  kind: string;
  weight?: number;
}

export interface RelationshipGraphNodeKindAppearance {
  fill?: string;
  stroke?: string;
  text?: string;
}

export interface RelationshipGraphEdgeKindAppearance {
  label?: string;
  color?: string;
  dashed?: boolean;
}

export interface RelationshipGraphProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children' | 'onSelect'> {
  nodes: RelationshipGraphNode[];
  edges: RelationshipGraphEdge[];
  height?: number;
  highlightedNodeId?: string | null;
  nodeKinds?: Record<string, RelationshipGraphNodeKindAppearance>;
  edgeKinds?: Record<string, RelationshipGraphEdgeKindAppearance>;
  onNodeSelect?: (node: RelationshipGraphNode) => void;
  onNodeOpen?: (node: RelationshipGraphNode) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  helperText?: string;
}

interface SimNode extends SimulationNodeDatum, RelationshipGraphNode {}

interface SimLink extends SimulationLinkDatum<SimNode> {
  kind: string;
  weight?: number;
}

const DEFAULT_NODE_KIND: RelationshipGraphNodeKindAppearance = {
  fill: 'rgba(255, 249, 241, 0.96)',
  stroke: 'rgba(154, 134, 111, 0.9)',
  text: 'var(--rd-color-text-primary)',
};

const DEFAULT_EDGE_KIND: RelationshipGraphEdgeKindAppearance = {
  color: 'rgba(153, 133, 112, 0.55)',
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function seedFromId(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function initialPosition(id: string, axis: 'x' | 'y', width: number, height: number) {
  const hash = seedFromId(`${id}-${axis}`);
  if (axis === 'x') {
    return width * 0.2 + (hash % Math.round(width * 0.6));
  }
  return height * 0.18 + (hash % Math.round(height * 0.64));
}

function truncateLabel(label: string, max: number) {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

function readableKind(kind: string, fallback?: string) {
  return fallback || kind.replace(/_/g, ' ');
}

function relationshipGraphText(weight: CSSProperties['fontWeight'] = 500): CSSProperties {
  return {
    fontFamily: 'var(--rd-font-body)',
    fontWeight: weight,
  };
}

export function RelationshipGraph({
  nodes,
  edges,
  height = 380,
  highlightedNodeId = null,
  nodeKinds,
  edgeKinds,
  onNodeSelect,
  onNodeOpen,
  emptyTitle = 'Graph not available yet',
  emptyDescription = 'Once relationships are available, this graph will show papers, claims, authors, methods, and topics in a focused network view.',
  helperText = 'Select a node to inspect its neighborhood. Click the same linked node again to open it.',
  style,
  ...props
}: RelationshipGraphProps) {
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set());
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(highlightedNodeId);

  useEffect(() => {
    setSelectedNodeId(highlightedNodeId);
  }, [highlightedNodeId]);

  const edgeKindOrder = useMemo(() => {
    const kinds = new Set(edges.map((edge) => edge.kind));
    return [...kinds].sort();
  }, [edges]);

  const visibleEdges = useMemo(
    () => edges.filter((edge) => !hiddenKinds.has(edge.kind)),
    [edges, hiddenKinds],
  );

  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const node of nodes) {
      map.set(node.id, new Set());
    }
    for (const edge of visibleEdges) {
      const sourceSet = map.get(edge.source);
      const targetSet = map.get(edge.target);
      if (sourceSet) sourceSet.add(edge.target);
      if (targetSet) targetSet.add(edge.source);
    }
    return map;
  }, [nodes, visibleEdges]);

  const degreeMap = useMemo(() => {
    const next = new Map<string, number>();
    for (const node of nodes) {
      next.set(node.id, 0);
    }
    for (const edge of visibleEdges) {
      next.set(edge.source, (next.get(edge.source) || 0) + 1);
      next.set(edge.target, (next.get(edge.target) || 0) + 1);
    }
    return next;
  }, [nodes, visibleEdges]);

  const topLabelIds = useMemo(() => {
    return [...nodes]
      .sort((left, right) => (degreeMap.get(right.id) || 0) - (degreeMap.get(left.id) || 0))
      .slice(0, Math.min(8, nodes.length))
      .map((node) => node.id);
  }, [degreeMap, nodes]);

  const activeNodeId = hoveredNodeId || selectedNodeId || highlightedNodeId;
  const activeNeighbors = activeNodeId ? adjacency.get(activeNodeId) || new Set<string>() : new Set<string>();

  const visibleLabelIds = useMemo(() => {
    const next = new Set(topLabelIds);
    if (highlightedNodeId) next.add(highlightedNodeId);
    if (activeNodeId) {
      next.add(activeNodeId);
      for (const neighborId of activeNeighbors) {
        next.add(neighborId);
      }
    }
    return next;
  }, [activeNeighbors, activeNodeId, highlightedNodeId, topLabelIds]);

  const edgeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of edges) {
      counts.set(edge.kind, (counts.get(edge.kind) || 0) + 1);
    }
    return counts;
  }, [edges]);

  const layout = useMemo(() => {
    const width = 1120;
    const viewportHeight = Math.max(height, 320);
    const padding = 44;

    const simNodes: SimNode[] = nodes.map((node) => ({
      ...node,
      x: initialPosition(node.id, 'x', width, viewportHeight),
      y: initialPosition(node.id, 'y', width, viewportHeight),
    }));
    const simNodeMap = new Map(simNodes.map((node) => [node.id, node]));
    const simLinks: SimLink[] = visibleEdges
      .filter((edge) => simNodeMap.has(edge.source) && simNodeMap.has(edge.target))
      .map((edge) => ({
        ...edge,
        source: edge.source,
        target: edge.target,
      }));

    const simulation = forceSimulation<SimNode>(simNodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(simLinks)
          .id((node) => node.id)
          .distance((link) => {
            const kind = edgeKinds?.[link.kind];
            return kind?.dashed ? 168 : 132;
          })
          .strength(0.56),
      )
      .force('charge', forceManyBody().strength(-310))
      .force('center', forceCenter(width / 2, viewportHeight / 2))
      .force('collide', forceCollide<SimNode>((node) => 26 + Math.min((node.connectionCount || degreeMap.get(node.id) || 0) * 0.75, 14)))
      .stop();

    const ticks = Math.min(260, Math.max(140, simNodes.length * 7));
    for (let index = 0; index < ticks; index += 1) {
      simulation.tick();
    }
    simulation.stop();

    for (const node of simNodes) {
      node.x = clamp(node.x || width / 2, padding, width - padding);
      node.y = clamp(node.y || viewportHeight / 2, padding, viewportHeight - padding);
    }

    return {
      width,
      height: viewportHeight,
      nodes: simNodes,
      links: simLinks,
    };
  }, [degreeMap, edgeKinds, height, nodes, visibleEdges]);

  const inspectorNode = activeNodeId ? nodeMap.get(activeNodeId) || null : null;

  function toggleKind(kind: string) {
    setHiddenKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  function handleNodeClick(node: RelationshipGraphNode) {
    if (selectedNodeId === node.id && node.href && onNodeOpen) {
      onNodeOpen(node);
      return;
    }
    setSelectedNodeId(node.id);
    onNodeSelect?.(node);
  }

  if (nodes.length === 0) {
    return (
      <div
        {...props}
        style={{
          borderRadius: '24px',
          border: '1px solid var(--rd-color-hairline)',
          backgroundColor: 'var(--rd-color-panel-muted)',
          padding: '20px',
          ...style,
        }}
      >
        <p style={{ ...relationshipGraphText(700), margin: 0, fontSize: '11px', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--rd-color-accent)' }}>
          Relationship atlas
        </p>
        <h3 style={{ margin: '10px 0 0 0', fontFamily: 'var(--rd-font-display)', fontSize: '28px', lineHeight: 1.05 }}>
          {emptyTitle}
        </h3>
        <p style={{ ...relationshipGraphText(500), margin: '12px 0 0 0', fontSize: '14px', lineHeight: 1.7, color: 'var(--rd-color-text-secondary)', maxWidth: '62ch' }}>
          {emptyDescription}
        </p>
      </div>
    );
  }

  return (
    <div
      {...props}
      style={{
        display: 'grid',
        gap: '14px',
        ...style,
      }}
    >
      {edgeKindOrder.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
          {edgeKindOrder.map((kind) => {
            const appearance = edgeKinds?.[kind] || DEFAULT_EDGE_KIND;
            const enabled = !hiddenKinds.has(kind);
            return (
              <label
                key={kind}
                style={{
                  ...relationshipGraphText(600),
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '10px',
                  borderRadius: '999px',
                  border: enabled ? '1px solid var(--rd-color-hairline-strong)' : '1px solid var(--rd-color-hairline)',
                  backgroundColor: enabled ? 'var(--rd-color-panel)' : 'var(--rd-color-panel-muted)',
                  padding: '10px 14px',
                  fontSize: '12px',
                  color: enabled ? 'var(--rd-color-text-primary)' : 'var(--rd-color-text-secondary)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={() => toggleKind(kind)}
                  style={{ width: '14px', height: '14px', accentColor: 'var(--rd-color-accent)' }}
                />
                <span
                  aria-hidden="true"
                  style={{
                    width: '24px',
                    height: '2px',
                    backgroundColor: appearance.dashed ? 'transparent' : appearance.color || DEFAULT_EDGE_KIND.color,
                    borderTop: appearance.dashed ? `2px dashed ${appearance.color || DEFAULT_EDGE_KIND.color}` : undefined,
                    opacity: enabled ? 1 : 0.55,
                  }}
                />
                <span>{readableKind(kind, appearance.label)}</span>
                <span style={{ color: 'var(--rd-color-text-muted)' }}>{edgeCounts.get(kind) || 0}</span>
              </label>
            );
          })}
        </div>
      )}

      <div
        style={{
          overflow: 'hidden',
          borderRadius: '24px',
          border: '1px solid var(--rd-color-hairline)',
          background:
            'radial-gradient(circle at top left, rgba(233, 220, 204, 0.72), transparent 38%), linear-gradient(180deg, rgba(255,252,247,0.96) 0%, rgba(245,238,227,0.98) 100%)',
        }}
      >
        <svg
          role="img"
          aria-label="Relationship graph"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          style={{ display: 'block', width: '100%', height: `${layout.height}px` }}
        >
          <defs>
            <filter id="rd-relationship-graph-label-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="1" stdDeviation="1.4" floodColor="rgba(255,252,247,0.96)" />
            </filter>
          </defs>

          {layout.links.map((link, index) => {
            const source = link.source as SimNode;
            const target = link.target as SimNode;
            if (!source?.x || !source?.y || !target?.x || !target?.y) return null;

            const deltaX = target.x - source.x;
            const deltaY = target.y - source.y;
            const midX = (source.x + target.x) / 2;
            const midY = (source.y + target.y) / 2;
            const controlX = midX - deltaY * 0.12;
            const controlY = midY + deltaX * 0.12;
            const isActive = activeNodeId
              ? source.id === activeNodeId || target.id === activeNodeId
              : false;
            const appearance = edgeKinds?.[link.kind] || DEFAULT_EDGE_KIND;
            const baseWeight = link.weight || 0.55;

            return (
              <path
                key={`${source.id}-${target.id}-${link.kind}-${index}`}
                d={`M ${source.x} ${source.y} Q ${controlX} ${controlY} ${target.x} ${target.y}`}
                fill="none"
                stroke={appearance.color || DEFAULT_EDGE_KIND.color}
                strokeDasharray={appearance.dashed ? '6 5' : undefined}
                strokeLinecap="round"
                strokeWidth={isActive ? 2.6 + baseWeight * 1.5 : 1 + baseWeight * 1.2}
                strokeOpacity={activeNodeId ? (isActive ? 0.8 : 0.08) : 0.24}
              />
            );
          })}

          {layout.nodes.map((node) => {
            if (!node.x || !node.y) return null;

            const degree = node.connectionCount || degreeMap.get(node.id) || 0;
            const radius = 9 + Math.min(degree * 0.9, 10);
            const isHighlighted = node.id === highlightedNodeId;
            const isSelected = node.id === selectedNodeId;
            const isActive = node.id === activeNodeId;
            const isNeighbor = activeNodeId ? activeNeighbors.has(node.id) : false;
            const isVisibleInFocus = !activeNodeId || isActive || isNeighbor || isHighlighted;
            const palette = nodeKinds?.[node.kind] || DEFAULT_NODE_KIND;
            const showLabel = visibleLabelIds.has(node.id);
            const label = truncateLabel(node.label, isActive || isSelected ? 36 : 28);
            const labelWidth = label.length * 6.9 + 18;
            const labelX = clamp((node.x || 0) - labelWidth / 2, 18, layout.width - labelWidth - 18);
            const labelY = clamp((node.y || 0) - radius - 28, 16, layout.height - 30);

            return (
              <g
                key={node.id}
                onClick={() => handleNodeClick(node)}
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() => setHoveredNodeId((current) => (current === node.id ? null : current))}
                style={{ cursor: node.href || onNodeSelect ? 'pointer' : 'default' }}
              >
                {(isSelected || isHighlighted) && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={radius + 16}
                    fill={isSelected ? 'rgba(200, 123, 20, 0.14)' : 'rgba(155, 111, 55, 0.08)'}
                  />
                )}

                <circle
                  cx={node.x}
                  cy={node.y}
                  r={radius}
                  fill={palette.fill || DEFAULT_NODE_KIND.fill}
                  stroke={isSelected || isHighlighted ? 'var(--rd-color-accent)' : palette.stroke || DEFAULT_NODE_KIND.stroke}
                  strokeWidth={isSelected ? 3.2 : isHighlighted ? 2.6 : 1.8}
                  opacity={isVisibleInFocus ? 1 : 0.22}
                />

                {showLabel && (
                  <g filter="url(#rd-relationship-graph-label-shadow)" opacity={isVisibleInFocus ? 1 : 0.45}>
                    <rect
                      x={labelX}
                      y={labelY}
                      rx={10}
                      ry={10}
                      width={labelWidth}
                      height={22}
                      fill="rgba(255,252,247,0.92)"
                      stroke={isActive ? 'rgba(200, 123, 20, 0.35)' : 'rgba(215, 202, 184, 0.72)'}
                    />
                    <text
                      x={labelX + labelWidth / 2}
                      y={labelY + 14.5}
                      textAnchor="middle"
                      fontFamily="var(--rd-font-body)"
                      fontSize="11"
                      fontWeight={isActive || isSelected ? 700 : 600}
                      fill={palette.text || DEFAULT_NODE_KIND.text}
                    >
                      {label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '12px',
          borderRadius: '18px',
          border: '1px solid var(--rd-color-hairline)',
          backgroundColor: 'var(--rd-color-panel)',
          padding: '14px 16px',
        }}
      >
        <div style={{ minWidth: 0, flex: '1 1 320px' }}>
          {inspectorNode ? (
            <>
              <p style={{ ...relationshipGraphText(700), margin: 0, fontSize: '11px', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--rd-color-accent)' }}>
                Focused node
              </p>
              <h4 style={{ margin: '8px 0 0 0', fontFamily: 'var(--rd-font-display)', fontSize: '22px', lineHeight: 1.05 }}>
                {inspectorNode.label}
              </h4>
              <p style={{ ...relationshipGraphText(500), margin: '8px 0 0 0', fontSize: '13px', lineHeight: 1.6, color: 'var(--rd-color-text-secondary)' }}>
                {readableKind(inspectorNode.kind)} · {degreeMap.get(inspectorNode.id) || 0} visible connections
                {inspectorNode.detail ? ` · ${inspectorNode.detail}` : ''}
              </p>
            </>
          ) : (
            <>
              <p style={{ ...relationshipGraphText(700), margin: 0, fontSize: '11px', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--rd-color-accent)' }}>
                Graph guidance
              </p>
              <p style={{ ...relationshipGraphText(500), margin: '8px 0 0 0', fontSize: '13px', lineHeight: 1.7, color: 'var(--rd-color-text-secondary)', maxWidth: '64ch' }}>
                {helperText}
              </p>
            </>
          )}
        </div>

        {inspectorNode?.href && onNodeOpen ? (
          <button
            type="button"
            onClick={() => onNodeOpen(inspectorNode)}
            style={{
              ...relationshipGraphText(600),
              borderRadius: '14px',
              border: '1px solid var(--rd-color-hairline)',
              backgroundColor: 'var(--rd-color-panel-muted)',
              color: 'var(--rd-color-text-primary)',
              padding: '10px 14px',
              cursor: 'pointer',
              alignSelf: 'center',
            }}
          >
            Open linked record
          </button>
        ) : null}
      </div>
    </div>
  );
}
