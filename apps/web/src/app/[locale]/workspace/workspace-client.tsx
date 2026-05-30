"use client";

import { useEffect, useState } from "react";

interface WorkspaceLabels {
  name: string;
  baseUrl: string;
  modelId: string;
  apiKey: string;
  heartbeat: string;
  deepAudit: string;
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
  nextHeartbeatAt?: string;
  nextDeepAuditAt?: string;
  createdAt: string;
}

interface AlertChannel {
  id: string;
  type: "webhook" | "slack" | "discord";
  enabled: boolean;
  targetSuffix?: string;
}

export function WorkspaceClient({ labels }: { labels: WorkspaceLabels }) {
  const [nodes, setNodes] = useState<ProviderNode[]>([]);
  const [channels, setChannels] = useState<AlertChannel[]>([]);
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

  useEffect(() => {
    void loadNodes();
    void loadChannels();
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
          deepAuditIntervalSeconds: Number(formData.get("deepAuditIntervalSeconds") ?? 43200)
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
            </select>
          </label>
          <label>
            {labels.alertTarget}
            <input name="target" placeholder="https://hooks.example.com/..." required />
          </label>
          <button className="button" disabled={pending} type="submit">
            {pending ? "..." : labels.addAlert}
          </button>
          {channels.length === 0 ? <p className="lede">{labels.noAlerts}</p> : null}
          <div className="statusList">
            {channels.map((channel) => (
              <div className="statusRow" key={channel.id}>
                <span>{channel.type}</span>
                <span className="pill pass">{channel.enabled ? "enabled" : "off"}</span>
              </div>
            ))}
          </div>
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
              </dl>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
