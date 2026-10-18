"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Focus,
  Link2,
  Maximize2,
  MousePointer2,
  Search,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Badge, Data, Empty, IconButton, JsonView, list, readable } from "./ui";

const PALETTE: Record<string, string> = {
  Source: "#91aaa1",
  SourceRevision: "#b6c5bf",
  Rule: "#c29a6b",
  Definition: "#aea0bb",
  Handoff: "#e17a61",
  Obligation: "#ca674d",
  Promise: "#dcae8d",
  Department: "#779c98",
  Person: "#96aab3",
  Case: "#d07666",
  Counterexample: "#dc785f",
  VerificationRun: "#bfb273",
  Decision: "#618d83",
  Task: "#a1ab84",
  Memory: "#9b94b0",
  Agent: "#829aaa",
  AgentRun: "#b3c1c9",
  EventType: "#a0aebd",
  Producer: "#a4b9a6",
  Workspace: "#d27b60",
  Launch: "#caa98e",
  Interpretation: "#c5b48e",
  Command: "#ccd2d0",
  AuditEvent: "#c8d0cc",
  Message: "#b9b7c5",
  Session: "#bac7cc",
  ToolCall: "#b9a9bb",
};

function normalizeNode(node: Data) {
  const p = node.properties || node.data || {};
  const type =
    node.type ||
    node.kind ||
    node.labels?.find((x: string) => x !== "Entity") ||
    p.type ||
    "Entity";
  return {
    ...p,
    ...node,
    id: String(node.id || p.id),
    type,
    label: String(
      node.label ||
        p.title ||
        p.name ||
        p.term ||
        node.title ||
        node.name ||
        p.text?.slice(0, 40) ||
        node.id,
    ),
    properties: p,
  };
}

function groupFor(type: string) {
  if (["Source", "SourceRevision", "Interpretation"].includes(type)) return 0;
  if (["Definition", "Rule", "EventType", "Producer", "Promise"].includes(type))
    return 1;
  if (["Handoff", "Obligation", "Workspace", "Launch"].includes(type)) return 2;
  if (
    [
      "Department",
      "Person",
      "Case",
      "Counterexample",
      "Decision",
      "Task",
    ].includes(type)
  )
    return 3;
  return 4;
}

