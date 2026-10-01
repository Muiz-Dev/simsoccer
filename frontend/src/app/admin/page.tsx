"use client";

import { useEffect, useRef, useState } from "react";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

type LeagueForm = {
  id: string;
  name: string;
  country: string;
  slug: string;
  competitionType: string;
  teamCount: number;
  active: boolean;
};

type TeamForm = {
  id: string;
  leagueId: string;
  name: string;
  shortName: string;
  slug: string;
  stadiumName: string;
  active: boolean;
};

const emptyLeagueForm = (): LeagueForm => ({
  id: "",
  name: "",
  country: "",
  slug: "",
  competitionType: "DOMESTIC_LEAGUE",
  teamCount: 20,
  active: true,
});

const emptyTeamForm = (): TeamForm => ({
  id: "",
  leagueId: "",
  name: "",
  shortName: "",
  slug: "",
  stadiumName: "",
  active: true,
});

export default function AdminPage() {
  const [pinDigits, setPinDigits] = useState(["", "", "", ""]);
  const pinInputs = useRef<Array<HTMLInputElement | null>>([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [summary, setSummary] = useState<any>(null);
  const [leagues, setLeagues] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [leagueForm, setLeagueForm] = useState<LeagueForm>(emptyLeagueForm());
  const [teamForm, setTeamForm] = useState<TeamForm>(emptyTeamForm());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const setPinDigit = (index: number, value: string) => {
    const digits = value.replace(/\D/g, "");
    const next = [...pinDigits];
    next[index] = digits.slice(-1);
    setPinDigits(next);
    if (next[index] && index < next.length - 1) pinInputs.current[index + 1]?.focus();
  };

  const pastePin = (index: number, value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 4 - index).split("");
    const next = [...pinDigits];
    digits.forEach((digit, offset) => { next[index + offset] = digit; });
    setPinDigits(next);
    pinInputs.current[Math.min(index + digits.length, 3)]?.focus();
  };

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

  const loadAdminData = async () => {
    if (!API_URL) return;

    const [leaguesRes, teamsRes] = await Promise.all([
      fetch(`${API_URL}/api/admin/leagues`, { credentials: "include", cache: "no-store" }),
      fetch(`${API_URL}/api/admin/teams`, { credentials: "include", cache: "no-store" }),
    ]);

    if (leaguesRes.ok) {
      const leagueRows = await leaguesRes.json();
      setLeagues(leagueRows);
    }

    if (teamsRes.ok) {
      const teamRows = await teamsRes.json();
      setTeams(teamRows);
    }
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
          await Promise.all([loadSummary(), loadAdminData()]);
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
        body: JSON.stringify({ pin: pinDigits.join("") }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || "Admin login failed.");
      }

      await Promise.all([loadSummary(), loadAdminData()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Admin login failed.");
    } finally {
      setPinDigits(["", "", "", ""]);
      setBusy(false);
    }
  };

  const logout = async () => {
    if (!API_URL) return;
    await fetch(`${API_URL}/api/admin/logout`, { method: "POST", credentials: "include" });
    setSummary(null);
    setLeagues([]);
    setTeams([]);
    setLeagueForm(emptyLeagueForm());
    setTeamForm(emptyTeamForm());
    setIsAuthenticated(false);
    setError("");
  };

  const saveLeague = async () => {
    if (!API_URL) return;
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/api/admin/leagues`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(leagueForm),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "Unable to save league.");
      setLeagueForm(emptyLeagueForm());
      await Promise.all([loadSummary(), loadAdminData()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save league.");
    } finally {
      setBusy(false);
    }
  };

  const saveTeam = async () => {
    if (!API_URL) return;
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/api/admin/teams`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(teamForm),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "Unable to save team.");
      setTeamForm(emptyTeamForm());
      await Promise.all([loadSummary(), loadAdminData()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save team.");
    } finally {
      setBusy(false);
    }
  };

  if (isChecking) {
    return <div style={{ padding: 32, fontFamily: "sans-serif" }}>Checking admin session...</div>;
  }

  if (!isAuthenticated) {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0b1020", color: "#f4f6fb", fontFamily: "sans-serif" }}>
        <div style={{ width: "min(420px, 90vw)", background: "#121a2c", border: "1px solid #2a3351", borderRadius: 18, padding: 24 }}>
          <h1 style={{ marginTop: 0 }}>Admin access</h1>
          <p style={{ color: "#c9d4f6" }}>Enter the configured admin PIN to access the control room.</p>
          <div role="group" aria-label="Four-digit admin PIN" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginBottom: 16 }}>
            {pinDigits.map((digit, index) => (
              <input
                key={index}
                ref={(element) => { pinInputs.current[index] = element; }}
                type="password"
                inputMode="numeric"
                autoComplete={index === 0 ? "one-time-code" : "off"}
                pattern="[0-9]*"
                maxLength={1}
                aria-label={`PIN digit ${index + 1}`}
                value={digit}
                onChange={(event) => setPinDigit(index, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft" && index > 0) pinInputs.current[index - 1]?.focus();
                  if (event.key === "ArrowRight" && index < 3) pinInputs.current[index + 1]?.focus();
                  if (event.key === "Backspace" && !digit && index > 0) pinInputs.current[index - 1]?.focus();
                }}
                onPaste={(event) => {
                  event.preventDefault();
                  pastePin(index, event.clipboardData.getData("text"));
                }}
                style={{ width: "100%", minWidth: 0, height: 58, textAlign: "center", fontSize: 24, borderRadius: 8, border: "1px solid #536b65", background: "#17221e", color: "#f4f6fb" }}
              />
            ))}
          </div>
          <button
            onClick={login}
            disabled={busy || pinDigits.some((digit) => !digit)}
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
          <h1 style={{ margin: "8px 0 0" }}>World operations</h1>
        </div>
        <button onClick={logout} style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid #4b5f8f", background: "transparent", color: "#fff", cursor: "pointer" }}>
          Logout
        </button>
      </div>

      {summary ? (
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
      ) : null}

      <div style={{ display: "grid", gap: 24, gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))" }}>
        <section style={{ background: "#121a2c", border: "1px solid #2a3351", borderRadius: 16, padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Leagues</h2>
          <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
            <input value={leagueForm.name} onChange={(e) => setLeagueForm({ ...leagueForm, name: e.target.value })} placeholder="League name" style={inputStyle} />
            <input value={leagueForm.country} onChange={(e) => setLeagueForm({ ...leagueForm, country: e.target.value })} placeholder="Country" style={inputStyle} />
            <input value={leagueForm.slug} onChange={(e) => setLeagueForm({ ...leagueForm, slug: e.target.value })} placeholder="Slug" style={inputStyle} />
            <input type="number" min={2} max={40} value={leagueForm.teamCount} onChange={(e) => setLeagueForm({ ...leagueForm, teamCount: Number(e.target.value) || 20 })} placeholder="Team count" style={inputStyle} />
            <select value={leagueForm.competitionType} onChange={(e) => setLeagueForm({ ...leagueForm, competitionType: e.target.value })} style={inputStyle}>
              <option value="DOMESTIC_LEAGUE">Domestic league</option>
              <option value="CUP">Cup</option>
              <option value="INTERNATIONAL">International</option>
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={leagueForm.active} onChange={(e) => setLeagueForm({ ...leagueForm, active: e.target.checked })} />
              Active
            </label>
            <button onClick={saveLeague} style={buttonStyle} disabled={busy}>{busy ? "Saving..." : "Save league"}</button>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {leagues.length === 0 ? <div style={{ color: "#c9d4f6" }}>No leagues yet.</div> : leagues.map((league) => (
              <button
                key={league.id}
                onClick={() => setLeagueForm({ id: league.id, name: league.name, country: league.country, slug: league.slug, competitionType: league.competition_type ?? "DOMESTIC_LEAGUE", teamCount: league.team_count ?? 20, active: league.active ?? true })}
                style={{ textAlign: "left", background: "#0d1529", border: "1px solid #2a3351", borderRadius: 10, padding: 10, color: "#fff" }}
              >
                <div style={{ fontWeight: 700 }}>{league.name}</div>
                <div style={{ color: "#c9d4f6", fontSize: 12 }}>{league.country} · {league.active ? "Active" : "Inactive"}</div>
              </button>
            ))}
          </div>
        </section>

        <section style={{ background: "#121a2c", border: "1px solid #2a3351", borderRadius: 16, padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Teams</h2>
          <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
            <select value={teamForm.leagueId} onChange={(e) => setTeamForm({ ...teamForm, leagueId: e.target.value })} style={inputStyle}>
              <option value="">Select league</option>
              {leagues.map((league) => <option key={league.id} value={league.id}>{league.name}</option>)}
            </select>
            <input value={teamForm.name} onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })} placeholder="Team name" style={inputStyle} />
            <input value={teamForm.shortName} onChange={(e) => setTeamForm({ ...teamForm, shortName: e.target.value })} placeholder="Short name" style={inputStyle} />
            <input value={teamForm.slug} onChange={(e) => setTeamForm({ ...teamForm, slug: e.target.value })} placeholder="Slug" style={inputStyle} />
            <input value={teamForm.stadiumName} onChange={(e) => setTeamForm({ ...teamForm, stadiumName: e.target.value })} placeholder="Stadium name" style={inputStyle} />
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={teamForm.active} onChange={(e) => setTeamForm({ ...teamForm, active: e.target.checked })} />
              Active
            </label>
            <button onClick={saveTeam} style={buttonStyle} disabled={busy}>{busy ? "Saving..." : "Save team"}</button>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {teams.length === 0 ? <div style={{ color: "#c9d4f6" }}>No teams yet.</div> : teams.map((team) => (
              <button
                key={team.id}
                onClick={() => setTeamForm({ id: team.id, leagueId: team.leagueId, name: team.name, shortName: team.shortName, slug: team.slug, stadiumName: team.stadiumName ?? "", active: team.active ?? true })}
                style={{ textAlign: "left", background: "#0d1529", border: "1px solid #2a3351", borderRadius: 10, padding: 10, color: "#fff" }}
              >
                <div style={{ fontWeight: 700 }}>{team.name}</div>
                <div style={{ color: "#c9d4f6", fontSize: 12 }}>{team.leagueName ?? "League"} · {team.active ? "Active" : "Inactive"}</div>
                {team.ratings?.[0] ? (
                  <div style={{ color: "#b8c8c0", fontSize: 12, lineHeight: 1.6, marginTop: 6 }}>
                    {team.ratings[0].seasonName}: overall {team.ratings[0].overallAbility} · attack {team.ratings[0].attackStrength} · defence {team.ratings[0].defenseStrength}<br />
                    creation {team.ratings[0].creationRating} · finishing {team.ratings[0].finishingRating} · goalkeeping {team.ratings[0].goalkeepingRating}<br />
                    pressing {team.ratings[0].pressingRating} · discipline {team.ratings[0].disciplineRating} · form {team.ratings[0].form} · home {team.ratings[0].homeAdvantage}
                  </div>
                ) : <div style={{ color: "#b8c8c0", fontSize: 12, marginTop: 6 }}>No active-season rating</div>}
              </button>
            ))}
          </div>
        </section>
      </div>

      {summary ? (
        <div style={{ marginTop: 24, background: "#121a2c", border: "1px solid #2a3351", borderRadius: 16, padding: 20 }}>
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
      ) : null}

      {error ? <p style={{ color: "#ffb4b4", marginTop: 16 }}>{error}</p> : null}
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 12,
  borderRadius: 10,
  border: "1px solid #384968",
  background: "#0d1529",
  color: "#fff",
};

const buttonStyle: React.CSSProperties = {
  width: "100%",
  padding: 12,
  borderRadius: 10,
  border: "none",
  background: "#1f9dff",
  color: "#fff",
  fontWeight: 700,
  cursor: "pointer",
};
