"use client";

import { useEffect, useState } from "react";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export default function AdminPage() {
  const [pin, setPin] = useState("1234");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [summary, setSummary] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadSummary = async () => {
    if (!API_URL) {
      setError("NEXT_PUBLIC_API_URL is not configured.");
      return;
    }

    const response = await fetch(`${API_URL}/api/admin/summary`, {
      credentials: "include",
      cache: "no-store",
    });

    if (!response.ok) {
      setIsAuthenticated(false);
      if (response.status === 401) {
        setError("Admin session expired or missing.");
      }
      return;
    }

    const payload = await response.json();
    setSummary(payload);
    setIsAuthenticated(true);
    setError("");
  };

  useEffect(() => {
    const bootstrap = async () => {
      if (!API_URL) {
        setError("NEXT_PUBLIC_API_URL is not configured.");
        setIsChecking(false);
        return;
      }

      try {
        const response = await fetch(`${API_URL}/api/admin/me`, { credentials: "include" });
        if (response.ok) {
          await loadSummary();
        }
      } catch {
        setError("Unable to reach the admin API.");
      } finally {
        setIsChecking(false);
      }
    };

    void bootstrap();
  }, []);

  const login = async () => {
    if (!API_URL) {
      setError("NEXT_PUBLIC_API_URL is not configured.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const response = await fetch(`${API_URL}/api/admin/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || "Admin login failed.");
      }

      await loadSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Admin login failed.");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    if (!API_URL) return;
    await fetch(`${API_URL}/api/admin/logout`, { method: "POST", credentials: "include" });
    setSummary(null);
    setIsAuthenticated(false);
    setError("");
  };

  if (isChecking) {
    return <div style={{ padding: 32, fontFamily: "sans-serif" }}>Checking admin session...</div>;
  }

  if (!isAuthenticated) {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0b1020", color: "#f4f6fb", fontFamily: "sans-serif" }}>
        <div style={{ width: "min(420px, 90vw)", background: "#121a2c", border: "1px solid #2a3351", borderRadius: 18, padding: 24 }}>
          <h1 style={{ marginTop: 0 }}>Admin access</h1>
          <p style={{ color: "#c9d4f6" }}>Enter the configured admin PIN to access the safe read-only control room.</p>
          <input
            type="password"
            value={pin}
            onChange={(event) => setPin(event.target.value)}
            placeholder="Admin PIN"
            style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid #384968", background: "#0d1529", color: "#fff", marginBottom: 16 }}
          />
          <button
            onClick={login}
            disabled={busy}
            style={{ width: "100%", padding: 12, borderRadius: 10, border: "none", background: "#1f9dff", color: "#fff", fontWeight: 700, cursor: busy ? "not-allowed" : "pointer" }}
          >
            {busy ? "Checking..." : "Unlock admin panel"}
          </button>
          {error ? <p style={{ color: "#ffb4b4", marginTop: 12 }}>{error}</p> : null}
        </div>
      </main>
    );
  }

  return (
    <main style={{ padding: 32, background: "#0b1020", minHeight: "100vh", color: "#f4f6fb", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <p style={{ margin: 0, color: "#8aa3ff", textTransform: "uppercase", letterSpacing: 1 }}>Admin control room</p>
          <h1 style={{ margin: "8px 0 0" }}>World summary</h1>
        </div>
        <button onClick={logout} style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid #4b5f8f", background: "transparent", color: "#fff", cursor: "pointer" }}>
          Logout
        </button>
      </div>

      {summary ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 24 }}>
            {[
              ["status", summary.world?.status ?? "UNKNOWN"],
              ["season", summary.world?.activeSeasonName ?? "Not active"],
              ["round", `${summary.world?.currentRound ?? 0}/${summary.world?.totalRounds ?? 0}`],
              ["leagues", summary.counts?.leagues ?? 0],
              ["teams", summary.counts?.teams ?? 0],
              ["fixtures", summary.counts?.fixtures ?? 0],
            ].map(([label, value]) => (
              <div key={label} style={{ background: "#121a2c", border: "1px solid #2a3351", borderRadius: 14, padding: 16 }}>
                <div style={{ color: "#8ea2d7", fontSize: 12, textTransform: "uppercase" }}>{label}</div>
                <div style={{ marginTop: 8, fontSize: 24, fontWeight: 700 }}>{String(value)}</div>
              </div>
            ))}
          </div>

          <div style={{ background: "#121a2c", border: "1px solid #2a3351", borderRadius: 16, padding: 20 }}>
            <h2 style={{ marginTop: 0 }}>Recent audit</h2>
            <div style={{ display: "grid", gap: 10 }}>
              {(summary.recentAudit ?? []).length === 0 ? (
                <div style={{ color: "#c9d4f6" }}>No audit entries yet.</div>
              ) : (
                summary.recentAudit.map((entry: any) => (
                  <div key={entry.id} style={{ border: "1px solid #2a3351", borderRadius: 10, padding: 12, background: "#0d1529" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <strong>{entry.action}</strong>
                      <span style={{ color: "#8ea2d7" }}>{new Date(entry.createdAt).toLocaleString()}</span>
                    </div>
                    <div style={{ color: "#d6def7", marginTop: 6 }}>{entry.summary}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      ) : null}

      {error ? <p style={{ color: "#ffb4b4", marginTop: 16 }}>{error}</p> : null}
    </main>
  );
}
