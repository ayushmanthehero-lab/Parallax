"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  ArrowUpRight,
  BookOpen,
  Bot,
  BrainCircuit,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  Code2,
  Database,
  FileText,
  GitPullRequest,
  Layers,
  LayoutDashboard,
  Link2,
  Loader2,
  LockKeyhole,
  Menu,
  MessageSquare,
  Network,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  SquareCheckBig,
  Terminal,
  Users,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Data,
  DepartmentChips,
  Empty,
  ErrorBox,
  External,
  IconButton,
  JsonView,
  Loading,
  Logo,
  Modal,
  Notice,
  PageHeading,
  SectionHeading,
  SourceType,
  Status,
  Timeline,
  initials,
  list,
  readable,
  time,
} from "./ui";
import { GraphExplorer } from "./graph-explorer";

type View =
  | "overview"
  | "handoffs"
  | "cases"
  | "graph"
  | "sources"
  | "memory"
  | "agents"
  | "tasks"
  | "audit"
  | "architecture";
type Resource = {
  data: any;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

async function api(path: string, body?: Data, signal?: AbortSignal) {
  const response = await fetch(`/api/${path}`, {
    method: body ? "POST" : "GET",
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
    signal,
    cache: "no-store",
  });
  let envelope: any;
  try {
    envelope = await response.json();
  } catch {
    throw new Error(
      `The server returned an unreadable response (${response.status}). Please retry.`,
    );
  }
  if (!response.ok || envelope.ok === false)
    throw new Error(
      envelope.error?.message || `Request failed (${response.status})`,
    );
  return envelope.data;
}

function useResource(
  path: string | null,
  refresh: number,
  scope = 0,
): Resource {
  const [record, setRecord] = useState<{
    path: string;
    scope: number;
    data: any;
  } | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api(path, undefined, controller.signal)
      .then((data) => setRecord({ path, scope, data }))
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, refresh, tick, scope]);
  const current = record?.path === path && record?.scope === scope;
  return {
    data: current ? record.data : null,
    loading: loading || (!!path && !current && !error),
    error,
    reload: useCallback(() => setTick((t) => t + 1), []),
  };
}

const SCENARIO_ORDER = [
  "trial",
  "beta",
  "threshold",
  "bundle",
  "equivalent",
  "unknown",
];
function orderedScenarios(value: any) {
  return [...list(value)].sort(
    (a, b) => SCENARIO_ORDER.indexOf(a.id) - SCENARIO_ORDER.indexOf(b.id),
  );
}

function ResourceContent({
  resource,
  children,
}: {
  resource: Resource;
  children: (data: any) => React.ReactNode;
}) {
  if (resource.loading && !resource.data) return <Loading />;
  if (resource.error)
    return <ErrorBox message={resource.error} onRetry={resource.reload} />;
  return (
    <>
      {resource.loading && (
        <div className="refresh-indicator">
          <Loader2 size={12} className="spin" /> Refreshing graph state
        </div>
      )}
      {children(resource.data)}
    </>
  );
}

const NAV: { id: View; label: string; icon: any; group: number }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, group: 0 },
  { id: "handoffs", label: "Handoffs", icon: ArrowRightLeft, group: 0 },
  { id: "cases", label: "Clarification cases", icon: GitPullRequest, group: 0 },
  { id: "tasks", label: "Human tasks", icon: SquareCheckBig, group: 0 },
  { id: "graph", label: "Knowledge graph", icon: Network, group: 1 },
  { id: "sources", label: "Sources & intake", icon: FileText, group: 1 },
  { id: "memory", label: "Shared memory", icon: BrainCircuit, group: 1 },
  { id: "agents", label: "Agent activity", icon: Bot, group: 1 },
  { id: "audit", label: "Verification & audit", icon: ShieldCheck, group: 2 },
  {
    id: "architecture",
    label: "Architecture & settings",
    icon: Settings2,
    group: 2,
  },
];

const VERDICT_COPY: Record<string, { title: string; description: string }> = {
  VIOLATED: {
    title: "Same agreement. Different outcome.",
    description:
      "A concrete, admissible input breaks this shared obligation. The affected owners can now decide what should change.",
  },
  VALID_WITHIN_BOUND: {
    title: "The promise holds within these bounds.",
    description:
      "Every admissible input in the disclosed finite domain was checked. This result applies to the current reviewed versions and domain.",
  },
  NOT_DISPROVED: {
    title: "The search needs more room.",
    description:
      "No counterexample was found before the evaluation budget ended. This is an incomplete search, so validity has not been established.",
  },
  UNKNOWN: {
    title: "More evidence is needed.",
    description:
      "This handoff cannot be verified until the required meaning and producer evidence have been reviewed.",
  },
};

