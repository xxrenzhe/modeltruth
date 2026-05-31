"use client";

import { useEffect, useState } from "react";

export function PrivacySettingsClient() {
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saveFullResponses, setSaveFullResponses] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadSettings() {
      const response = await fetch("/api/settings/privacy");
      const payload = await response.json();
      if (!cancelled && response.ok) setSaveFullResponses(payload.settings.saveFullResponses);
    }
    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  async function exportData() {
    setError("");
    setNotice("");
    const response = await fetch("/api/settings/privacy/export");
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? "Unable to export data");
      return;
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "modeltruth-privacy-export.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Privacy export generated.");
  }

  async function deleteAccount() {
    setError("");
    setNotice("");
    const response = await fetch("/api/settings/privacy/delete", { method: "POST" });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? "Unable to delete account");
      return;
    }
    setNotice("Account deleted. Local session has been cleared.");
  }

  async function updateEvidencePreference(nextValue: boolean) {
    setError("");
    setNotice("");
    setSaveFullResponses(nextValue);
    const response = await fetch("/api/settings/privacy", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ saveFullResponses: nextValue })
    });
    const payload = await response.json();
    if (!response.ok) {
      setSaveFullResponses(!nextValue);
      setError(payload.error ?? "Unable to update privacy settings");
      return;
    }
    setSaveFullResponses(payload.settings.saveFullResponses);
    setNotice(nextValue ? "Full response saving enabled for Pro evidence." : "Full response saving disabled.");
  }

  return (
    <section className="card formGrid">
      <label className="checkboxRow">
        <input
          checked={saveFullResponses}
          onChange={(event) => void updateEvidencePreference(event.target.checked)}
          type="checkbox"
        />
        <span>Save full provider responses for private workspace evidence</span>
      </label>
      <p className="muted">
        Default is off. Free Playground runs never save full responses; private workspace runs only
        save them after this explicit opt-in and still skip content that looks like a secret.
      </p>
      <button className="button" onClick={() => void exportData()} type="button">
        Export my data
      </button>
      <button className="button secondary" onClick={() => void deleteAccount()} type="button">
        Delete my account
      </button>
      {notice ? <p className="notice">{notice}</p> : null}
      {error ? <p className="notice error">{error}</p> : null}
    </section>
  );
}
