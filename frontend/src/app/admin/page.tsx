"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";

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

type AdminSummary = {
  world?: {
    status?: string;
    activeSeasonName?: string | null;
    currentRound?: number | null;
    totalRounds?: number | null;
  };
  counts?: {
    leagues?: number;
    teams?: number;
    fixtures?: number;
  };
  recentAudit?: Array<{
    id: string;
    action: string;
    createdAt: string;
    summary: string;
  }>;
};

type AdminLeague = {
  id: string;
  name: string;
  country: string;
  slug: string;
  competition_type?: string | null;
  team_count?: number | null;
  active?: boolean | null;
};

type AdminTeam = {
  id: string;
  leagueId: string;
  name: string;
  shortName: string;
  slug: string;
  stadiumName?: string | null;
  leagueName?: string | null;
  active?: boolean | null;
  ratings?: Array<{
    seasonName: string;
    overallAbility: number;
    attackStrength: number;
    defenseStrength: number;
    creationRating: number;
    finishingRating: number;
    goalkeepingRating: number;
    pressingRating: number;
    disciplineRating: number;
    form: number;
    homeAdvantage: number;
  }>;
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
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [leagues, setLeagues] = useState<AdminLeague[]>([]);
  const [teams, setTeams] = useState<AdminTeam[]>([]);
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

    const payload = await response.json() as AdminSummary;
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
      const leagueRows = await leaguesRes.json() as AdminLeague[];
      setLeagues(leagueRows);
    }

    if (teamsRes.ok) {
      const teamRows = await teamsRes.json() as AdminTeam[];
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
    return <main className={styles.page}><p className={styles.loading} role="status">Checking admin session...</p></main>;
  }

  if (!isAuthenticated) {
    return (
      <main className={styles.loginPage}>
        <section className={styles.loginPanel} aria-labelledby="admin-login-title">
          <Link href="/" className={styles.brand}>SimSoccer <span>Operations</span></Link>
          <h1 id="admin-login-title">Admin access</h1>
          <p className={styles.loginIntro}>Enter your admin PIN to manage the football world.</p>
          <div role="group" aria-label="Four-digit admin PIN" className={styles.pinGroup}>
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
                className={styles.pinInput}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={login}
            disabled={busy || pinDigits.some((digit) => !digit)}
            className={styles.primaryButton}
          >
            {busy ? "Checking..." : "Unlock admin panel"}
          </button>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>SimSoccer operations</p>
          <h1>World control</h1>
        </div>
        <button type="button" onClick={logout} className={styles.secondaryButton}>Log out</button>
      </header>

      {summary ? (
        <section className={styles.metrics} aria-label="World summary">
          {[
            ["World status", summary.world?.status ?? "UNKNOWN"],
            ["Season", summary.world?.activeSeasonName ?? "Not active"],
            ["Round", `${summary.world?.currentRound ?? 0}/${summary.world?.totalRounds ?? 0}`],
            ["Leagues", summary.counts?.leagues ?? 0],
            ["Teams", summary.counts?.teams ?? 0],
            ["Fixtures", summary.counts?.fixtures ?? 0],
          ].map(([label, value]) => (
            <article key={label} className={styles.metric}>
              <h2>{label}</h2>
              <p>{String(value)}</p>
            </article>
          ))}
        </section>
      ) : null}

      <div className={styles.workspace}>
        <section className={styles.panel} aria-labelledby="leagues-title">
          <div className={styles.panelHeading}>
            <div><h2 id="leagues-title">Leagues</h2><p>Create or update competitions.</p></div>
            <span>{leagues.length}</span>
          </div>
          <div className={styles.formGrid}>
            <input aria-label="League name" value={leagueForm.name} onChange={(e) => setLeagueForm({ ...leagueForm, name: e.target.value })} placeholder="League name" className={styles.field} />
            <input aria-label="Country" value={leagueForm.country} onChange={(e) => setLeagueForm({ ...leagueForm, country: e.target.value })} placeholder="Country" className={styles.field} />
            <input aria-label="Slug" value={leagueForm.slug} onChange={(e) => setLeagueForm({ ...leagueForm, slug: e.target.value })} placeholder="Slug" className={styles.field} />
            <input aria-label="Team count" type="number" min={2} max={40} value={leagueForm.teamCount} onChange={(e) => setLeagueForm({ ...leagueForm, teamCount: Number(e.target.value) || 20 })} placeholder="Team count" className={styles.field} />
            <select aria-label="Competition type" value={leagueForm.competitionType} onChange={(e) => setLeagueForm({ ...leagueForm, competitionType: e.target.value })} className={styles.field}>
              <option value="DOMESTIC_LEAGUE">Domestic league</option>
              <option value="CUP">Cup</option>
              <option value="INTERNATIONAL">International</option>
            </select>
            <label className={styles.checkboxField}>
              <input type="checkbox" checked={leagueForm.active} onChange={(e) => setLeagueForm({ ...leagueForm, active: e.target.checked })} />
              Active competition
            </label>
            <button type="button" onClick={saveLeague} className={styles.primaryButton} disabled={busy}>{busy ? "Saving..." : "Save league"}</button>
          </div>

          <div className={styles.recordList}>
            {leagues.length === 0 ? <p className={styles.empty}>No leagues yet.</p> : leagues.map((league) => (
              <button
                type="button"
                key={league.id}
                onClick={() => setLeagueForm({ id: league.id, name: league.name, country: league.country, slug: league.slug, competitionType: league.competition_type ?? "DOMESTIC_LEAGUE", teamCount: league.team_count ?? 20, active: league.active ?? true })}
                className={styles.record}
              >
                <span className={styles.recordTitle}>{league.name}</span>
                <span className={styles.recordMeta}>{league.country} · {league.active ? "Active" : "Inactive"}</span>
              </button>
            ))}
          </div>
        </section>

        <section className={styles.panel} aria-labelledby="teams-title">
          <div className={styles.panelHeading}>
            <div><h2 id="teams-title">Teams</h2><p>Maintain clubs and their ratings.</p></div>
            <span>{teams.length}</span>
          </div>
          <div className={styles.formGrid}>
            <select aria-label="Select league" value={teamForm.leagueId} onChange={(e) => setTeamForm({ ...teamForm, leagueId: e.target.value })} className={styles.field}>
              <option value="">Select league</option>
              {leagues.map((league) => <option key={league.id} value={league.id}>{league.name}</option>)}
            </select>
            <input aria-label="Team name" value={teamForm.name} onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })} placeholder="Team name" className={styles.field} />
            <input aria-label="Short name" value={teamForm.shortName} onChange={(e) => setTeamForm({ ...teamForm, shortName: e.target.value })} placeholder="Short name" className={styles.field} />
            <input aria-label="Slug" value={teamForm.slug} onChange={(e) => setTeamForm({ ...teamForm, slug: e.target.value })} placeholder="Slug" className={styles.field} />
            <input aria-label="Stadium name" value={teamForm.stadiumName} onChange={(e) => setTeamForm({ ...teamForm, stadiumName: e.target.value })} placeholder="Stadium name" className={styles.field} />
            <label className={styles.checkboxField}>
              <input type="checkbox" checked={teamForm.active} onChange={(e) => setTeamForm({ ...teamForm, active: e.target.checked })} />
              Active team
            </label>
            <button type="button" onClick={saveTeam} className={styles.primaryButton} disabled={busy}>{busy ? "Saving..." : "Save team"}</button>
          </div>

          <div className={styles.recordList}>
            {teams.length === 0 ? <p className={styles.empty}>No teams yet.</p> : teams.map((team) => (
              <button
                type="button"
                key={team.id}
                onClick={() => setTeamForm({ id: team.id, leagueId: team.leagueId, name: team.name, shortName: team.shortName, slug: team.slug, stadiumName: team.stadiumName ?? "", active: team.active ?? true })}
                className={styles.record}
              >
                <span className={styles.recordTitle}>{team.name}</span>
                <span className={styles.recordMeta}>{team.leagueName ?? "League"} · {team.active ? "Active" : "Inactive"}</span>
                {team.ratings?.[0] ? (
                  <span className={styles.rating}>
                    {team.ratings[0].seasonName}: overall {team.ratings[0].overallAbility} · attack {team.ratings[0].attackStrength} · defence {team.ratings[0].defenseStrength}<br />
                    creation {team.ratings[0].creationRating} · finishing {team.ratings[0].finishingRating} · goalkeeping {team.ratings[0].goalkeepingRating}<br />
                    pressing {team.ratings[0].pressingRating} · discipline {team.ratings[0].disciplineRating} · form {team.ratings[0].form} · home {team.ratings[0].homeAdvantage}
                  </span>
                ) : <span className={styles.rating}>No active-season rating</span>}
              </button>
            ))}
          </div>
        </section>
      </div>

      {summary ? (
        <section className={styles.auditPanel} aria-labelledby="audit-title">
          <div className={styles.panelHeading}>
            <div><h2 id="audit-title">Recent audit</h2><p>Latest recorded admin changes.</p></div>
          </div>
          <div className={styles.auditList}>
            {(summary.recentAudit ?? []).length === 0 ? (
              <p className={styles.empty}>No audit entries yet.</p>
            ) : (
              summary.recentAudit?.map((entry) => (
                <article key={entry.id} className={styles.auditEntry}>
                  <div className={styles.auditMeta}>
                    <strong>{entry.action}</strong>
                    <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>
                  </div>
                  <p>{entry.summary}</p>
                </article>
              ))
            )}
          </div>
        </section>
      ) : null}

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </main>
  );
}
