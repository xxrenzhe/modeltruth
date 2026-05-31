"use client";

import { useEffect, useState } from "react";

interface WorkspaceLabels {
  name: string;
  baseUrl: string;
  modelId: string;
  apiKey: string;
  heartbeat: string;
  deepAudit: string;
  ttftAlert: string;
  create: string;
  empty: string;
  loginRequired: string;
  refresh: string;
  alertType: string;
  alertTarget: string;
  addAlert: string;
  alertChannels: string;
  noAlerts: string;
}

interface ProviderNode {
  id: string;
  name: string;
  baseUrl: string;
  modelId: string;
  apiKeySuffix?: string;
  status: string;
  heartbeatIntervalSeconds: number;
  deepAuditIntervalSeconds: number;
  ttftThresholdMs: number;
  nextHeartbeatAt?: string;
  nextDeepAuditAt?: string;
  createdAt: string;
}

interface AlertChannel {
  id: string;
  type: "webhook" | "slack" | "discord" | "email" | "telegram";
  enabled: boolean;
  targetSuffix?: string;
}

interface WorkspaceMember {
  id: string;
  email: string;
  role: "owner" | "member";
  status: "invited" | "active";
}

interface ByoProbe {
  id: string;
  name: string;
  region: string;
  status: "pending" | "active";
  lastSeenAt?: string;
  version?: string;
}