export default function Workspace() {
  const [view, setView] = useState<View>("overview");
  const [refresh, setRefresh] = useState(0);
  const [scope, setScope] = useState(0);
  const [selectedScenario, setSelectedScenario] = useState("trial");
  const [selectedCase, setSelectedCase] = useState<string | null>(null);
  const [graphScenario, setGraphScenario] = useState("trial");
  const [navOpen, setNavOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    error?: boolean;
  } | null>(null);
  const [investigation, setInvestigation] = useState<Data | null>(null);
  const [taskModal, setTaskModal] = useState<Data | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const boot = useResource("bootstrap", refresh, scope);
  // Bootstrap establishes the signed session before dependent requests fan out.
  const sessionReady = !!boot.data;
  const scenario = useResource(
    sessionReady && view === "handoffs"
      ? `scenarios/${selectedScenario}`
      : null,
    refresh,
    scope,
  );
  const cases = useResource(
    sessionReady && ["overview", "cases", "tasks"].includes(view)
      ? "cases"
      : null,
    refresh,
    scope,
  );
  const caseDetail = useResource(
    sessionReady && view === "cases" && selectedCase
      ? `cases/${selectedCase}`
      : null,
    refresh,
    scope,
  );
  const graph = useResource(
    sessionReady && view === "graph"
      ? `graph${graphScenario ? `?scenarioId=${graphScenario}` : ""}`
      : null,
    refresh,
    scope,
  );
  const sources = useResource(
    sessionReady && view === "sources" ? "sources" : null,
    refresh,
    scope,
  );
  const memories = useResource(
    sessionReady && view === "memory" ? "memory" : null,
    refresh,
    scope,
  );
  const runs = useResource(
    sessionReady && view === "agents" ? "runs" : null,
    refresh,
    scope,
  );
  const tasks = useResource(
    sessionReady && ["tasks", "overview"].includes(view) ? "tasks" : null,
    refresh,
    scope,
  );
  const audit = useResource(
    sessionReady && view === "audit" ? "audit" : null,
    refresh,
    scope,
  );
  const verification = useResource(
    sessionReady && view === "audit" ? "verification" : null,
    refresh,
    scope,
  );
  const chat = useResource(
    sessionReady && chatOpen ? "chat" : null,
    refresh,
    scope,
  );
  const scenarios = orderedScenarios(boot.data?.scenarios);
  const departments = list(boot.data?.departments);
  const counts = boot.data?.counts || {};
  const workspace = boot.data?.workspace || {};
  const connection = boot.data?.connection || {};
  const tenant = workspace.tenant || "acme";
  const mode = boot.data?.mode || "guided";
  const currentNav = NAV.find((n) => n.id === view)!;

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(
      () => setToast(null),
      toast.error ? 10000 : 5000,
    );
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    function escape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setNavOpen(false);
        setChatOpen(false);
        setTaskModal(null);
        setResetOpen(false);
      }
    }
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);

  const navigate = (next: View) => {
    setView(next);
    setNavOpen(false);
    window.scrollTo({ top: 0, behavior: "auto" });
  };
  const openScenario = (id: string) => {
    setSelectedScenario(id);
    setInvestigation(null);
    navigate("handoffs");
  };
  const openCase = (id: string) => {
    setSelectedCase(id);
    navigate("cases");
  };
  const mutate = async (
    path: string,
    body: Data,
    key: string,
    success?: string,
  ) => {
    if (busy) return null;
    setBusy(key);
    try {
      const result = await api(path, {
        ...body,
        commandId: body.commandId || crypto.randomUUID(),
      });
      setRefresh((r) => r + 1);
      if (success) setToast({ message: success });
      return result;
    } catch (e: any) {
      setToast({ message: e.message, error: true });
      return null;
    } finally {
      setBusy(null);
    }
  };
  const investigate = async (inputs?: Data) => {
    const result = await mutate(
      "investigate",
      { scenarioId: selectedScenario, ...(inputs ? { inputs } : {}) },
      "investigate",
    );
    if (result) {
      setInvestigation(result);
      setToast({ message: "Investigation and evidence saved to your graph." });
    }
  };
  const changeTenant = async (next: string) => {
    if (next === tenant) return;
    const result = await mutate(
      "workspace",
      { tenant: next },
      "workspace",
      "Workspace changed. Its graph and memory are isolated.",
    );
    if (result) {
      setScope((s) => s + 1);
      setSelectedCase(null);
      setInvestigation(null);
      setSelectedScenario("trial");
      navigate("overview");
    }
  };

  return (
    <div className={`application ${chatOpen ? "chat-is-open" : ""}`}>
      {navOpen && (
        <div className="navigation-scrim" onClick={() => setNavOpen(false)} />
      )}
      <aside className={`sidebar ${navOpen ? "is-open" : ""}`}>
        <div className="sidebar-brand">
          <Logo />
          <IconButton
            label="Close navigation"
            onClick={() => setNavOpen(false)}
          >
            <X size={18} />
          </IconButton>
        </div>
        <div className="workspace-card">
          <div className="workspace-avatar">
            {initials(workspace.name || "Acme")}
          </div>
          <div>
            <strong>{workspace.name || "Your workspace"}</strong>
            <span>Launch coordination</span>
          </div>
          <ChevronDown size={13} />
        </div>
        <nav aria-label="Main navigation">
          {[0, 1, 2].map((group) => (
            <div className="nav-group" key={group}>
              <div className="nav-group-label">
                {["WORKSPACE", "CONNECTED INTELLIGENCE", "SYSTEM"][group]}
              </div>
              {NAV.filter((n) => n.group === group).map((item) => (
                <button
                  key={item.id}
                  className={`nav-item ${view === item.id ? "active" : ""}`}
                  onClick={() => {
                    if (item.id === "cases") setSelectedCase(null);
                    navigate(item.id);
                  }}
                >
                  <item.icon size={17} strokeWidth={1.65} />
                  <span>{item.label}</span>
                  {item.id === "cases" && counts.openCases > 0 && (
                    <span className="nav-count">{counts.openCases}</span>
                  )}
                  {item.id === "tasks" && counts.pendingTasks > 0 && (
                    <span className="nav-count muted">
                      {counts.pendingTasks}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="graph-health">
            <span
              className={`health-dot ${connection.status === "connected" || connection.status === "healthy" ? "online" : ""}`}
            />
            <div>
              <strong>Powered by FalkorDB</strong>
              <span>
                {connection.status === "connected" ||
                connection.status === "healthy"
                  ? "Your evidence, connected"
                  : boot.loading
                    ? "Connecting to your graph…"
                    : "Connection status in settings"}
              </span>
            </div>
            <Database size={17} />
          </div>
          <div className="profile-card">
            <div className="profile-avatar">Y</div>
            <div>
              <strong>Your private demo</strong>
              <span>Synthetic company data</span>
            </div>
            <LockKeyhole size={14} />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <IconButton
              label="Open navigation"
              onClick={() => setNavOpen(true)}
            >
              <Menu size={20} />
            </IconButton>
            <span className="breadcrumb-company">Workspace</span>
            <ChevronRight size={12} />
            <span>{currentNav.label}</span>
          </div>
          <div className="topbar-actions">
            <span className="demo-label">
              <span />
              Synthetic demo
            </span>
            <div className="tenant-selector">
              <Building2 size={14} />
              <select
                value={tenant}
                onChange={(e) => changeTenant(e.target.value)}
                disabled={!!busy}
                aria-label="Select company workspace"
              >
                <option value="acme">Acme</option>
                <option value="nova">Nova</option>
              </select>
              <ChevronDown size={12} />
            </div>
            <IconButton
              label="Refresh graph state"
              onClick={() => setRefresh((r) => r + 1)}
            >
              <RefreshCw size={16} className={boot.loading ? "spin" : ""} />
            </IconButton>
            <button
              className={`chat-toggle ${chatOpen ? "active" : ""}`}
              onClick={() => setChatOpen((o) => !o)}
            >
              <Sparkles size={16} />
              <span>Ask Parallax</span>
            </button>
          </div>
        </header>
        <main className={`main-content view-${view}`}>
          {boot.error ? (
            <>
              <PageHeading
                eyebrow="WORKSPACE CONNECTION"
                title="Let’s connect the evidence."
                description="PARALLAX needs a reachable FalkorDB graph to read sources, investigate handoffs, and remember decisions."
              />
              <ErrorBox message={boot.error} onRetry={boot.reload} />
              <div className="connection-help">
                <Database size={32} />
                <h2>The interface is ready for your graph.</h2>
                <p>
                  Check the configured FalkorDB endpoint and server environment.
                  Once connected, this workspace will load its actual entities
                  and relationships.
                </p>
                <Button
                  variant="secondary"
                  onClick={() => navigate("architecture")}
                >
                  View architecture <ArrowRight size={14} />
                </Button>
              </div>
              {view === "architecture" && (
                <Architecture
                  connection={connection}
                  mode={mode}
                  tenant={tenant}
                  onTenant={changeTenant}
                  onReset={() => setResetOpen(true)}
                  busy={busy}
                />
              )}
            </>
          ) : boot.loading && !boot.data ? (
            <div className="workspace-loading">
              <Logo />
              <Loading label="Connecting sources, meaning, and people…" />
            </div>
          ) : (
            <>
              {view === "overview" && (
                <Overview
                  data={boot.data || {}}
                  cases={list(cases.data, ["cases"])}
                  tasks={list(tasks.data, ["tasks"])}
                  onScenario={openScenario}
                  onCase={openCase}
                  onNavigate={navigate}
                />
              )}
              {view === "handoffs" && (
                <>
                  <PageHeading
                    eyebrow="HANDOFF INTELLIGENCE"
                    title="Find the gap in the agreement."
                    description="Follow the shared promise from source to behavior. Then test what happens at the handoff."
                    actions={
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setGraphScenario(selectedScenario);
                          navigate("graph");
                        }}
                        icon={<Network size={15} />}
                      >
                        Explore evidence graph
                      </Button>
                    }
                  />
                  <div
                    className="scenario-tabs"
                    role="tablist"
                    aria-label="Handoff scenarios"
                  >
                    {scenarios.map((s, i) => (
                      <button
                        role="tab"
                        aria-selected={s.id === selectedScenario}
                        key={s.id}
                        className={s.id === selectedScenario ? "active" : ""}
                        onClick={() => {
                          setSelectedScenario(s.id);
                          setInvestigation(null);
                        }}
                      >
                        <span>0{i + 1}</span>
                        {s.term || s.category || s.title}
                      </button>
                    ))}
                  </div>
                  <ResourceContent resource={scenario}>
                    {(data) =>
                      data && (
                        <Investigation
                          scenario={data.scenario || data}
                          investigation={investigation}
                          departments={departments}
                          busy={busy}
                          onInvestigate={investigate}
                          onCase={openCase}
                          onGraph={() => {
                            setGraphScenario(selectedScenario);
                            navigate("graph");
                          }}
                        />
                      )
                    }
                  </ResourceContent>
                </>
              )}
              {view === "cases" && (
                <>
                  <PageHeading
                    eyebrow="HUMAN CLARIFICATION"
                    title={
                      selectedCase
                        ? "A decision with a clear trail."
                        : "Turn ambiguity into ownership."
                    }
                    description={
                      selectedCase
                        ? "Keep the meaning, implementation, and verification as separate steps."
                        : "Counterexamples become precise decisions for the people who own the promise."
                    }
                    actions={
                      selectedCase ? (
                        <Button
                          variant="secondary"
                          onClick={() => setSelectedCase(null)}
                          icon={<ArrowLeft size={14} />}
                        >
                          All cases
                        </Button>
                      ) : (
                        <Button
                          onClick={() => openScenario("trial")}
                          icon={<ScanLine size={15} />}
                        >
                          Investigate a handoff
                        </Button>
                      )
                    }
                  />
                  {selectedCase ? (
                    <ResourceContent resource={caseDetail}>
                      {(data) =>
                        data && (
                          <CaseDetail
                            data={data}
                            busy={busy}
                            onMutate={mutate}
                            onTask={setTaskModal}
                            onScenario={openScenario}
                          />
                        )
                      }
                    </ResourceContent>
                  ) : (
                    <ResourceContent resource={cases}>
                      {(data) => (
                        <CasesList
                          items={list(data, ["cases"])}
                          departments={departments}
                          onCase={openCase}
                          onStart={() => openScenario("trial")}
                        />
                      )}
                    </ResourceContent>
                  )}
                </>
              )}
              {view === "graph" && (
                <>
                  <PageHeading
                    eyebrow="FALKORDB KNOWLEDGE GRAPH"
                    title="See how the evidence connects."
                    description="Sources, definitions, obligations, owners, and memory — inspect the relationships behind every action."
                    actions={
                      <Badge tone="teal" dot>
                        Live graph data
                      </Badge>
                    }
                  />
                  <ResourceContent resource={graph}>
                    {(data) =>
                      data && (
                        <GraphExplorer
                          data={data}
                          scenarios={scenarios}
                          scenarioId={graphScenario}
                          onScenario={setGraphScenario}
                          onInspectScenario={openScenario}
                        />
                      )
                    }
                  </ResourceContent>
                </>
              )}
              {view === "sources" && (
                <>
                  <PageHeading
                    eyebrow="SOURCE OF TRUTH"
                    title="Give every interpretation a source."
                    description="Capture exact evidence, preserve its revisions, and review meaning before it changes a rule."
                  />
                  <ResourceContent resource={sources}>
                    {(data) => (
                      <Sources
                        data={data}
                        scenarios={scenarios}
                        departments={departments}
                        busy={busy}
                        onMutate={mutate}
                      />
                    )}
                  </ResourceContent>
                </>
              )}
              {view === "memory" && (
                <>
                  <PageHeading
                    eyebrow="PERSISTENT AGENT MEMORY"
                    title="Remember what the team learned."
                    description="Shared experience, approved meaning, and reusable procedures — scoped to this workspace."
                    actions={
                      <Badge tone="neutral">
                        <LockKeyhole size={12} />{" "}
                        {workspace.name || "Current tenant"} only
                      </Badge>
                    }
                  />
                  <ResourceContent resource={memories}>
                    {(data) => (
                      <Memory
                        items={list(data, ["memories", "memory"])}
                        onScenario={openScenario}
                      />
                    )}
                  </ResourceContent>
                </>
              )}
              {view === "agents" && (
                <>
                  <PageHeading
                    eyebrow="EXPLAINABLE COORDINATION"
                    title="Every tool call leaves a trail."
                    description="Inspect what the agents read, which graph tools they chose, and why they acted."
                    actions={
                      <Badge tone={mode === "model" ? "teal" : "amber"} dot>
                        {mode === "model"
                          ? "Model selected tools"
                          : "Guided MCP execution"}
                      </Badge>
                    }
                  />
                  <ResourceContent resource={runs}>
                    {(data) => (
                      <Agents
                        runs={list(data, ["runs"])}
                        agents={list(boot.data?.agents)}
                        mode={mode}
                        onScenario={openScenario}
                      />
                    )}
                  </ResourceContent>
                </>
              )}
              {view === "tasks" && (
                <>
                  <PageHeading
                    eyebrow="HUMAN FOLLOW-THROUGH"
                    title="A decision is just the beginning."
                    description="Owners complete the work, attach evidence, and return the case for verification."
                    actions={
                      <Badge tone="amber">
                        {counts.pendingTasks ?? 0} pending
                      </Badge>
                    }
                  />
                  <ResourceContent resource={tasks}>
                    {(data) => (
                      <Tasks
                        items={list(data, ["tasks"])}
                        departments={departments}
                        onTask={setTaskModal}
                        onCase={openCase}
                      />
                    )}
                  </ResourceContent>
                </>
              )}
              {view === "audit" && (
                <>
                  <PageHeading
                    eyebrow="TRUST & VERIFICATION"
                    title="Make the result inspectable."
                    description="Review persisted events and run measured checks against isolated verification fixtures."
                  />
                  <Audit
                    audit={audit}
                    verification={verification}
                    busy={busy}
                    onRun={() =>
                      mutate(
                        "verification",
                        {},
                        "verification",
                        "Verification report refreshed with measured results.",
                      )
                    }
                  />
                </>
              )}
              {view === "architecture" && (
                <>
                  <PageHeading
                    eyebrow="UNDER THE SURFACE"
                    title="Connected data. Accountable action."
                    description="The architecture, database resources, and boundaries behind PARALLAX."
                  />
                  <Architecture
                    connection={connection}
                    mode={mode}
                    tenant={tenant}
                    onTenant={changeTenant}
                    onReset={() => setResetOpen(true)}
                    busy={busy}
                  />
                </>
              )}
            </>
          )}
          <footer className="main-footer">
            <span>
              PARALLAX <span>·</span> Shared words deserve shared meaning.
            </span>
            <span>
              <Database size={12} /> FalkorDB × Graph Hacks
            </span>
          </footer>
        </main>
      </div>
      {chatOpen && (
        <Chat
          resource={chat}
          busy={busy}
          scenarioId={selectedScenario}
          mode={mode}
          onClose={() => setChatOpen(false)}
          onSend={async (message) =>
            !!(await mutate(
              "chat",
              { message, scenarioId: selectedScenario },
              "chat",
            ))
          }
        />
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? "toast-error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <CircleDot size={17} /> : <CheckCircle2 size={17} />}
          <span>{toast.message}</span>
          <IconButton
            label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={15} />
          </IconButton>
        </div>
      )}
      {taskModal && (
        <TaskModal
          task={taskModal}
          busy={busy}
          onClose={() => setTaskModal(null)}
          onComplete={async (evidence) => {
            const result = await mutate(
              `tasks/${taskModal.id}/complete`,
              { evidence, expectedRevision: taskModal.revision ?? 1 },
              `task-${taskModal.id}`,
              "Completion evidence saved. The case is ready when all its tasks are done.",
            );
            if (result) setTaskModal(null);
          }}
        />
      )}
      {resetOpen && (
        <Modal
          title="Start a fresh private workspace?"
          eyebrow="RESET DEMO"
          onClose={() => setResetOpen(false)}
        >
          <p className="modal-description">
            This resets the current company’s synthetic sources and removes the
            investigations, decisions, tasks, and memories in this private demo.
            The other company’s graph is separate.
          </p>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setResetOpen(false)}>
              Keep workspace
            </Button>
            <Button
              busy={busy === "reset"}
              onClick={async () => {
                const result = await mutate(
                  "workspace",
                  { tenant, reset: true },
                  "reset",
                  "A fresh workspace is ready.",
                );
                if (result) {
                  setScope((s) => s + 1);
                  setResetOpen(false);
                  setSelectedCase(null);
                  setInvestigation(null);
                  navigate("overview");
                }
              }}
            >
              Reset current demo
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Overview({
  data,
  cases,
  tasks,
  onScenario,
  onCase,
  onNavigate,
}: {
  data: Data;
  cases: Data[];
  tasks: Data[];
  onScenario: (id: string) => void;
  onCase: (id: string) => void;
  onNavigate: (view: View) => void;
}) {
  const scenarios = orderedScenarios(data.scenarios),
    counts = data.counts || {},
    departments = list(data.departments);
  const open = cases.filter((c) => c.status !== "resolved");
  const pending = tasks.filter(
    (t) => !["complete", "completed"].includes(t.state || t.status),
  );
  const first = scenarios.find((s) => s.id === "trial") || scenarios[0];
  return (
    <>
      <PageHeading
        eyebrow="YOUR COORDINATION WORKSPACE"
        title="Agreement needs evidence."
        description="Find where shared words create different outcomes — before your customers do."
        actions={
          <div className="live-caption">
            <span />
            {data.connection?.engine || "FalkorDB"} connected
          </div>
        }
      />
      <div className="overview-hero-grid">
        <section className="hero-card">
          <div className="hero-topline">
            <Badge tone="white">CONNECTED DATA → ACCOUNTABLE ACTION</Badge>
            <span className="hero-index">01 / 06</span>
          </div>
          <h2>
            Everyone agreed.
            <br />
            <span>
              Did they mean
              <br />
              the same thing?
            </span>
          </h2>
          <p>
            {first?.summary ||
              "Trace a customer promise across teams, test the shared obligation, and put a concrete decision in the right hands."}
          </p>
          <Button
            variant="dark"
            onClick={() => first && onScenario(first.id)}
            disabled={!first}
          >
            Investigate the trial handoff <ArrowUpRight size={16} />
          </Button>
          <div className="hero-bottom">
            <div className="avatar-stack">
              {departments.slice(0, 4).map((d, i) => (
                <span
                  key={d.id}
                  style={{
                    background: ["#73988c", "#b08368", "#8b839f", "#ac9c6b"][i],
                  }}
                >
                  {initials(d.name)}
                </span>
              ))}
            </div>
            <span>One promise. Multiple perspectives.</span>
          </div>
        </section>
        <section className="promise-preview">
          <div className="card-kicker">
            <span className="eyebrow">THE HANDOFF IN FOCUS</span>
            <span className="tiny-label">SOURCE → RULE → OUTCOME</span>
          </div>
          <div className="promise-statement">
            <span className="quote-mark">“</span>
            <h3>{first?.promise || "Your trial starts when you start."}</h3>
            <span>{first?.title || "The seven-day trial gap"}</span>
          </div>
          <div className="agreement-map">
            <div className="agreement-line" />
            <div className="agreement-node">
              <span className="mini-node-icon teal">
                <FileText size={17} />
              </span>
              <div>
                <span>PRODUCT PROMISE</span>
                <strong>
                  {list(first?.rules).find((r) => r.departmentId === "product")
                    ?.statement || "Reviewed customer promise"}
                </strong>
              </div>
            </div>
            <div className="handoff-joint">
              <ArrowDown size={15} />
              <span>Shared obligation</span>
              <ArrowDown size={15} />
            </div>
            <div className="agreement-node">
              <span className="mini-node-icon coral">
                <Code2 size={17} />
              </span>
              <div>
                <span>IMPLEMENTED BEHAVIOR</span>
                <strong>
                  {list(first?.rules).find((r) => r.departmentId === "billing")
                    ?.statement || "Reviewed implementation rule"}
                </strong>
              </div>
            </div>
          </div>
          <div className="promise-preview-footer">
            <Link2 size={14} />
            <span>Compare behavior at the handoff.</span>
            <button
              onClick={() => first && onScenario(first.id)}
              aria-label="Open trial handoff"
            >
              <ArrowUpRight size={17} />
            </button>
          </div>
        </section>
      </div>
      <div className="metric-grid">
        <Metric
          icon={<ArrowRightLeft size={18} />}
          label="Connected handoffs"
          value={scenarios.length}
          note="Shared obligation scenarios"
        />
        <Metric
          icon={<GitPullRequest size={18} />}
          label="Open clarification cases"
          value={counts.openCases ?? open.length}
          note="Grounded in a counterexample"
          coral
        />
        <Metric
          icon={<SquareCheckBig size={18} />}
          label="Human tasks pending"
          value={counts.pendingTasks ?? pending.length}
          note="Owners turn decisions into work"
        />
        <Metric
          icon={<BrainCircuit size={18} />}
          label="Persistent memories"
          value={counts.memories ?? 0}
          note="Experience available to every agent"
        />
      </div>
      <div className="overview-bottom">
        <section className="panel handoff-table-panel">
          <SectionHeading
            title="Across the handoffs"
            count={scenarios.length}
            action={
              <button
                className="text-button"
                onClick={() => onNavigate("handoffs")}
              >
                Explore all <ArrowRight size={14} />
              </button>
            }
          />
          <div className="handoff-table">
            <div className="handoff-table-header">
              <span>HANDOFF & SHARED TERM</span>
              <span>OWNERS</span>
              <span>REVIEW</span>
              <span />
            </div>
            {scenarios.slice(0, 5).map((s, i) => (
              <button
                className="handoff-table-row"
                key={s.id}
                onClick={() => onScenario(s.id)}
              >
                <div className="handoff-table-main">
                  <span className={`scenario-glyph glyph-${i % 4}`}>
                    <ArrowRightLeft size={16} />
                  </span>
                  <div>
                    <strong>{s.title}</strong>
                    <span>{s.term || s.category}</span>
                  </div>
                </div>
                <div className="table-owner">
                  {list(s.owners)
                    .slice(0, 2)
                    .map((o, j) => (
                      <span
                        className="small-avatar"
                        key={o.id || j}
                        title={o.name}
                      >
                        {initials(o.name)}
                      </span>
                    ))}
                </div>
                <Badge
                  tone={s.expectedVerdict === "UNKNOWN" ? "amber" : "neutral"}
                >
                  {s.expectedVerdict === "UNKNOWN"
                    ? "Evidence needed"
                    : "Ready to check"}
                </Badge>
                <ArrowUpRight size={15} />
              </button>
            ))}
          </div>
        </section>
        <section className="panel next-action-panel">
          <SectionHeading title="The next human step" />
          <div className="action-illustration">
            <span />
            <span />
            <SquareCheckBig size={28} strokeWidth={1.3} />
          </div>
          {pending.length ? (
            <>
              <Badge tone="amber">{pending.length} tasks waiting</Badge>
              <h3>{pending[0].title}</h3>
              <p>
                {pending[0].description ||
                  "Attach implementation evidence so the case can return for verification."}
              </p>
              <Button variant="secondary" onClick={() => onNavigate("tasks")}>
                Go to human tasks <ArrowRight size={14} />
              </Button>
            </>
          ) : open.length ? (
            <>
              <Badge tone="coral">Clarification needed</Badge>
              <h3>{open[0].title}</h3>
              <p>
                A verified counterexample is waiting for a scoped human
                decision.
              </p>
              <Button variant="secondary" onClick={() => onCase(open[0].id)}>
                Review the case <ArrowRight size={14} />
              </Button>
            </>
          ) : (
            <>
              <Badge tone="teal">A clean starting point</Badge>
              <h3>Find the first gap.</h3>
              <p>
                Run an investigation. Confirmed mismatches will arrive here with
                evidence and the people who can resolve them.
              </p>
              <Button
                variant="secondary"
                onClick={() => first && onScenario(first.id)}
              >
                Start investigating <ArrowRight size={14} />
              </Button>
            </>
          )}
        </section>
      </div>
      <div className="principle-strip">
        <span>
          <Network size={17} />
          Follow the evidence
        </span>
        <ChevronRight size={13} />
        <span>
          <ScanLine size={17} />
          Find a counterexample
        </span>
        <ChevronRight size={13} />
        <span>
          <Users size={17} />
          Clarify with people
        </span>
        <ChevronRight size={13} />
        <span>
          <BrainCircuit size={17} />
          Remember the decision
        </span>
      </div>
    </>
  );
}

function Metric({
  icon,
  label,
  value,
  note,
  coral = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: any;
  note: string;
  coral?: boolean;
}) {
  return (
    <div className={`metric-card ${coral ? "metric-coral" : ""}`}>
      <div>
        <span>{label}</span>
        {icon}
      </div>
      <strong>{value ?? "—"}</strong>
      <p>{note}</p>
    </div>
  );
}

function Investigation({
  scenario,
  investigation,
  departments,
  busy,
  onInvestigate,
  onCase,
  onGraph,
}: {
  scenario: Data;
  investigation: Data | null;
  departments: Data[];
  busy: string | null;
  onInvestigate: (inputs?: Data) => void;
  onCase: (id: string) => void;
  onGraph: () => void;
}) {
  const [custom, setCustom] = useState(false);
  const [inputs, setInputs] = useState<Data>({});
  const [tab, setTab] = useState("evidence");
  useEffect(() => {
    setInputs(
      Object.fromEntries(
        list(scenario.inputs).map((i) => [
          i.key,
          i.defaultValue ?? i.values?.[0] ?? "",
        ]),
      ),
    );
    setCustom(false);
    setTab("evidence");
  }, [scenario.id]);
  useEffect(() => {
    if (investigation?.verification)
      document
        .getElementById("verification-result")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [investigation]);
  const latest = investigation || scenario.latestInvestigation;
  const currentRuns = list(scenario.runs)
    .filter((run) => run.scenarioRevision === scenario.revision)
    .sort((a, b) =>
      String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
    );
  const persisted = currentRuns[0];
  const candidate = latest?.verification || latest?.result;
  const result =
    candidate &&
    (candidate.scenarioRevision == null ||
      candidate.scenarioRevision === scenario.revision)
      ? candidate
      : scenario.latestVerification || (persisted?.result ?? persisted);
  const linkedCase =
    latest?.case ||
    scenario.case ||
    list(scenario.cases).find((c) => c.status !== "resolved");
  const activeDepartments = departments.filter((d) =>
    (scenario.departmentIds || []).includes(d.id),
  );
  const rules = list(scenario.rules),
    sources = list(scenario.sources),
    toolCalls = list(latest?.tools || latest?.run?.tools, ["calls"]);
  return (
    <div className="investigation-layout">
      <div className="investigation-main">
        <section className="panel investigation-intro">
          <div className="card-kicker">
            <Badge tone="neutral">
              {scenario.category || "Shared obligation"}
            </Badge>
            <span className="tiny-label">
              REVISION {scenario.revision || 1}
            </span>
          </div>
          <h2>{scenario.title}</h2>
          <p>{scenario.summary || scenario.subtitle}</p>
          <DepartmentChips departments={activeDepartments} />
          <div className="obligation-box">
            <div className="eyebrow">
              <Link2 size={13} />
              THE SHARED OBLIGATION
            </div>
            <p>{readable(scenario.obligation?.text || scenario.obligation)}</p>
            <span>Scope: {readable(scenario.scope)}</span>
          </div>
        </section>
        <div className="content-tabs" role="tablist">
          {[
            ["evidence", "Source evidence"],
            ["rules", "Reviewed rules"],
            ["history", "Previous runs"],
          ].map(([id, label]) => (
            <button
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "active" : ""}
              key={id}
              onClick={() => setTab(id)}
            >
              {label}
              {id === "evidence" && <span>{sources.length}</span>}
            </button>
          ))}
        </div>
        {tab === "evidence" && (
          <div className="evidence-grid">
            {sources.map((source, i) => (
              <SourceCard
                source={source}
                department={departments.find(
                  (d) => d.id === source.departmentId,
                )}
                key={source.id || i}
              />
            ))}
          </div>
        )}
        {tab === "rules" && (
          <div className="rule-list">
            {rules.map((rule, i) => (
              <section className="panel rule-card" key={rule.id || i}>
                <div className="card-kicker">
                  <span className="eyebrow">
                    {departments.find((d) => d.id === rule.departmentId)
                      ?.name || readable(rule.departmentId)}
                  </span>
                  <Badge tone={rule.reviewed ? "teal" : "amber"}>
                    {rule.reviewed ? "Reviewed" : "Needs review"} · v
                    {rule.revision || 1}
                  </Badge>
                </div>
                <h3>{rule.title || rule.name}</h3>
                <p>{rule.statement}</p>
                <JsonView
                  value={rule.expression}
                  title="Inspect deterministic expression"
                />
                <span className="rule-source">
                  <Link2 size={12} />
                  Source:{" "}
                  {sources.find((s) => s.id === rule.sourceId)?.title ||
                    rule.sourceId}
                </span>
              </section>
            ))}
          </div>
        )}
        {tab === "history" &&
          (list(scenario.runs).length ? (
            <div className="history-runs">
              {list(scenario.runs).map((run, i) => (
                <div className="panel history-run" key={run.id || i}>
                  <div>
                    <strong>{run.title || "Verification run"}</strong>
                    <span>
                      {time(run.createdAt || run.timestamp, true)} · source
                      revision {run.scenarioRevision || 1}
                    </span>
                  </div>
                  {run.scenarioRevision !== scenario.revision && (
                    <Badge tone="amber">Earlier source revision</Badge>
                  )}
                  <Status value={run.verdict || run.result?.verdict} />
                  <JsonView
                    value={run.result || run}
                    title="Inspect recorded evidence"
                  />
                </div>
              ))}
            </div>
          ) : (
            <Empty title="No earlier runs yet" icon={<Clock3 size={26} />}>
              Each investigation preserves its source versions, witness, and
              checker result here.
            </Empty>
          ))}
        {result && (
          <VerificationResult
            result={result}
            scenario={scenario}
            linkedCase={linkedCase}
            onCase={onCase}
          />
        )}
        {toolCalls.length > 0 && (
          <section className="panel tool-evidence">
            <SectionHeading
              title="How the agents reached this result"
              count={toolCalls.length}
              description="Actual MCP receipts from this investigation."
            />
            <ToolCalls calls={toolCalls} />
          </section>
        )}
      </div>
      <aside className="investigation-sidebar">
        <section className="panel run-panel">
          <span className="feature-icon">
            <ScanLine size={23} strokeWidth={1.5} />
          </span>
          <div className="eyebrow">THE COUNTEREXAMPLE CHECK</div>
          <h3>Test the shared promise.</h3>
          <p>
            Evaluate reviewed rules against the same admissible input and
            inspect the outcome.
          </p>
          <label className="switch-row">
            <div>
              <strong>Choose a customer scenario</strong>
              <span>Otherwise search the finite domain</span>
            </div>
            <input
              type="checkbox"
              checked={custom}
              onChange={(e) => setCustom(e.target.checked)}
            />
            <span className="switch-control" />
          </label>
          {custom && (
            <div className="input-fields">
              {list(scenario.inputs).map((input) => (
                <label className="form-field" key={input.key}>
                  <span>
                    {input.label}
                    {input.unit && <small>{input.unit}</small>}
                  </span>
                  <select
                    value={String(inputs[input.key])}
                    onChange={(e) =>
                      setInputs((v) => ({
                        ...v,
                        [input.key]:
                          input.type === "boolean"
                            ? e.target.value === "true"
                            : input.type === "number"
                              ? Number(e.target.value)
                              : e.target.value,
                      }))
                    }
                  >
                    {(input.values || scenario.domain?.[input.key] || []).map(
                      (v: any) => (
                        <option value={String(v)} key={String(v)}>
                          {input.type === "boolean"
                            ? v
                              ? "Yes"
                              : "No"
                            : String(v)}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              ))}
            </div>
          )}
          <Button
            className="full-width"
            busy={busy === "investigate"}
            disabled={!!busy}
            onClick={() => onInvestigate(custom ? inputs : undefined)}
            icon={<Play size={14} fill="currentColor" />}
          >
            {busy === "investigate"
              ? "Investigating the graph…"
              : result
                ? "Run investigation again"
                : "Run investigation"}
          </Button>
          <div className="run-footnote">
            <ShieldCheck size={13} />
            <span>Finite domain · reviewed semantics · explainable result</span>
          </div>
          {busy === "investigate" && (
            <Notice tone="amber">
              The agents are reading memory and traversing the evidence graph.
              Completed tool calls will appear with the saved result.
            </Notice>
          )}
        </section>
        <section className="panel owner-panel">
          <SectionHeading title="People in the loop" />
          {list(scenario.owners).map((owner, i) => (
            <div className="owner-row" key={owner.id || i}>
              <span className={`owner-avatar avatar-${i % 4}`}>
                {initials(owner.name)}
              </span>
              <div>
                <strong>{owner.name}</strong>
                <span>
                  {owner.role ||
                    departments.find((d) => d.id === owner.departmentId)?.name}
                </span>
              </div>
            </div>
          ))}
          <p className="owner-note">
            PARALLAX coordinates. The owners make and implement the decision.
          </p>
        </section>
        <button className="graph-shortcut" onClick={onGraph}>
          <span className="graph-shortcut-pattern">
            <Network size={29} strokeWidth={1.2} />
          </span>
          <div>
            <strong>Trace the evidence path</strong>
            <span>Open the connected graph</span>
          </div>
          <ArrowUpRight size={17} />
        </button>
      </aside>
    </div>
  );
}

function SourceCard({
  source,
  department,
}: {
  source: Data;
  department?: Data;
}) {
  const text =
    source.text ||
    source.revision?.text ||
    source.latestRevision?.text ||
    source.content ||
    "No source text recorded.";
  return (
    <article className="source-card">
      <div className="source-card-top">
        <span className="source-card-icon">
          <FileText size={18} strokeWidth={1.6} />
        </span>
        <div>
          <span className="eyebrow">
            {department?.name ||
              readable(source.departmentId || "Source evidence")}
          </span>
          <h3>{source.title}</h3>
        </div>
        <span className="source-version">
          v{source.version || source.revision?.version || 1}
        </span>
      </div>
      <blockquote>{text}</blockquote>
      {list(source.revisions).length > 1 && (
        <JsonView
          value={source.revisions}
          title={`${source.revisions.length} preserved source revisions`}
        />
      )}
      <div className="source-card-bottom">
        <SourceType type={source.type} />
        <span>
          <span
            className={`review-dot ${source.reviewed === false ? "unreviewed" : ""}`}
          />
          {source.reviewed === false ? "Review needed" : "Reviewed source"}
        </span>
      </div>
    </article>
  );
}

function VerificationResult({
  result,
  scenario,
  linkedCase,
  onCase,
}: {
  result: Data;
  scenario: Data;
  linkedCase?: Data;
  onCase: (id: string) => void;
}) {
  const verdict = result.verdict || "UNKNOWN",
    copy = VERDICT_COPY[verdict] || VERDICT_COPY.UNKNOWN;
  const witness = result.witness,
    outputs = witness?.outputs || result.outputs;
  return (
    <section
      className={`verification-result result-${verdict.toLowerCase()}`}
      id="verification-result"
    >
      <div className="result-heading">
        <span className="result-symbol">
          {verdict === "VIOLATED" ? (
            <ArrowRightLeft size={22} />
          ) : verdict === "VALID_WITHIN_BOUND" ? (
            <CheckCircle2 size={22} />
          ) : (
            <CircleDot size={22} />
          )}
        </span>
        <div>
          <span className="eyebrow">VERIFIED RESULT</span>
          <h2>{copy.title}</h2>
        </div>
        <Status value={verdict} />
      </div>
      <p className="result-explanation">
        {result.explanation || copy.description}
      </p>
      {witness && (
        <>
          <div className="witness-label">THE CONCRETE COUNTEREXAMPLE</div>
          <div className="witness-inputs">
            {Object.entries(witness.inputs || {}).map(([key, value]) => {
              const input = list(scenario.inputs).find((i) => i.key === key);
              return (
                <div key={key}>
                  <span>{input?.label || readable(key)}</span>
                  <strong>
                    {typeof value === "boolean"
                      ? value
                        ? "Yes"
                        : "No"
                      : String(value)}
                    {input?.unit && <small>{input.unit}</small>}
                  </strong>
                </div>
              );
            })}
          </div>
          {outputs && (
            <div className="witness-outputs">
              {Object.entries(outputs).map(([key, value], i) => (
                <div key={key}>
                  <span>
                    {list(scenario.rules).find((r) => r.name === key)?.title ||
                      readable(key)}
                  </span>
                  <strong>
                    {typeof value === "boolean"
                      ? value
                        ? "True"
                        : "False"
                      : String(value)}
                  </strong>
                  {i < Object.keys(outputs).length - 1 && (
                    <span className="output-vs">≠</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <div className="result-scope">
        <span>
          <ScanLine size={14} />
          {result.evaluatedCount ?? 0} evaluations
        </span>
        <span>Domain: {result.domainSize ?? "—"} combinations</span>
        <span>
          {result.complete
            ? "Declared search completed"
            : verdict === "VIOLATED"
              ? "Stopped at concrete witness"
              : "Search incomplete"}
        </span>
        <span>{result.checkerVersion || "Versioned checker"}</span>
      </div>
      <JsonView
        value={{
          bounds: result.bounds,
          versions: result.versions,
          trace: result.trace,
        }}
        title="Inspect bounds, source versions, and evaluation trace"
      />
      {linkedCase?.id && (
        <div className="result-next">
          <div>
            <strong>The evidence is ready for a human decision.</strong>
            <span>
              A clarification case connects the witness to its owners.
            </span>
          </div>
          <Button onClick={() => onCase(linkedCase.id)}>
            Review clarification <ArrowRight size={14} />
          </Button>
        </div>
      )}
    </section>
  );
}

function CasesList({
  items,
  departments,
  onCase,
  onStart,
}: {
  items: Data[];
  departments: Data[];
  onCase: (id: string) => void;
  onStart: () => void;
}) {
  const [filter, setFilter] = useState("all"),
    [search, setSearch] = useState("");
  const filtered = items.filter(
    (c) =>
      (filter === "all" ||
        (filter === "resolved"
          ? c.status === "resolved"
          : c.status !== "resolved")) &&
      `${c.title} ${c.scenarioId}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="list-toolbar">
        <div className="segmented-control">
          {[
            ["all", "All cases"],
            ["open", "Open"],
            ["resolved", "Resolved"],
          ].map(([id, label]) => (
            <button
              className={filter === id ? "active" : ""}
              key={id}
              onClick={() => setFilter(id)}
            >
              {label}
              <span>
                {id === "all"
                  ? items.length
                  : items.filter((c) =>
                      id === "resolved"
                        ? c.status === "resolved"
                        : c.status !== "resolved",
                    ).length}
              </span>
            </button>
          ))}
        </div>
        <div className="input-with-icon">
          <Search size={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search cases…"
            aria-label="Search clarification cases"
          />
        </div>
      </div>
      {filtered.length ? (
        <div className="case-grid">
          {filtered.map((c) => (
            <button
              className="case-card"
              key={c.id}
              onClick={() => onCase(c.id)}
            >
              <div className="card-kicker">
                <span className="tiny-label">
                  {String(c.id).slice(-10).toUpperCase()}
                </span>
                <Status value={c.status} />
              </div>
              <span className="case-icon">
                <GitPullRequest size={23} strokeWidth={1.5} />
              </span>
              <h3>{c.title || "Clarify the shared obligation"}</h3>
              <p>
                {c.summary ||
                  c.description ||
                  c.explanation ||
                  "A verified mismatch needs a scoped decision and follow-through from its owners."}
              </p>
              <DepartmentChips
                departments={departments.filter((d) =>
                  (c.departmentIds || []).includes(d.id),
                )}
              />
              <div className="case-card-footer">
                <span>
                  {time(c.createdAt || c.timestamp, true)} · revision{" "}
                  {c.revision || 1}
                </span>
                <ArrowUpRight size={17} />
              </div>
            </button>
          ))}
        </div>
      ) : (
        <Empty
          title={
            items.length
              ? "No cases match this view"
              : "The first good question starts with evidence."
          }
          icon={<GitPullRequest size={29} strokeWidth={1.4} />}
          action={
            !items.length && (
              <Button onClick={onStart} icon={<ScanLine size={15} />}>
                Investigate a handoff
              </Button>
            )
          }
        >
          {items.length
            ? "Try another filter or a different search."
            : "Run an investigation to open a clarification case with a concrete counterexample, affected owners, and the original sources."}
        </Empty>
      )}
    </>
  );
}

const CASE_STAGES = [
  { id: "open", label: "Evidence found" },
  { id: "decision_proposed", label: "Human decision" },
  { id: "implementation_pending", label: "Implementation" },
  { id: "verification_pending", label: "Fresh verification" },
  { id: "resolved", label: "Resolved" },
];

function CaseDetail({
  data,
  busy,
  onMutate,
  onTask,
  onScenario,
}: {
  data: Data;
  busy: string | null;
  onMutate: (
    path: string,
    body: Data,
    key: string,
    success?: string,
  ) => Promise<any>;
  onTask: (task: Data) => void;
  onScenario: (id: string) => void;
}) {
  const c = data.case || data,
    scenario = data.scenario || {},
    tasks = list(data.tasks || c.tasks),
    decisions = list(data.decisions || c.decisions),
    choices = list(data.choices || scenario.resolution?.choices);
  const [choice, setChoice] = useState(""),
    [note, setNote] = useState("");
  useEffect(() => {
    setChoice(choices[0]?.id || "");
    setNote("");
  }, [c.id]);
  const actualChoice = choice || choices[0]?.id || "";
  const canDecide =
    ["open", "decision_proposed"].includes(c.status) && !data.stale;
  const stage =
    c.status === "decision_approved"
      ? 2
      : Math.max(
          0,
          CASE_STAGES.findIndex((s) => s.id === c.status),
        );
  const latestDecision = decisions.at(-1);
  const verification = data.verification || c.verification;
  return (
    <>
      <section className="case-detail-header">
        <div>
          <div className="card-kicker">
            <Badge tone="neutral">
              CASE {String(c.id).slice(-8).toUpperCase()}
            </Badge>
            <Status value={c.status} />
            {data.stale && <Badge tone="amber">Source revisions changed</Badge>}
          </div>
          <h2>
            {c.title || scenario.title || "Clarify the shared obligation"}
          </h2>
          <p>{c.description || c.summary || scenario.summary}</p>
        </div>
        <button
          className="text-button"
          onClick={() => onScenario(c.scenarioId || scenario.id)}
        >
          View source handoff <ArrowUpRight size={14} />
        </button>
      </section>
      <div className="case-stages">
        {CASE_STAGES.map((step, i) => (
          <div
            className={`${i < stage ? "done" : i === stage ? "current" : ""}`}
            key={step.id}
          >
            <span>
              {i < stage ? <Check size={14} /> : String(i + 1).padStart(2, "0")}
            </span>
            <strong>{step.label}</strong>
            {i < CASE_STAGES.length - 1 && <div className="stage-line" />}
          </div>
        ))}
      </div>
      {data.stale && (
        <Notice
          tone="amber"
          title="This case references an earlier source revision."
        >
          Review the current handoff and run a new investigation before
          approving a decision. Previous evidence stays in the graph.
        </Notice>
      )}
      <div className="case-detail-grid">
        <div>
          {verification && (
            <VerificationResult
              result={verification.result || verification}
              scenario={scenario}
              onCase={() => {}}
            />
          )}
          <section className="panel decision-panel">
            <SectionHeading
              title={
                canDecide
                  ? "What should the handoff mean?"
                  : "The recorded decision"
              }
              description={
                canDecide
                  ? "Choose a scoped meaning. Approval records the decision and opens human follow-up work."
                  : "The decision is preserved with the scope and source versions that support it."
              }
            />
            {canDecide ? (
              <>
                <div className="decision-choices">
                  {choices.map((item) => (
                    <label
                      className={`decision-choice ${actualChoice === item.id ? "selected" : ""}`}
                      key={item.id}
                    >
                      <input
                        type="radio"
                        name="case-choice"
                        value={item.id}
                        checked={actualChoice === item.id}
                        onChange={() => setChoice(item.id)}
                      />
                      <span className="radio-control" />
                      <div>
                        <strong>{item.label}</strong>
                        <p>{item.description}</p>
                        {list(item.taskTemplates).length > 0 && (
                          <span className="decision-task-count">
                            <SquareCheckBig size={12} />{" "}
                            {item.taskTemplates.length} follow-up tasks
                          </span>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
                {!choices.length && (
                  <Notice tone="amber">
                    No reviewed resolution choices are available for this case.
                    Inspect the source handoff before continuing.
                  </Notice>
                )}
                <label className="form-field decision-note">
                  <span>
                    Decision rationale{" "}
                    <small>Required for the audit trail</small>
                  </span>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Why does this meaning honor the shared promise? Record the scope and anything the owners should know."
                    rows={4}
                    maxLength={3000}
                  />
                </label>
                <div className="decision-submit">
                  <span>
                    <LockKeyhole size={13} />
                    Saved as a human decision in this demo
                  </span>
                  <Button
                    busy={busy === `decision-${c.id}`}
                    disabled={!!busy || !actualChoice || note.trim().length < 5}
                    onClick={() =>
                      onMutate(
                        `cases/${c.id}/decision`,
                        {
                          choice: actualChoice,
                          note: note.trim(),
                          expectedRevision: c.revision ?? 1,
                        },
                        `decision-${c.id}`,
                        "Decision approved. Human implementation tasks have been created.",
                      )
                    }
                  >
                    Approve clarification <ArrowRight size={14} />
                  </Button>
                </div>
              </>
            ) : latestDecision ? (
              <>
                <div className="approved-decision">
                  <span className="approved-icon">
                    <CheckCircle2 size={22} />
                  </span>
                  <div>
                    <Badge tone="teal">Approved meaning</Badge>
                    <h3>
                      {latestDecision.label ||
                        latestDecision.title ||
                        choices.find(
                          (ch) =>
                            ch.id ===
                            (latestDecision.choice ||
                              latestDecision.selectedMeaning),
                        )?.label ||
                        readable(
                          latestDecision.selectedMeaning ||
                            latestDecision.choice,
                        )}
                    </h3>
                    <p>
                      {latestDecision.note ||
                        latestDecision.rationale ||
                        latestDecision.description}
                    </p>
                    <span>
                      {time(latestDecision.createdAt, true)} ·{" "}
                      {latestDecision.approvedBy || "Human reviewer"}
                    </span>
                  </div>
                </div>
                <JsonView
                  value={latestDecision}
                  title="Decision scope and version record"
                />
              </>
            ) : (
              <Notice>
                This case is {readable(c.status)}. Its current state and related
                events are preserved in the graph.
              </Notice>
            )}
          </section>
          {tasks.length > 0 && (
            <section className="panel case-task-panel">
              <SectionHeading
                title="Implementation belongs to the owners"
                count={tasks.length}
                description="Each completion requires evidence. Approval alone does not complete this work."
              />
              {tasks.map((task) => (
                <div className="case-task" key={task.id}>
                  <span
                    className={`task-state-icon ${["complete", "completed"].includes(task.state || task.status) ? "complete" : ""}`}
                  >
                    {["complete", "completed"].includes(
                      task.state || task.status,
                    ) ? (
                      <Check size={15} />
                    ) : (
                      <SquareCheckBig size={15} />
                    )}
                  </span>
                  <div>
                    <strong>{task.title}</strong>
                    <span>
                      {task.owner?.name ||
                        task.ownerName ||
                        readable(task.ownerId || task.departmentId)}
                    </span>
                  </div>
                  <Status value={task.state || task.status} />
                  <Button variant="secondary" onClick={() => onTask(task)}>
                    {["complete", "completed"].includes(
                      task.state || task.status,
                    )
                      ? "View evidence"
                      : "Complete task"}
                  </Button>
                </div>
              ))}
            </section>
          )}
          <section className="panel reverify-panel">
            <span className="feature-icon teal">
              <ShieldCheck size={23} />
            </span>
            <div>
              <h3>
                {c.status === "resolved"
                  ? "The loop is closed."
                  : "Verify the implemented meaning."}
              </h3>
              <p>
                {c.status === "resolved"
                  ? "A fresh check confirmed the adopted mapping within its disclosed domain. The original counterexample remains available."
                  : "When all human tasks include evidence, run the checker against the adopted, reviewed mapping."}
              </p>
            </div>
            <Button
              busy={busy === `verify-${c.id}`}
              disabled={!!busy || c.status !== "verification_pending"}
              onClick={() =>
                onMutate(
                  `cases/${c.id}/verify`,
                  { expectedRevision: c.revision ?? 1 },
                  `verify-${c.id}`,
                  "Fresh verification saved. Review the updated case status.",
                )
              }
              icon={<ScanLine size={14} />}
            >
              {c.status === "resolved"
                ? "Verified & resolved"
                : "Verify adopted mapping"}
            </Button>
          </section>
        </div>
        <aside>
          <section className="panel case-context">
            <SectionHeading title="Decision context" />
            <dl>
              <div>
                <dt>Scope</dt>
                <dd>{readable(c.scope || scenario.scope)}</dd>
              </div>
              <div>
                <dt>Application revision</dt>
                <dd>{c.revision || 1}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{time(c.createdAt, true)}</dd>
              </div>
              <div>
                <dt>Tasks completed</dt>
                <dd>
                  {
                    tasks.filter((t) =>
                      ["complete", "completed"].includes(t.state || t.status),
                    ).length
                  }{" "}
                  of {tasks.length}
                </dd>
              </div>
            </dl>
            <Notice tone="teal">
              Decisions, task evidence, and verification survive across sessions
              in this workspace graph.
            </Notice>
          </section>
          <section className="panel case-history">
            <SectionHeading title="Case history" />
            {list(data.history).length ? (
              <Timeline items={list(data.history)} />
            ) : (
              <p className="muted-copy">
                Recorded events will appear as this case moves forward.
              </p>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

function Tasks({
  items,
  departments,
  onTask,
  onCase,
}: {
  items: Data[];
  departments: Data[];
  onTask: (task: Data) => void;
  onCase: (id: string) => void;
}) {
  const [owner, setOwner] = useState("all");
  const filtered = items.filter(
    (t) =>
      owner === "all" ||
      t.departmentId === owner ||
      t.owner?.departmentId === owner,
  );
  if (!items.length)
    return (
      <Empty
        icon={<SquareCheckBig size={28} strokeWidth={1.4} />}
        title="Human work starts with a clear decision."
      >
        Approve a clarification case to create assigned implementation tasks.
        PARALLAX keeps ownership and evidence connected to the original promise.
      </Empty>
    );
  return (
    <>
      <div className="list-toolbar">
        <div className="task-principle">
          <Users size={17} />
          <span>People implement. Agents coordinate and verify.</span>
        </div>
        <select
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          aria-label="Filter tasks by department"
        >
          <option value="all">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <div className="task-board">
        {[
          {
            id: "pending",
            label: "Waiting on people",
            note: "Implementation and review",
            icon: Clock3,
          },
          {
            id: "completed",
            label: "Evidence attached",
            note: "Ready for the case’s next step",
            icon: CheckCircle2,
          },
        ].map((column) => {
          const group = filtered.filter((t) =>
            column.id === "completed"
              ? ["complete", "completed"].includes(t.state || t.status)
              : !["complete", "completed"].includes(t.state || t.status),
          );
          return (
            <section
              className={`task-column column-${column.id}`}
              key={column.id}
            >
              <div className="task-column-heading">
                <column.icon size={17} />
                <div>
                  <h2>
                    {column.label}
                    <span>{group.length}</span>
                  </h2>
                  <p>{column.note}</p>
                </div>
              </div>
              {group.length ? (
                group.map((task) => (
                  <article className="task-card" key={task.id}>
                    <div className="card-kicker">
                      <Badge>
                        {readable(task.kind || task.type || "Implementation")}
                      </Badge>
                      <span className="tiny-label">v{task.revision || 1}</span>
                    </div>
                    <h3>{task.title}</h3>
                    <p>
                      {task.description ||
                        "Complete the assigned change and attach evidence for the coordination record."}
                    </p>
                    <div className="task-owner">
                      <span className="small-avatar">
                        {initials(
                          task.ownerName ||
                            task.owner?.name ||
                            task.ownerId ||
                            "Owner",
                        )}
                      </span>
                      <span>
                        {task.ownerName ||
                          task.owner?.name ||
                          readable(task.ownerId || task.departmentId)}
                      </span>
                    </div>
                    {task.evidence && (
                      <div className="task-evidence-preview">
                        <CheckCircle2 size={14} />
                        <p>{readable(task.evidence)}</p>
                      </div>
                    )}
                    <div className="task-card-actions">
                      {task.caseId && (
                        <button
                          className="text-button"
                          onClick={() => onCase(task.caseId)}
                        >
                          Open case <ArrowUpRight size={13} />
                        </button>
                      )}
                      <Button
                        variant={
                          column.id === "completed" ? "secondary" : "primary"
                        }
                        onClick={() => onTask(task)}
                      >
                        {column.id === "completed"
                          ? "View record"
                          : "Attach evidence"}
                      </Button>
                    </div>
                  </article>
                ))
              ) : (
                <div className="task-column-empty">
                  <column.icon size={23} strokeWidth={1.4} />
                  <p>
                    {column.id === "completed"
                      ? "Completed work will appear here with its evidence."
                      : "No pending tasks in this view."}
                  </p>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

function TaskModal({
  task,
  busy,
  onClose,
  onComplete,
}: {
  task: Data;
  busy: string | null;
  onClose: () => void;
  onComplete: (evidence: string) => void;
}) {
  const [evidence, setEvidence] = useState(
    typeof task.evidence === "string" ? task.evidence : "",
  );
  const complete = ["complete", "completed"].includes(
    task.state || task.status,
  );
  return (
    <Modal
      title={task.title}
      eyebrow="HUMAN IMPLEMENTATION TASK"
      onClose={onClose}
    >
      <div className="task-modal-meta">
        <Status value={task.state || task.status} />
        <span>
          Owner:{" "}
          {task.ownerName ||
            task.owner?.name ||
            readable(task.ownerId || task.departmentId)}
        </span>
      </div>
      <p className="modal-description">
        {task.description ||
          "Record the implementation, review, or test completed by the assigned owner."}
      </p>
      <Notice tone="amber">
        Only mark this complete after the work has been performed. The attached
        evidence becomes part of the persistent case record.
      </Notice>
      <label className="form-field">
        <span>
          Completion evidence <small>Required</small>
        </span>
        <textarea
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          rows={5}
          maxLength={5000}
          placeholder="Describe the completed work. Add a commit, review, test result, or other reference the next owner can inspect."
          readOnly={complete}
        />
      </label>
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose}>
          {complete ? "Close record" : "Cancel"}
        </Button>
        {!complete && (
          <Button
            busy={busy === `task-${task.id}`}
            disabled={!!busy || evidence.trim().length < 10}
            onClick={() => onComplete(evidence.trim())}
            icon={<Check size={15} />}
          >
            Save evidence & complete
          </Button>
        )}
      </div>
    </Modal>
  );
}

function Sources({
  data,
  scenarios,
  departments,
  busy,
  onMutate,
}: {
  data: any;
  scenarios: Data[];
  departments: Data[];
  busy: string | null;
  onMutate: (
    path: string,
    body: Data,
    key: string,
    success?: string,
  ) => Promise<any>;
}) {
  const sourceItems = list(data, ["sources"]);
  const allInterpretations = list(data?.interpretations).length
    ? list(data.interpretations)
    : sourceItems.flatMap((s) => list(s.interpretations || s.proposals));
  const interpretations = allInterpretations.filter((i) => !i.original);
  const [tab, setTab] = useState("sources"),
    [search, setSearch] = useState(""),
    [intakeOpen, setIntakeOpen] = useState(false),
    [text, setText] = useState(""),
    [scenarioId, setScenarioId] = useState("trial"),
    [departmentId, setDepartmentId] = useState("product"),
    [choiceId, setChoiceId] = useState("");
  const targetScenario = scenarios.find((s) => s.id === scenarioId);
  const intakeDepartments = departments.filter((d) =>
    targetScenario?.departmentIds?.includes(d.id),
  );
  useEffect(() => {
    if (!targetScenario?.departmentIds?.includes(departmentId))
      setDepartmentId(targetScenario?.departmentIds?.[0] || "product");
  }, [targetScenario?.id, departmentId]);
  const pending = interpretations.filter(
    (i) => !["accepted", "rejected", "approved"].includes(i.status),
  );
  const filtered = sourceItems.filter((s) =>
    `${s.title} ${s.text} ${s.departmentId}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="list-toolbar">
        <div className="segmented-control">
          <button
            className={tab === "sources" ? "active" : ""}
            onClick={() => setTab("sources")}
          >
            Source library <span>{sourceItems.length}</span>
          </button>
          <button
            className={tab === "review" ? "active" : ""}
            onClick={() => setTab("review")}
          >
            Interpretation review <span>{pending.length}</span>
          </button>
        </div>
        <Button
          onClick={() => setIntakeOpen((o) => !o)}
          icon={intakeOpen ? <X size={15} /> : <Plus size={15} />}
        >
          {intakeOpen ? "Close intake" : "Capture new evidence"}
        </Button>
      </div>
      {intakeOpen && (
        <section className="panel intake-panel">
          <div>
            <Badge tone="coral">NEW SOURCE INTAKE</Badge>
            <h2>Capture what was actually said.</h2>
            <p>
              The original text is preserved. A structured interpretation stays
              proposed until a person reviews it.
            </p>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await onMutate(
                "intake",
                {
                  text: text.trim(),
                  scenarioId,
                  departmentId,
                  ...(choiceId ? { choiceId } : {}),
                },
                "intake",
                "Evidence captured. Its interpretation is waiting for review.",
              );
              if (result) {
                setText("");
                setTab("review");
                setIntakeOpen(false);
              }
            }}
          >
            <div className="form-grid">
              <label className="form-field">
                <span>Related handoff</span>
                <select
                  value={scenarioId}
                  onChange={(e) => {
                    setScenarioId(e.target.value);
                    setChoiceId("");
                  }}
                >
                  {scenarios.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>Source department</span>
                <select
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                >
                  {intakeDepartments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="form-field">
              <span>
                Exact source text <small>{text.length} / 6,000</small>
              </span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                maxLength={6000}
                placeholder="Paste a message, a specification excerpt, or a reviewed clarification. Keep the original wording."
                required
              />
            </label>
            <label className="form-field">
              <span>
                Proposed structured meaning{" "}
                <small>Optional · requires review</small>
              </span>
              <select
                value={choiceId}
                onChange={(e) => setChoiceId(e.target.value)}
              >
                <option value="">
                  Retain the current structured mapping for review
                </option>
                {list(targetScenario?.resolution?.choices).map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {ch.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="intake-submit">
              <span>
                <FileText size={14} />
                Original evidence and review history are preserved.
              </span>
              <Button
                type="submit"
                busy={busy === "intake"}
                disabled={!!busy || text.trim().length < 10}
                icon={<Plus size={14} />}
              >
                Save for review
              </Button>
            </div>
          </form>
        </section>
      )}
      {tab === "sources" ? (
        <>
          <div className="source-search-row">
            <div className="input-with-icon">
              <Search size={15} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search exact source evidence…"
                aria-label="Search source evidence"
              />
            </div>
            <span>{filtered.length} versioned sources</span>
          </div>
          {filtered.length ? (
            <div className="source-library-grid">
              {filtered.map((source, i) => (
                <SourceCard
                  source={source}
                  department={departments.find(
                    (d) => d.id === source.departmentId,
                  )}
                  key={source.id || i}
                />
              ))}
            </div>
          ) : (
            <Empty title="No sources match your search">
              Try a department, title, or phrase from the evidence.
            </Empty>
          )}
        </>
      ) : interpretations.length ? (
        <div className="interpretation-list">
          {interpretations.map((i) => (
            <article className="panel interpretation-card" key={i.id}>
              <div className="card-kicker">
                <Badge tone="neutral">PROPOSED INTERPRETATION</Badge>
                <Status value={i.status || "pending_review"} />
              </div>
              <h3>{i.title || "New evidence for review"}</h3>
              <blockquote>
                {i.text || i.sourceText || i.body || i.description}
              </blockquote>
              <div className="interpretation-meta">
                <span>
                  Handoff:{" "}
                  {scenarios.find((s) => s.id === i.scenarioId)?.title ||
                    readable(i.scenarioId)}
                </span>
                <span>Source revision {i.version || i.revision || 1}</span>
                <span>{time(i.createdAt, true)}</span>
              </div>
              {i.choiceId && (
                <Notice tone="amber">
                  Proposed mapping:{" "}
                  {scenarios
                    .find((s) => s.id === i.scenarioId)
                    ?.resolution?.choices?.find(
                      (c: Data) => c.id === i.choiceId,
                    )?.label || readable(i.choiceId)}
                </Notice>
              )}
              <JsonView
                value={
                  i.proposedRule ||
                  i.proposedRuleJson || {
                    choiceId: i.choiceId,
                    sourceId: i.sourceId,
                    expectedRevision: i.expectedRevision,
                    scope: i.scope,
                  }
                }
                title="Inspect proposed scope and mapping"
              />
              {!["accepted", "rejected", "approved"].includes(i.status) && (
                <div className="interpretation-actions">
                  <span>
                    <Users size={14} />
                    Human review is required before adoption.
                  </span>
                  <Button
                    variant="secondary"
                    busy={busy === `reject-${i.id}`}
                    disabled={!!busy}
                    onClick={() =>
                      onMutate(
                        `interpretations/${i.id}/review`,
                        {
                          action: "reject",
                          expectedRevision:
                            i.revision ?? i.expectedRevision ?? 1,
                        },
                        `reject-${i.id}`,
                        "Interpretation rejected. The original evidence is preserved.",
                      )
                    }
                  >
                    Reject interpretation
                  </Button>
                  <Button
                    busy={busy === `accept-${i.id}`}
                    disabled={!!busy}
                    onClick={() =>
                      onMutate(
                        `interpretations/${i.id}/review`,
                        {
                          action: "accept",
                          expectedRevision:
                            i.revision ?? i.expectedRevision ?? 1,
                          ...(i.choiceId ? { choiceId: i.choiceId } : {}),
                        },
                        `accept-${i.id}`,
                        "Interpretation reviewed. Dependent evidence has been versioned.",
                      )
                    }
                    icon={<Check size={14} />}
                  >
                    Accept reviewed meaning
                  </Button>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <Empty
          icon={<FileText size={28} />}
          title="No interpretations waiting for review."
          action={
            <Button
              variant="secondary"
              onClick={() => setIntakeOpen(true)}
              icon={<Plus size={14} />}
            >
              Capture evidence
            </Button>
          }
        >
          New evidence enters as a proposal. A reviewer decides whether its
          structured meaning is ready to use.
        </Empty>
      )}
    </>
  );
}

function Memory({
  items,
  onScenario,
}: {
  items: Data[];
  onScenario: (id: string) => void;
}) {
  const [kind, setKind] = useState("all"),
    [search, setSearch] = useState("");
  const kinds = [
    {
      id: "episodic",
      title: "Episodic",
      subtitle: "What happened",
      description:
        "Investigations, outcomes, and the evidence that shaped them.",
      icon: Clock3,
    },
    {
      id: "semantic",
      title: "Semantic",
      subtitle: "What we agreed",
      description: "Approved meaning and the exact scope where it applies.",
      icon: BrainCircuit,
    },
    {
      id: "procedural",
      title: "Procedural",
      subtitle: "How to handle it",
      description:
        "Reusable steps for the next agent facing a similar handoff.",
      icon: Layers,
    },
  ];
  const filtered = items.filter(
    (m) =>
      (kind === "all" || m.kind === kind) &&
      `${m.title} ${m.body} ${m.scope}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="memory-category-grid">
        {kinds.map((k) => (
          <button
            className={`memory-category ${kind === k.id ? "selected" : ""}`}
            key={k.id}
            onClick={() => setKind(kind === k.id ? "all" : k.id)}
          >
            <span className={`memory-kind-icon kind-${k.id}`}>
              <k.icon size={23} strokeWidth={1.5} />
            </span>
            <span className="memory-category-count">
              {items.filter((m) => m.kind === k.id).length}
            </span>
            <div className="eyebrow">{k.title} MEMORY</div>
            <h3>{k.subtitle}</h3>
            <p>{k.description}</p>
          </button>
        ))}
      </div>
      <div className="list-toolbar">
        <div className="segmented-control">
          {["all", "episodic", "semantic", "procedural"].map((k) => (
            <button
              key={k}
              className={kind === k ? "active" : ""}
              onClick={() => setKind(k)}
            >
              {k === "all" ? "All memory" : readable(k)}
            </button>
          ))}
        </div>
        <div className="input-with-icon">
          <Search size={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search remembered context…"
            aria-label="Search agent memory"
          />
        </div>
      </div>
      {filtered.length ? (
        <div className="memory-list">
          {filtered.map((memory) => {
            const k = kinds.find((k) => k.id === memory.kind) || kinds[0];
            return (
              <article className="panel memory-card" key={memory.id}>
                <div className="memory-card-icon">
                  <k.icon size={20} />
                </div>
                <div className="memory-card-content">
                  <div className="card-kicker">
                    <Badge
                      tone={
                        memory.kind === "semantic"
                          ? "teal"
                          : memory.kind === "procedural"
                            ? "violet"
                            : "neutral"
                      }
                    >
                      {memory.kind}
                    </Badge>
                    <span className="tiny-label">
                      {time(memory.createdAt || memory.timestamp, true)}
                    </span>
                  </div>
                  <h3>{memory.title || k.subtitle}</h3>
                  <p>{memory.body || memory.description || memory.content}</p>
                  <div className="memory-scope">
                    <LockKeyhole size={13} />
                    <span>Scope: {readable(memory.scope)}</span>
                    {memory.applicable != null && (
                      <Badge tone={memory.applicable ? "teal" : "amber"}>
                        {memory.applicable
                          ? "Applicable to current versions"
                          : "Reuse needs review"}
                      </Badge>
                    )}
                  </div>
                  {memory.outcome && (
                    <div className="memory-outcome">
                      <span>Outcome</span>
                      <strong>{readable(memory.outcome)}</strong>
                    </div>
                  )}
                  <div className="memory-card-bottom">
                    {memory.scenarioId && (
                      <button
                        className="text-button"
                        onClick={() => onScenario(memory.scenarioId)}
                      >
                        View related handoff <ArrowUpRight size={13} />
                      </button>
                    )}
                    <JsonView
                      value={{
                        scope: memory.scope,
                        versions: memory.versions,
                        applicability:
                          memory.applicability || memory.conditions,
                        sourceId: memory.sourceId,
                        learnedFrom: memory.learnedFrom,
                      }}
                      title="Scope & provenance"
                    />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty
          icon={<BrainCircuit size={30} strokeWidth={1.4} />}
          title={
            items.length
              ? "No matching memories"
              : "The graph remembers as the team learns."
          }
        >
          {items.length
            ? "Try another memory type or phrase."
            : "Investigations create episodes. Human decisions establish meaning. Completed workflows teach reusable procedures."}
        </Empty>
      )}
      <Notice tone="teal" title="Reuse has conditions.">
        Memory belongs to this company’s private graph. Agents check its scope
        and source versions before using it in another investigation.
      </Notice>
    </>
  );
}

function parse(value: any) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function ToolCalls({ calls }: { calls: Data[] }) {
  return (
    <div className="tool-call-list">
      {calls.map((call, i) => (
        <div className="tool-call" key={call.id || i}>
          <div className="tool-call-index">
            {String(i + 1).padStart(2, "0")}
          </div>
          <div className="tool-call-content">
            <div className="tool-call-heading">
              <strong>
                <Terminal size={14} />
                {call.tool || call.name || call.toolName || "MCP tool call"}
              </strong>
              <div>
                {call.durationMs != null && (
                  <span>{Number(call.durationMs).toLocaleString()} ms</span>
                )}
                <Status
                  value={call.status || (call.isError ? "failed" : "completed")}
                />
              </div>
            </div>
            {(call.summary || call.description) && (
              <p>{call.summary || call.description}</p>
            )}
            <JsonView
              value={{
                arguments: parse(call.args || call.arguments || call.argsJson),
                result: parse(call.result || call.resultJson || call.output),
              }}
              title="Tool arguments and result"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function Agents({
  runs,
  agents,
  mode,
  onScenario,
}: {
  runs: Data[];
  agents: Data[];
  mode: string;
  onScenario: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const current = runs.find((r) => r.id === selected) || runs[0];
  const roles = [
    {
      id: "investigator",
      name: "Investigator",
      description: "Reads memory and follows evidence to the shared handoff.",
      icon: Search,
    },
    {
      id: "verifier",
      name: "Verifier",
      description:
        "Checks reviewed rules and returns a bounded, concrete result.",
      icon: ScanLine,
    },
    {
      id: "coordinator",
      name: "Coordinator",
      description:
        "Routes clarification to owners and preserves the next step.",
      icon: Users,
    },
  ];
  const toolCalls = list(
    current?.tools ||
      current?.toolCalls ||
      current?.calls ||
      parse(current?.toolsJson),
  );
  return (
    <>
      <div className="agent-role-grid">
        {roles.map((role) => {
          const agent = agents.find(
            (a) =>
              a.role === role.id || a.id === role.id || a.id?.endsWith(role.id),
          );
          return (
            <div className="panel agent-role" key={role.id}>
              <span className={`agent-role-icon role-${role.id}`}>
                <role.icon size={23} strokeWidth={1.4} />
              </span>
              <div>
                <span className="eyebrow">
                  {agent?.name ? `${agent.name} · ${role.name}` : role.name}
                </span>
                <p>{agent?.description || role.description}</p>
              </div>
            </div>
          );
        })}
      </div>
      {mode === "guided" && (
        <Notice tone="amber" title="Guided execution is active.">
          A deterministic policy selects tools through the real MCP protocol. No
          language-model call is claimed. Configure a model provider to enable
          model-selected tool use.
        </Notice>
      )}
      {runs.length ? (
        <div className="agent-run-layout">
          <aside className="panel run-list">
            <SectionHeading title="Persisted runs" count={runs.length} />
            {runs.map((run) => (
              <button
                key={run.id}
                className={`run-list-item ${current?.id === run.id ? "active" : ""}`}
                onClick={() => setSelected(run.id)}
              >
                <div>
                  <span className="run-dot" />
                  <strong>
                    {run.title ||
                      run.scenarioTitle ||
                      `${readable(run.scenarioId || "Handoff")} investigation`}
                  </strong>
                </div>
                <span>{time(run.createdAt || run.startedAt, true)}</span>
                <div>
                  <Status value={run.status || "completed"} />
                  <span>{run.mode || mode}</span>
                </div>
              </button>
            ))}
          </aside>
          <section className="panel run-inspector">
            <div className="card-kicker">
              <Badge tone="neutral">AGENT RUN</Badge>
              <span className="tiny-label">
                {String(current?.id || "").slice(-12)}
              </span>
            </div>
            <h2>
              {current?.title ||
                current?.scenarioTitle ||
                "An explainable investigation"}
            </h2>
            <p>
              {current?.summary ||
                current?.explanation ||
                "Graph evidence, checked semantics, and a durable coordination result."}
            </p>
            <div className="run-metadata">
              <div>
                <span>Execution mode</span>
                <strong>{current?.mode || mode}</strong>
              </div>
              <div>
                <span>Status</span>
                <Status value={current?.status || "completed"} />
              </div>
              <div>
                <span>Tool receipts</span>
                <strong>{toolCalls.length}</strong>
              </div>
              <div>
                <span>Created</span>
                <strong>
                  {time(current?.createdAt || current?.startedAt, true)}
                </strong>
              </div>
            </div>
            {toolCalls.length ? (
              <ToolCalls calls={toolCalls} />
            ) : (
              <Notice>
                Tool receipts are retained with the run. Open the structured
                record for any provider-specific trace details.
              </Notice>
            )}
            <JsonView value={current} title="Full persisted run record" />
            {current?.scenarioId && (
              <button
                className="text-button run-backlink"
                onClick={() => onScenario(current.scenarioId)}
              >
                Return to the source handoff <ArrowUpRight size={14} />
              </button>
            )}
          </section>
        </div>
      ) : (
        <Empty
          icon={<Bot size={30} strokeWidth={1.4} />}
          title="A clear trail begins with the first run."
          action={
            <Button
              onClick={() => onScenario("trial")}
              icon={<Play size={14} />}
            >
              Start an investigation
            </Button>
          }
        >
          Actual tool calls, arguments, outcomes, and memory reads will be
          available here after an investigation.
        </Empty>
      )}
    </>
  );
}

function Audit({
  audit,
  verification,
  busy,
  onRun,
}: {
  audit: Resource;
  verification: Resource;
  busy: string | null;
  onRun: () => void;
}) {
  const [tab, setTab] = useState("verification"),
    [search, setSearch] = useState("");
  const report = verification.data || {},
    checks = list(report.checks),
    concurrency = report.concurrency;
  const events = list(audit.data, ["events", "audit"]).filter((e) =>
    `${e.action} ${e.actor} ${e.title}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="list-toolbar">
        <div className="segmented-control">
          <button
            className={tab === "verification" ? "active" : ""}
            onClick={() => setTab("verification")}
          >
            Verification lab
          </button>
          <button
            className={tab === "audit" ? "active" : ""}
            onClick={() => setTab("audit")}
          >
            Audit trail{" "}
            <span>{list(audit.data, ["events", "audit"]).length}</span>
          </button>
          <button
            className={tab === "queries" ? "active" : ""}
            onClick={() => setTab("queries")}
          >
            Query patterns
          </button>
        </div>
        {tab === "verification" && (
          <Button
            busy={busy === "verification"}
            disabled={!!busy}
            onClick={onRun}
            icon={<Play size={14} />}
          >
            {busy === "verification"
              ? "Measuring behavior…"
              : "Run verification suite"}
          </Button>
        )}
      </div>
      {tab === "verification" && (
        <ResourceContent resource={verification}>
          {() => (
            <>
              <section className="panel verification-lab-hero">
                <span className="verification-lab-symbol">
                  <ShieldCheck size={36} strokeWidth={1.2} />
                </span>
                <div>
                  <div className="eyebrow">MEASURED, NOT ASSUMED</div>
                  <h2>Test the boundaries that matter.</h2>
                  <p>
                    Domain correctness, tenant isolation, revision conflicts,
                    duplicate commands, and durable coordination.
                  </p>
                </div>
                <div>
                  <Status value={report.status || "not_run"} />
                  {report.generatedAt && (
                    <span className="report-date">
                      {time(report.generatedAt, true)}
                    </span>
                  )}
                </div>
              </section>
              {checks.length ? (
                <div className="panel verification-checks">
                  {checks.map((check, i) => (
                    <div className="verification-check" key={check.name || i}>
                      <span
                        className={check.passed ? "check-pass" : "check-fail"}
                      >
                        {check.passed ? <Check size={15} /> : <X size={15} />}
                      </span>
                      <div>
                        <strong>{check.name}</strong>
                        <p>{readable(check.detail || check.description)}</p>
                      </div>
                      <Badge tone={check.passed ? "teal" : "coral"}>
                        {check.passed ? "Passed" : "Failed"}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty
                  title="No measured report yet"
                  icon={<Activity size={27} />}
                >
                  Run the verification suite to record actual checks. The
                  isolated fixtures do not reset your active workspace.
                </Empty>
              )}
              {concurrency && (
                <section className="panel concurrency-panel">
                  <SectionHeading
                    title="Concurrent coordination"
                    description="Measured operations against the selected FalkorDB engine."
                  />
                  <div className="concurrency-grid">
                    {[
                      ["Workers", concurrency.workers],
                      ["Operations", concurrency.operations],
                      ["Accepted writes", concurrency.acceptedWrites],
                      ["Stale updates rejected", concurrency.staleRejected],
                      ["Duplicate cases", concurrency.duplicateCases],
                      [
                        "Lost acknowledged writes",
                        concurrency.lostAcknowledgedWrites,
                      ],
                      [
                        "Median latency",
                        concurrency.p50Ms != null
                          ? `${Number(concurrency.p50Ms).toFixed(1)} ms`
                          : undefined,
                      ],
                      [
                        "95th percentile",
                        concurrency.p95Ms != null
                          ? `${Number(concurrency.p95Ms).toFixed(1)} ms`
                          : undefined,
                      ],
                    ].map(([label, value]) => (
                      <div key={String(label)}>
                        <span>{label}</span>
                        <strong>{value ?? "Not measured"}</strong>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              <Notice>
                Reported results apply to this engine, fixture set, and measured
                workload. Bounded scenario verification does not claim
                correctness outside the disclosed domain.
              </Notice>
            </>
          )}
        </ResourceContent>
      )}
      {tab === "audit" && (
        <>
          <div className="source-search-row">
            <div className="input-with-icon">
              <Search size={15} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search event or actor…"
                aria-label="Search audit events"
              />
            </div>
            <span>{events.length} recorded events</span>
          </div>
          <ResourceContent resource={audit}>
            {() =>
              events.length ? (
                <section className="panel audit-panel">
                  <Timeline items={events} />
                </section>
              ) : (
                <Empty
                  title="No matching audit events"
                  icon={<Activity size={26} />}
                >
                  Actions create versioned events with their actor and affected
                  entities.
                </Empty>
              )
            }
          </ResourceContent>
        </>
      )}
      {tab === "queries" && <QueryPatterns />}
    </>
  );
}

function QueryPatterns() {
  const patterns = [
    {
      name: "Follow the evidence",
      purpose:
        "Traverse a handoff’s reviewed obligation and its connected rules.",
      query:
        "MATCH (h:Handoff {id: $handoffId})\n      -[:HAS_OBLIGATION]->(o:Obligation)\nMATCH (o)-[:EXPECTS|COMPARES]->(r:Rule)\nRETURN h, o, r",
    },
    {
      name: "Route work to owners",
      purpose:
        "Read the graph relationships that connect a handoff to accountable departments.",
      query:
        "MATCH (h:Handoff {id: $handoffId})\n      -[:FROM|TO]->(d:Department)\nOPTIONAL MATCH (p:Person)-[:MEMBER_OF]->(d)\nRETURN d, collect(p) AS owners",
    },
    {
      name: "Recall scoped memory",
      purpose:
        "Retrieve only memories connected to the current handoff and inspect version applicability.",
      query:
        "MATCH (m:Memory)-[:APPLIES_TO]->\n      (h:Handoff {id: $handoffId})\nRETURN m.id, m.kind, m.scope, m.versionsJson",
    },
    {
      name: "Guard a revision",
      purpose:
        "Condition a state change on the application revision in the same atomic query.",
      query:
        "MATCH (c:Case {id: $caseId})\nWHERE c.revision = $expectedRevision\nSET c.revision = c.revision + 1,\n    c.status = $nextStatus\nRETURN c",
    },
  ];
  return (
    <>
      <Notice title="Readable query patterns">
        These examples explain the graph operations. The application uses named,
        parameterized service queries with workspace isolation and mutation
        guards.
      </Notice>
      <div className="query-grid">
        {patterns.map((p, i) => (
          <section className="panel query-card" key={p.name}>
            <div className="card-kicker">
              <Badge tone="neutral">
                CYPHER {String(i + 1).padStart(2, "0")}
              </Badge>
              <Database size={17} />
            </div>
            <h3>{p.name}</h3>
            <p>{p.purpose}</p>
            <pre>{p.query}</pre>
          </section>
        ))}
      </div>
    </>
  );
}

function Architecture({
  connection,
  mode,
  tenant,
  onTenant,
  onReset,
  busy,
}: {
  connection: Data;
  mode: string;
  tenant: string;
  onTenant: (tenant: string) => void;
  onReset: () => void;
  busy: string | null;
}) {
  const resources = [
    {
      title: "FalkorDB documentation",
      body: "Graph data, Cypher, indexes, and engine behavior.",
      href: "https://docs.falkordb.com/",
    },
    {
      title: "Official TypeScript client",
      body: "Application queries and remote graph connectivity.",
      href: "https://github.com/FalkorDB/falkordb-ts",
    },
    {
      title: "FalkorDBLite",
      body: "A real local FalkorDB process for development and checks.",
      href: "https://github.com/FalkorDB/falkordblite-ts",
    },
    {
      title: "Graph algorithms",
      body: "Database-side relationship traversal and path discovery.",
      href: "https://docs.falkordb.com/algorithms/",
    },
    {
      title: "FalkorDB MCP server",
      body: "Official graph tools and Model Context Protocol resources.",
      href: "https://github.com/FalkorDB/FalkorDB-MCPServer",
    },
    {
      title: "FalkorDB Cloud",
      body: "Hosted graph connections, access control, and persistence options.",
      href: "https://docs.falkordb.com/cloud",
    },
  ];
  return (
    <>
      <section className="panel architecture-map">
        <div className="section-heading">
          <div>
            <h2>A graph at the center of every decision.</h2>
            <p>
              The interface reads evidence, agents use bounded tools, and humans
              close the loop.
            </p>
          </div>
          <Badge tone="neutral">SYSTEM DESIGN</Badge>
        </div>
        <div className="architecture-flow">
          <div className="architecture-flow-node">
            <LayoutDashboard size={25} />
            <strong>Workspace</strong>
            <span>Next.js on Vercel</span>
          </div>
          <div className="architecture-connector">
            <ArrowRight size={20} />
            <span>Signed session</span>
          </div>
          <div className="architecture-flow-node">
            <Bot size={25} />
            <strong>Agents + MCP</strong>
            <span>Tools, receipts, and handoffs</span>
          </div>
          <div className="architecture-connector">
            <ArrowRight size={20} />
            <span>Bounded queries</span>
          </div>
          <div className="architecture-flow-node graph-core">
            <Database size={30} />
            <strong>FalkorDB</strong>
            <span>Connected evidence + memory</span>
          </div>
        </div>
        <div className="architecture-branches">
          <div>
            <ScanLine size={20} />
            <strong>Deterministic verifier</strong>
            <span>Reviewed rules · finite domains · concrete witnesses</span>
          </div>
          <div>
            <Users size={20} />
            <strong>Human clarification</strong>
            <span>
              Scoped decisions · implementation evidence · fresh verification
            </span>
          </div>
        </div>
      </section>
      <div className="architecture-principles">
        <section className="panel">
          <span className="feature-icon">
            <Link2 size={22} />
          </span>
          <h3>Connections drive the action.</h3>
          <p>
            The agent follows sources, reviewed rules, shared obligations, and
            owners. A conflict is a broken handoff promise.
          </p>
        </section>
        <section className="panel">
          <span className="feature-icon teal">
            <BrainCircuit size={22} />
          </span>
          <h3>Memory has a scope.</h3>
          <p>
            Episodes, approved meanings, and procedures carry source versions
            and applicability. Each company’s graph is isolated.
          </p>
        </section>
        <section className="panel">
          <span className="feature-icon violet">
            <ShieldCheck size={22} />
          </span>
          <h3>The result has boundaries.</h3>
          <p>
            A concrete witness, bounded validity, an incomplete search, and
            missing evidence are separate outcomes.
          </p>
        </section>
      </div>
      <section className="panel runtime-panel">
        <SectionHeading
          title="Current runtime"
          description="Connection status comes from the server. Credentials never appear in this workspace."
        />
        <div className="runtime-grid">
          <div>
            <span>Graph engine</span>
            <strong>{connection.engine || "FalkorDB"}</strong>
            <Status value={connection.status || "unavailable"} />
          </div>
          <div>
            <span>Engine version</span>
            <strong>{connection.version || "Not reported"}</strong>
          </div>
          <div>
            <span>Persistence</span>
            <strong>
              {connection.persistent === true
                ? "Persistent storage configured"
                : connection.persistent === false
                  ? "No persistence confirmed"
                  : "Not confirmed"}
            </strong>
          </div>
          <div>
            <span>Agent execution</span>
            <strong>
              {mode === "model" ? "Configured model" : "Guided MCP policy"}
            </strong>
          </div>
        </div>
        {mode !== "model" && (
          <Notice tone="amber">
            Model credentials are not configured. Guided mode uses the same MCP
            tools and deterministic checker, with its execution mode labeled in
            every run.
          </Notice>
        )}
      </section>
      <SectionHeading
        title="Built with the FalkorDB ecosystem"
        description="The resources behind graph storage, query execution, local development, and tool integration."
      />
      <div className="resource-grid">
        {resources.map((resource) => (
          <a
            className="resource-card"
            key={resource.href}
            href={resource.href}
            target="_blank"
            rel="noreferrer"
          >
            <div>
              <Database size={18} />
              <ArrowUpRight size={17} />
            </div>
            <h3>{resource.title}</h3>
            <p>{resource.body}</p>
          </a>
        ))}
      </div>
      <section className="panel settings-panel">
        <SectionHeading
          title="Private demo settings"
          description="Explore two fictional companies with intentionally different semantics and separate memory."
        />
        <div className="settings-row">
          <div>
            <strong>Company workspace</strong>
            <p>Changing the company selects a separately scoped graph.</p>
          </div>
          <select
            value={tenant}
            onChange={(e) => onTenant(e.target.value)}
            disabled={!!busy}
            aria-label="Change company in settings"
          >
            <option value="acme">Acme</option>
            <option value="nova">Nova</option>
          </select>
        </div>
        <div className="settings-row">
          <div>
            <strong>Reset this company’s demo</strong>
            <p>
              Restore synthetic sources and clear your current company’s
              coordination history.
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={onReset}
            disabled={!!busy}
            icon={<RotateCcw size={14} />}
          >
            Reset workspace
          </Button>
        </div>
      </section>
    </>
  );
}

function Chat({
  resource,
  busy,
  scenarioId,
  mode,
  onClose,
  onSend,
}: {
  resource: Resource;
  busy: string | null;
  scenarioId: string;
  mode: string;
  onClose: () => void;
  onSend: (message: string) => Promise<boolean>;
}) {
  const [message, setMessage] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const messages = list(resource.data, ["messages", "conversation"]).filter(
    (m) => m.role !== "system",
  );
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [resource.data, busy]);
  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    if (await onSend(text.trim())) setMessage("");
  };
  return (
    <aside className="chat-panel" aria-label="Parallax assistant">
      <header>
        <div>
          <span className="chat-brand-icon">
            <Sparkles size={19} />
          </span>
          <div>
            <strong>Ask Parallax</strong>
            <span>Grounded in your workspace</span>
          </div>
        </div>
        <IconButton label="Close assistant" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </header>
      <div className="chat-mode">
        <span className="health-dot online" />
        {mode === "model" ? "Model + graph tools" : "Guided MCP assistant"}
        <span>Persistent conversation</span>
      </div>
      <div className="chat-messages">
        {resource.error ? (
          <ErrorBox message={resource.error} onRetry={resource.reload} />
        ) : resource.loading && !resource.data ? (
          <Loading label="Recalling your conversation…" />
        ) : messages.length ? (
          messages.map((m, i) => (
            <div className={`chat-message message-${m.role}`} key={m.id || i}>
              {m.role !== "user" && (
                <span className="assistant-avatar">
                  <Sparkles size={13} />
                </span>
              )}
              <div>
                <div className="chat-message-meta">
                  <strong>{m.role === "user" ? "You" : "Parallax"}</strong>
                  <time>{time(m.createdAt || m.timestamp)}</time>
                </div>
                <p>
                  {typeof (m.body || m.content || m.text) === "object"
                    ? readable(m.body || m.content || m.text)
                    : m.body || m.content || m.text}
                </p>
                {m.tools?.length > 0 && (
                  <details className="chat-tools">
                    <summary>
                      <Terminal size={12} />
                      {m.tools.length} graph tool calls
                    </summary>
                    <JsonView value={m.tools} title="Inspect receipts" />
                  </details>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="chat-welcome">
            <span>
              <BrainCircuit size={32} strokeWidth={1.3} />
            </span>
            <h3>Let’s make the meaning clear.</h3>
            <p>
              Ask about the evidence, investigate a handoff, or pick up where
              another agent left off.
            </p>
            {[
              "Investigate the trial handoff",
              "What is still waiting on humans?",
              "Which memories apply to this handoff?",
            ].map((prompt) => (
              <button
                key={prompt}
                onClick={() => send(prompt)}
                disabled={!!busy}
              >
                {prompt}
                <ArrowUpRight size={14} />
              </button>
            ))}
          </div>
        )}
        {busy === "chat" && (
          <div className="chat-working">
            <Loader2 size={14} className="spin" />
            <span>Reading the connected workspace…</span>
          </div>
        )}
        <div ref={bottom} />
      </div>
      <form
        className="chat-compose"
        onSubmit={(e) => {
          e.preventDefault();
          send(message);
        }}
      >
        <div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Ask about a promise, owner, or decision…"
            rows={3}
            maxLength={3000}
            aria-label="Message Parallax"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(message);
              }
            }}
          />
          <button
            type="submit"
            disabled={!!busy || !message.trim()}
            aria-label="Send message"
          >
            <Send size={16} />
          </button>
        </div>
        <span>
          <LockKeyhole size={11} /> Saved in this private workspace · context:{" "}
          {readable(scenarioId)}
        </span>
      </form>
    </aside>
  );
}