export function GraphExplorer({
  data,
  scenarios,
  scenarioId,
  onScenario,
  onInspectScenario,
}: {
  data: Data;
  scenarios: Data[];
  scenarioId: string;
  onScenario: (id: string) => void;
  onInspectScenario: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [visibleTypes, setVisibleTypes] = useState<string[]>([]);
  const [sourceMatches, setSourceMatches] = useState<string[]>([]);
  const [sourceSearch, setSourceSearch] = useState("idle");
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(
    null,
  );
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const canvas = svg.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setTransform((t) => ({
        ...t,
        k: Math.min(
          2.4,
          Math.max(0.45, t.k + (event.deltaY > 0 ? -0.08 : 0.08)),
        ),
      }));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [data.nodes]);
  const rawNodes = useMemo(
    () => list(data.nodes).map(normalizeNode),
    [data.nodes],
  );
  const edges = useMemo(
    () =>
      list(data.edges, ["relationships"]).map((e, i) => ({
        ...e,
        id: String(e.id || `edge-${i}`),
        source: String(e.source?.id || e.source || e.from),
        target: String(e.target?.id || e.target || e.to),
        label: e.label || e.type || e.relationship || "RELATED_TO",
      })),
    [data.edges],
  );
  const nodes = useMemo(() => {
    if (!scenarioId) return rawNodes;
    const participating = new Set(
      edges.flatMap((edge) => [edge.source, edge.target]),
    );
    return rawNodes.filter((node) => participating.has(node.id));
  }, [rawNodes, edges, scenarioId]);
  useEffect(() => {
    setSourceMatches([]);
    if (search.trim().length < 2) {
      setSourceSearch("idle");
      return;
    }
    const controller = new AbortController();
    setSourceSearch("searching");
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          q: search.trim(),
          ...(scenarioId ? { scenarioId } : {}),
        });
        const response = await fetch(`/api/graph?${params}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const envelope = await response.json();
        if (!response.ok || envelope.ok === false)
          throw new Error("Source search unavailable");
        setSourceMatches(envelope.data?.matches || []);
        setSourceSearch("ready");
      } catch (error: any) {
        if (error.name !== "AbortError") setSourceSearch("unavailable");
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, scenarioId]);
  const types = useMemo(
    () => [...new Set(nodes.map((n) => n.type))].sort(),
    [nodes],
  );
  const filtered = useMemo(
    () =>
      nodes.filter(
        (n) => !visibleTypes.length || visibleTypes.includes(n.type),
      ),
    [nodes, visibleTypes],
  );
  const positions = useMemo(() => {
    const groups = Array.from({ length: 5 }, (_, i) =>
      filtered.filter((n) => groupFor(n.type) === i),
    );
    const map: Record<string, { x: number; y: number }> = {};
    groups.forEach((group, column) =>
      group.forEach((n, index) => {
        const spacing = Math.min(83, 560 / Math.max(group.length, 1));
        const offset = index % 2 ? 13 : -13;
        map[n.id] = {
          x: 90 + column * 205 + offset,
          y: 345 - ((group.length - 1) * spacing) / 2 + index * spacing,
        };
      }),
    );
    return map;
  }, [filtered]);
  const focus = useMemo(() => {
    const set = new Set<string>();
    const links = new Set<string>();
    const allowed = new Set([
      "HAS_OBLIGATION",
      "USES_DEFINITION",
      "COMPARES",
      "EXPECTS",
      "IMPLEMENTED_BY",
      "SOURCED_FROM",
      "READS_EVENT",
      "EMITTED_BY",
      "OWNED_BY",
      "VIOLATES",
      "CHECKED",
      "USED_SOURCE",
      "USED_RULE",
      "GOVERNED_BY",
    ]);
    if (selected) {
      set.add(selected);
      edges.forEach((e) => {
        if (e.source === selected || e.target === selected) {
          set.add(e.source);
          set.add(e.target);
          links.add(e.id);
        }
      });
      let frontier = [...set];
      for (let depth = 0; depth < 6 && frontier.length; depth++) {
        const next: string[] = [];
        for (const edge of edges) {
          if (!frontier.includes(edge.source) || !allowed.has(edge.label))
            continue;
          links.add(edge.id);
          if (!set.has(edge.target)) {
            set.add(edge.target);
            next.push(edge.target);
          }
        }
        frontier = next;
      }
    }
    return { nodes: set, edges: links };
  }, [selected, edges]);
  const chosen = nodes.find((n) => n.id === selected);
  const relationList = edges.filter(
    (e) => e.source === selected || e.target === selected,
  );
  const searchIds = useMemo(
    () =>
      new Set(
        nodes
          .filter(
            (n) =>
              `${n.label} ${n.type} ${n.id}`
                .toLowerCase()
                .includes(search.toLowerCase()) || sourceMatches.includes(n.id),
          )
          .map((n) => n.id),
      ),
    [search, nodes, sourceMatches],
  );
  const zoom = (amount: number) =>
    setTransform((t) => ({
      ...t,
      k: Math.min(2.4, Math.max(0.45, t.k + amount)),
    }));
  const reset = () => setTransform({ x: 0, y: 0, k: 1 });

  if (!nodes.length)
    return (
      <Empty title="No graph entities to explore">
        Select a populated workspace to inspect its sources, decisions, and
        relationships.
      </Empty>
    );
  return (
    <div className="graph-layout">
      <section className="graph-panel">
        <div className="graph-toolbar">
          <div className="input-with-icon graph-search">
            <Search size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a node, source, or owner…"
              aria-label="Search graph"
            />
            {search && (
              <button onClick={() => setSearch("")} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </div>
          <select
            value={scenarioId}
            onChange={(e) => {
              onScenario(e.target.value);
              setSelected(null);
              reset();
            }}
            aria-label="Filter graph by handoff"
          >
            <option value="">Entire workspace</option>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </div>
        <div className="graph-type-filters">
          <button
            className={!visibleTypes.length ? "active" : ""}
            onClick={() => setVisibleTypes([])}
          >
            All entities
          </button>
          {types.map((type) => (
            <button
              key={type}
              className={visibleTypes.includes(type) ? "active" : ""}
              onClick={() =>
                setVisibleTypes((v) =>
                  v.includes(type) ? v.filter((t) => t !== type) : [...v, type],
                )
              }
            >
              <i style={{ background: PALETTE[type] || "#aab6b0" }} />
              {type}
            </button>
          ))}
        </div>
        <div className="graph-canvas">
          <svg
            ref={svg}
            viewBox="0 0 1000 690"
            aria-label="Interactive workspace knowledge graph"
            role="group"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              drag.current = {
                x: e.clientX,
                y: e.clientY,
                tx: transform.x,
                ty: transform.y,
              };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              const scale =
                1000 / (svg.current?.getBoundingClientRect().width || 1000);
              setTransform((t) => ({
                ...t,
                x: drag.current!.tx + (e.clientX - drag.current!.x) * scale,
                y: drag.current!.ty + (e.clientY - drag.current!.y) * scale,
              }));
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
          >
            <defs>
              <pattern
                id="graph-dots"
                x="0"
                y="0"
                width="20"
                height="20"
                patternUnits="userSpaceOnUse"
              >
                <circle cx="1" cy="1" r=".7" fill="#d4dbd5" />
              </pattern>
              <marker
                id="graph-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="4"
                markerHeight="4"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#aebbb3" />
              </marker>
            </defs>
            <rect width="1000" height="690" fill="url(#graph-dots)" />
            <g
              transform={`translate(${transform.x} ${transform.y}) translate(500 345) scale(${transform.k}) translate(-500 -345)`}
            >
              <g className="graph-column-labels">
                {[
                  "SOURCE EVIDENCE",
                  "REVIEWED MEANING",
                  "SHARED HANDOFF",
                  "PEOPLE & ACTIONS",
                  "PERSISTENT MEMORY",
                ].map((label, i) => (
                  <text key={label} x={90 + i * 205} y="32" textAnchor="middle">
                    {label}
                  </text>
                ))}
              </g>
              {edges.map((edge) => {
                const a = positions[edge.source],
                  b = positions[edge.target];
                if (!a || !b) return null;
                const active = selected && focus.edges.has(edge.id);
                const dx = b.x - a.x,
                  dy = b.y - a.y,
                  distance = Math.sqrt(dx * dx + dy * dy) || 1;
                const end = {
                  x: b.x - (dx / distance) * 18,
                  y: b.y - (dy / distance) * 18,
                };
                const midX = (a.x + b.x) / 2;
                const path =
                  Math.abs(dx) > 50
                    ? `M${a.x},${a.y} C${midX},${a.y} ${midX},${end.y} ${end.x},${end.y}`
                    : `M${a.x},${a.y} Q${a.x + 58},${(a.y + b.y) / 2} ${end.x},${end.y}`;
                return (
                  <g
                    key={edge.id}
                    opacity={selected ? (active ? 1 : 0.13) : 0.62}
                  >
                    <path
                      d={path}
                      fill="none"
                      stroke={active ? "#c9694f" : "#aebbb3"}
                      strokeWidth={active ? 1.8 : 1}
                      markerEnd="url(#graph-arrow)"
                    />
                    {active &&
                      (edge.source === selected ||
                        edge.target === selected ||
                        transform.k > 1.35) && (
                        <text
                          x={midX}
                          y={(a.y + b.y) / 2 - 5}
                          className="graph-edge-label"
                          textAnchor="middle"
                        >
                          {edge.label}
                        </text>
                      )}
                  </g>
                );
              })}
              {filtered.map((node) => {
                const p = positions[node.id];
                const focused = selected === node.id;
                const opacity =
                  (search && !searchIds.has(node.id)) ||
                  (selected && !focus.nodes.has(node.id))
                    ? 0.2
                    : 1;
                return (
                  <g
                    key={node.id}
                    transform={`translate(${p.x},${p.y})`}
                    opacity={opacity}
                    className={`graph-node ${focused ? "selected" : ""}`}
                    tabIndex={0}
                    role="button"
                    aria-label={`${node.type}: ${node.label}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => setSelected(focused ? null : node.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected(node.id);
                      }
                    }}
                  >
                    {focused && (
                      <circle
                        r="26"
                        fill="none"
                        stroke="#d4755a"
                        strokeWidth="1"
                        strokeDasharray="3 3"
                      />
                    )}
                    <circle
                      r={node.type === "Handoff" ? 20 : 15}
                      fill={PALETTE[node.type] || "#aab6b0"}
                      stroke="#fbfcf8"
                      strokeWidth="3"
                    />
                    <circle r="3" fill="#ffffff" opacity=".85" />
                    <text
                      y={node.type === "Handoff" ? 37 : 31}
                      textAnchor="middle"
                      className="graph-node-label"
                    >
                      {node.label.length > 26
                        ? `${node.label.slice(0, 24)}…`
                        : node.label}
                    </text>
                    <title>
                      {node.type}: {node.label}
                    </title>
                  </g>
                );
              })}
            </g>
          </svg>
          <div className="graph-canvas-footer">
            <span>
              <MousePointer2 size={13} />
              Drag to pan · scroll to zoom
            </span>
            <div>
              <IconButton label="Zoom out" onClick={() => zoom(-0.2)}>
                <ZoomOut size={17} />
              </IconButton>
              <span>{Math.round(transform.k * 100)}%</span>
              <IconButton label="Zoom in" onClick={() => zoom(0.2)}>
                <ZoomIn size={17} />
              </IconButton>
              <IconButton label="Reset graph view" onClick={reset}>
                <Maximize2 size={16} />
              </IconButton>
            </div>
          </div>
          {search && (
            <div className="graph-search-count">
              {searchIds.size} matching{" "}
              {searchIds.size === 1 ? "entity" : "entities"}
              {sourceSearch === "searching"
                ? " · searching source text…"
                : sourceSearch === "ready"
                  ? " · FalkorDB full-text + labels"
                  : sourceSearch === "unavailable"
                    ? " · source search unavailable"
                    : ""}
            </div>
          )}
        </div>
        <div className="graph-caption">
          <span>
            <i />
            {filtered.length} entities
          </span>
          <span>
            {
              edges.filter((e) => positions[e.source] && positions[e.target])
                .length
            }{" "}
            relationships
          </span>
          <span>Live FalkorDB query</span>
        </div>
      </section>
      <aside className="graph-inspector">
        {chosen ? (
          <>
            <div className="inspector-title">
              <Badge>{chosen.type}</Badge>
              <IconButton
                label="Clear selection"
                onClick={() => setSelected(null)}
              >
                <X size={16} />
              </IconButton>
            </div>
            <h3>{chosen.label}</h3>
            <code className="entity-id">{chosen.id}</code>
            {(chosen.text ||
              chosen.description ||
              chosen.statement ||
              chosen.body ||
              chosen.meaning) && (
              <p className="inspector-description">
                {chosen.text ||
                  chosen.description ||
                  chosen.statement ||
                  chosen.body ||
                  chosen.meaning}
              </p>
            )}
            {chosen.scenarioId && (
              <button
                className="text-button"
                onClick={() => onInspectScenario(chosen.scenarioId)}
              >
                Open handoff <ArrowRight size={14} />
              </button>
            )}
            <div className="inspector-section">
              <div className="eyebrow">
                Connected entities · {relationList.length}
              </div>
              {relationList.map((edge, i) => {
                const outward = edge.source === chosen.id;
                const target = nodes.find(
                  (n) => n.id === (outward ? edge.target : edge.source),
                );
                return (
                  <button
                    className="graph-relation"
                    key={edge.id || i}
                    onClick={() => setSelected(target?.id || null)}
                  >
                    <Link2 size={14} />
                    <div>
                      <span>
                        {String(edge.label).replaceAll("_", " ").toLowerCase()}
                      </span>
                      <strong>
                        {target?.label || (outward ? edge.target : edge.source)}
                      </strong>
                    </div>
                    <ArrowRight size={13} />
                  </button>
                );
              })}
            </div>
            <JsonView
              value={
                chosen.properties && Object.keys(chosen.properties).length
                  ? chosen.properties
                  : chosen
              }
              title="Stored properties"
            />
          </>
        ) : (
          <>
            <span className="inspector-placeholder-icon">
              <Focus size={29} strokeWidth={1.2} />
            </span>
            <div className="eyebrow">The evidence is connected</div>
            <h3>Follow a relationship.</h3>
            <p>
              Select any entity to see its source, scope, and connections. Every
              line here represents a stored relationship in FalkorDB.
            </p>
            <div className="graph-guide">
              <div>
                <i style={{ background: PALETTE.Source }} />
                <span>Sources establish evidence</span>
              </div>
              <div>
                <i style={{ background: PALETTE.Rule }} />
                <span>Rules express behavior</span>
              </div>
              <div>
                <i style={{ background: PALETTE.Handoff }} />
                <span>Handoffs carry obligations</span>
              </div>
              <div>
                <i style={{ background: PALETTE.Case }} />
                <span>Cases coordinate people</span>
              </div>
              <div>
                <i style={{ background: PALETTE.Memory }} />
                <span>Memory persists decisions</span>
              </div>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