export function WorkspaceClient({ labels }: { labels: WorkspaceLabels }) {
  const [nodes, setNodes] = useState<ProviderNode[]>([]);
  const [channels, setChannels] = useState<AlertChannel[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [probes, setProbes] = useState<ByoProbe[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);

  async function loadNodes() {
    setError("");
    const response = await fetch("/api/workspace/nodes");
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? labels.loginRequired);
      setNodes([]);
      return;
    }
    setNodes(payload.nodes ?? []);
  }

  async function loadChannels() {
    const response = await fetch("/api/workspace/alert-channels");
    const payload = await response.json();
    if (response.ok) setChannels(payload.channels ?? []);
  }

  async function loadMembers() {
    const response = await fetch("/api/workspace/members");
    const payload = await response.json();
    if (response.ok) setMembers(payload.members ?? []);
  }

  async function loadProbes() {
    const response = await fetch("/api/workspace/probes");
    const payload = await response.json();
    if (response.ok) setProbes(payload.probes ?? []);
  }

  useEffect(() => {
    void loadNodes();
    void loadChannels();
    void loadMembers();
    void loadProbes();
  }, []);

  async function createNode(formData: FormData) {
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/workspace/nodes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          baseUrl: formData.get("baseUrl"),
          modelId: formData.get("modelId"),
          apiKey: formData.get("apiKey"),
          heartbeatIntervalSeconds: Number(formData.get("heartbeatIntervalSeconds") ?? 300),
          deepAuditIntervalSeconds: Number(formData.get("deepAuditIntervalSeconds") ?? 43200),
          ttftThresholdMs: Number(formData.get("ttftThresholdMs") ?? 3000)
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to create node");
      setNotice(`Created ${payload.node.name}`);
      await loadNodes();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create node");
    } finally {
      setPending(false);
    }
  }

  async function createAlertChannel(formData: FormData) {
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/workspace/alert-channels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: formData.get("type"),
          target: formData.get("target")
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to create alert channel");
      setNotice(`Created ${payload.channel.type} alert channel`);
      await loadChannels();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create alert channel");
    } finally {
      setPending(false);
    }
  }

  async function inviteMember(formData: FormData) {
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/workspace/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: formData.get("email") })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to invite member");
      setNotice(`Invited ${payload.member.email}`);
      await loadMembers();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to invite member");
    } finally {
      setPending(false);
    }
  }

  async function registerProbe(formData: FormData) {
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/workspace/probes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: formData.get("name"), region: formData.get("region") })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to register probe");
      setNotice(`Registered ${payload.probe.name}. Store this token now: ${payload.token}`);
      await loadProbes();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to register probe");
    } finally {
      setPending(false);
    }
  }

  async function requestPrioritySupport(formData: FormData) {
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/workspace/support", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject: formData.get("subject"), message: formData.get("message") })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to create support request");
      setNotice(`Priority support request queued: ${payload.supportRequest.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create support request");
    } finally {
      setPending(false);
    }
  }

  async function deleteNode(nodeId: string) {
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/workspace/nodes", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nodeId })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to delete node");
      setNotice("Deleted node and removed its encrypted key material");
      await loadNodes();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete node");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="workspaceGrid">
      <div className="formGrid">
        <form className="card formGrid" action={createNode}>
          <label>
            {labels.name}
            <input name="name" placeholder="Primary production gateway" required />
          </label>
          <label>
            {labels.baseUrl}
            <input name="baseUrl" placeholder="https://api.example.com/v1" required />
          </label>
          <label>
            {labels.modelId}
            <input name="modelId" placeholder="gpt-5.1" required />
          </label>
          <label>
            {labels.apiKey}
            <input name="apiKey" placeholder="sk-..." required type="password" />
          </label>
          <div className="twoColumn">
            <label>
              {labels.heartbeat}
              <input defaultValue="300" min="60" name="heartbeatIntervalSeconds" type="number" />
            </label>
            <label>
              {labels.deepAudit}
              <input defaultValue="43200" min="3600" name="deepAuditIntervalSeconds" type="number" />
            </label>
          </div>
          <label>
            {labels.ttftAlert}
            <input defaultValue="3000" min="100" name="ttftThresholdMs" type="number" />
          </label>
          <button className="button" disabled={pending} type="submit">
            {pending ? "..." : labels.create}
          </button>
        </form>

        <form className="card formGrid" action={createAlertChannel}>
          <div className="eyebrow">{labels.alertChannels}</div>
          <label>
            {labels.alertType}
            <select name="type" defaultValue="webhook">
              <option value="webhook">Webhook</option>
              <option value="slack">Slack</option>
              <option value="discord">Discord</option>
              <option value="email">Email</option>
              <option value="telegram">Telegram</option>
            </select>
          </label>
          <label>
            {labels.alertTarget}
            <input name="target" placeholder='https://hooks.example.com/... or {"botToken":"...","chatId":"..."}' required />
          </label>
          <button className="button" disabled={pending} type="submit">
            {pending ? "..." : labels.addAlert}
          </button>
          {channels.length === 0 ? <p className="lede">{labels.noAlerts}</p> : null}
          <div className="statusList">
            {channels.map((channel) => (
              <div className="statusRow" key={channel.id}>
                <span>{channel.type}</span>
                <span className="pill pass">{channel.targetSuffix ?? (channel.enabled ? "enabled" : "off")}</span>
              </div>
            ))}
          </div>
        </form>

        <form className="card formGrid" action={inviteMember}>
          <div className="eyebrow">Team members</div>
          <label>
            Invite email
            <input name="email" placeholder="teammate@example.com" required type="email" />
          </label>
          <button className="button" disabled={pending} type="submit">
            {pending ? "..." : "Invite member"}
          </button>
          {members.length === 0 ? <p className="lede">Team workspaces can invite members here.</p> : null}
          <div className="statusList">
            {members.map((member) => (
              <div className="statusRow" key={member.id}>
                <span>{member.email}</span>
                <span className={`pill ${member.status === "active" ? "pass" : "warning"}`}>{member.role} / {member.status}</span>
              </div>
            ))}
          </div>
        </form>

        <form className="card formGrid" action={registerProbe}>
          <div className="eyebrow">BYO Probe</div>
          <label>
            Probe name
            <input name="name" placeholder="Tokyo office probe" required />
          </label>
          <label>
            Region slug
            <input name="region" placeholder="ap-northeast-1" required />
          </label>
          <button className="button" disabled={pending} type="submit">
            {pending ? "..." : "Register probe"}
          </button>
          {probes.length === 0 ? <p className="lede">Team workspaces can register user-authorized regional probes here.</p> : null}
          <div className="statusList">
            {probes.map((probe) => (
              <div className="statusRow" key={probe.id}>
                <span>{probe.name} / {probe.region}</span>
                <span className={`pill ${probe.status === "active" ? "pass" : "warning"}`}>
                  {probe.status}{probe.version ? ` / ${probe.version}` : ""}
                </span>
              </div>
            ))}
          </div>
        </form>

        <form className="card formGrid" action={requestPrioritySupport}>
          <div className="eyebrow">Priority support</div>
          <label>
            Subject
            <input name="subject" placeholder="Billing variance review" required />
          </label>
          <label>
            Message
            <textarea name="message" placeholder="Describe the urgent audit or billing evidence question." required rows={4} />
          </label>
          <button className="button" disabled={pending} type="submit">
            {pending ? "..." : "Request Team support"}
          </button>
          <p className="lede">Team requests are queued with workspace and contact context for priority review.</p>
        </form>

        {notice ? <p className="notice">{notice}</p> : null}
        {error ? <p className="notice error">{error}</p> : null}
      </div>

      <div className="card formGrid">
        <button className="button secondary" onClick={loadNodes} type="button">
          {labels.refresh}
        </button>
        {nodes.length === 0 ? <p className="lede">{labels.empty}</p> : null}
        <div className="statusList">
          {nodes.map((node) => (
            <article className="nodeCard" key={node.id}>
              <div>
                <strong>{node.name}</strong>
                <p>{node.baseUrl}</p>
              </div>
              <span className="pill pass">{node.status}</span>
              <button className="button secondary" disabled={pending} onClick={() => void deleteNode(node.id)} type="button">
                Delete node
              </button>
              <dl>
                <div>
                  <dt>Model</dt>
                  <dd>{node.modelId}</dd>
                </div>
                <div>
                  <dt>Key</dt>
                  <dd>{node.apiKeySuffix ? `...${node.apiKeySuffix}` : "none"}</dd>
                </div>
                <div>
                  <dt>Heartbeat</dt>
                  <dd>{node.heartbeatIntervalSeconds}s</dd>
                </div>
                <div>
                  <dt>Deep audit</dt>
                  <dd>{node.deepAuditIntervalSeconds}s</dd>
                </div>
                <div>
                  <dt>TTFT alert</dt>
                  <dd>{node.ttftThresholdMs}ms</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
