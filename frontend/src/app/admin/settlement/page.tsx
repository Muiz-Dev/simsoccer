"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "./page.module.css";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

type Overview = {
  currency: string;
  meaning: string;
  tickets: {
    ticket_count: number;
    user_count: number;
    pending_count: number;
    won_count: number;
    lost_count: number;
    void_count: number;
    total_staked_credits: string;
    pending_stake_credits: string;
    pending_potential_return_credits: string;
  };
  settled: {
    settled_stake_credits: string;
    payout_credits: string;
    simulated_book_net_credits: string;
  };
  pendingWork: {
    scheduled_fixtures: number;
    live_fixtures: number;
    finished_unprocessed_fixtures: number;
    fixtures_needing_review: number;
    pending_legs: number;
  };
  rounds: {
    monitored_rounds: number;
    completed_no_bet_rounds: number;
    rounds_needing_review: number;
  };
  customerVirtualCreditBalances: string;
  worker: {
    leader: boolean;
    lastScanAt: string | null;
    lastSuccessfulScanAt: string | null;
    lastFixturesProcessed: number;
    lastTicketsSettled: number;
    consecutiveErrors: number;
    lastError: string | null;
  };
  generatedAt: string;
};

type RoundRow = {
  season_number: number;
  season_name: string;
  league_name: string;
  round: number;
  fixture_count: number;
  settled_fixture_count: number;
  no_bet_fixture_count: number;
  ticket_count: number;
  selection_count: number;
  status: string;
};

type FixtureRow = {
  fixture_id: string;
  round: number;
  fixture_status: string;
  finished_at: string | null;
  home_score: number | null;
  away_score: number | null;
  home_team: string;
  away_team: string;
  league_name: string;
  settlement_status: string | null;
  ticket_count: number | null;
  last_error: string | null;
};

type TicketRow = {
  id: string;
  status: string;
  stake: string;
  total_odds: string;
  potential_payout: string;
  placed_at: string;
  settled_at: string | null;
  selection_count: number;
  pending_selection_count: number;
  won_selection_count: number;
  lost_selection_count: number;
  void_selection_count: number;
  payout_amount: string | null;
};

type ActivityRow = {
  id: string;
  event_type: string;
  details: Record<string, unknown>;
  created_at: string;
  fixture_id: string | null;
  bet_id: string | null;
};

type TicketDetail = {
  ticket: {
    id: string;
    user_id: string;
    status: string;
    stake: string;
    total_odds: string;
    potential_payout: string;
    placed_at: string;
    settled_at: string | null;
    settlement_status: string | null;
    payout_amount: string | null;
  };
  selections: Array<{
    selection_id: string;
    selection_status: string;
    outcome_code: string;
    accepted_odds: string;
    market_type: string;
    display_name: string | null;
    fixture_status: string;
    home_score: number | null;
    away_score: number | null;
    home_team: string;
    away_team: string;
    round: number;
    graded_status: string | null;
    fixture_result_hash: string | null;
    rules_version: string | null;
  }>;
  activity: Array<{ event_type: string; details: Record<string, unknown>; created_at: string }>;
};

type FixtureDetail = {
  fixture: {
    fixture_id: string;
    fixture_status: string;
    season_number: number;
    round: number;
    league_name: string;
    home_team: string;
    away_team: string;
    home_score: number | null;
    away_score: number | null;
    settlement_status: string | null;
    last_error: string | null;
    result_hash: string | null;
  };
  events: Array<{ sequence: number; virtual_minute: number; virtual_second: number; event_type: string }>;
  markets: Array<{
    market_id: string;
    market_type: string;
    outcome_code: string | null;
    display_name: string | null;
    odds: string | null;
    outcome_status: string;
    graded_status: string | null;
    settled_at: string | null;
  }>;
};

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(payload.message || `Settlement request failed (${response.status}).`);
  return payload as T;
}

const credits = (value: string | number | null | undefined) =>
  `${Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} cr`;

const dateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString() : "—";

export default function SettlementAdminPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [fixtures, setFixtures] = useState<FixtureRow[]>([]);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [ticketDetail, setTicketDetail] = useState<TicketDetail | null>(null);
  const [fixtureDetail, setFixtureDetail] = useState<FixtureDetail | null>(null);
  const [selectedTicket, setSelectedTicket] = useState("");
  const [selectedFixture, setSelectedFixture] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");

  const loadDashboard = useCallback(async () => {
    const [overviewResult, roundsResult, fixturesResult, ticketsResult, activityResult] = await Promise.all([
      requestJson<Overview>("/api/settlement/admin/overview"),
      requestJson<{ rounds: RoundRow[] }>("/api/settlement/admin/rounds?limit=50"),
      requestJson<{ fixtures: FixtureRow[] }>("/api/settlement/admin/fixtures?limit=200"),
      requestJson<{ tickets: TicketRow[] }>("/api/settlement/admin/tickets?limit=30"),
      requestJson<{ activity: ActivityRow[] }>("/api/settlement/admin/activity?limit=20"),
    ]);
    setOverview(overviewResult);
    setRounds(roundsResult.rounds);
    setFixtures(fixturesResult.fixtures);
    setTickets(ticketsResult.tickets);
    setActivity(activityResult.activity);
    setLastUpdated(new Date().toISOString());
    setError("");
  }, []);

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const bootstrap = async () => {
      if (!API_URL) {
        setError("NEXT_PUBLIC_API_URL is not configured.");
        setCheckingSession(false);
        setLoading(false);
        return;
      }
      try {
        const session = await fetch(`${API_URL}/api/admin/me`, { credentials: "include", cache: "no-store" });
        if (!session.ok) {
          window.location.replace("/admin");
          return;
        }
        if (!mounted) return;
        setCheckingSession(false);
        await loadDashboard();
        timer = setInterval(() => {
          void loadDashboard().catch((cause: unknown) => {
            if (mounted) setError(cause instanceof Error ? cause.message : "Settlement data could not be refreshed.");
          });
        }, 15000);
      } catch (cause) {
        if (mounted) {
          setError(cause instanceof Error ? cause.message : "Unable to reach the settlement service.");
          setCheckingSession(false);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void bootstrap();
    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, [loadDashboard]);

  const openTicket = async (ticketId: string) => {
    setSelectedTicket(ticketId);
    setTicketDetail(null);
    try {
      setTicketDetail(await requestJson<TicketDetail>(`/api/settlement/admin/tickets/${encodeURIComponent(ticketId)}`));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ticket details could not be loaded.");
    }
  };

  const openFixture = async (fixtureId: string) => {
    setSelectedFixture(fixtureId);
    setFixtureDetail(null);
    try {
      setFixtureDetail(await requestJson<FixtureDetail>(
        `/api/settlement/admin/fixtures/${encodeURIComponent(fixtureId)}`,
      ));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Fixture details could not be loaded.");
    }
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>SimSoccer operations / ledger view</p>
          <h1>Settlement desk</h1>
          <p className={styles.subtitle}>Ticket grading, virtual-credit exposure, and the worker’s audit trail.</p>
        </div>
        <nav className={styles.headerActions} aria-label="Admin navigation">
          <Link href="/admin" className={styles.secondaryButton}>World control</Link>
          <Link href="/admin" className={styles.secondaryButton}>Admin home</Link>
        </nav>
      </header>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {checkingSession || loading ? (
        <section className={styles.loading} aria-live="polite">Connecting to the settlement service…</section>
      ) : overview ? (
        <>
          <section className={styles.workerBanner} aria-label="Settlement worker status">
            <div className={styles.workerStatus}>
              <span className={overview.worker.consecutiveErrors ? styles.signalWarning : styles.signal} />
              <div>
                <strong>{overview.worker.leader ? "Worker is active" : "Worker is running — standby instance"}</strong>
                <span>Last successful scan {dateTime(overview.worker.lastSuccessfulScanAt)}</span>
              </div>
            </div>
            <div className={styles.workerMeta}>
              <span>Latest scan {dateTime(overview.worker.lastScanAt)}</span>
              <span>Refreshed {dateTime(lastUpdated)}</span>
            </div>
          </section>

          <p className={styles.creditNotice}>{overview.meaning}</p>

          <section className={styles.metrics} aria-label="Settlement totals">
            <Metric label="Tickets in system" value={overview.tickets.ticket_count} note={`${overview.tickets.user_count} users`} />
            <Metric label="Awaiting results" value={overview.tickets.pending_count} note={`${overview.pendingWork.pending_legs} pending selections`} />
            <Metric label="Won / lost / void" value={`${overview.tickets.won_count} / ${overview.tickets.lost_count} / ${overview.tickets.void_count}`} note="Final ticket outcomes" />
            <Metric label="Total staked" value={credits(overview.tickets.total_staked_credits)} note="All ticket stakes" />
            <Metric label="Pending exposure" value={credits(overview.tickets.pending_potential_return_credits)} note={`${credits(overview.tickets.pending_stake_credits)} pending stake`} />
            <Metric label="Settled book net" value={credits(overview.settled.simulated_book_net_credits)} note={`${credits(overview.settled.payout_credits)} paid out`} />
          </section>

          <section className={styles.queueStrip} aria-label="Settlement workload">
            <div><strong>{overview.pendingWork.scheduled_fixtures}</strong><span>Scheduled</span></div>
            <div><strong>{overview.pendingWork.live_fixtures}</strong><span>Live</span></div>
            <div><strong>{overview.pendingWork.finished_unprocessed_fixtures}</strong><span>Finished or cancelled, awaiting grading</span></div>
            <div><strong>{overview.pendingWork.fixtures_needing_review + overview.rounds.rounds_needing_review}</strong><span>Needs review</span></div>
            <div><strong>{overview.rounds.completed_no_bet_rounds}</strong><span>No-bet rounds recorded</span></div>
          </section>

          {overview.worker.lastError && (
            <div className={styles.error} role="status">Latest worker error: {overview.worker.lastError}</div>
          )}

          <div className={styles.mainGrid}>
            <section className={styles.panel}>
              <PanelHeading title="Recent tickets" detail="Open a ticket to inspect each pick and its recorded grading." count={tickets.length} />
              <div className={styles.tableScroll}>
                <table>
                  <thead><tr><th>Ticket</th><th>Status</th><th>Stake</th><th>Possible return</th><th>Legs</th><th>Placed</th></tr></thead>
                  <tbody>
                    {tickets.map((ticket) => (
                      <tr key={ticket.id} className={selectedTicket === ticket.id ? styles.selectedRow : undefined}>
                        <td><button className={styles.rowLink} onClick={() => void openTicket(ticket.id)}>{ticket.id.slice(0, 10)}</button></td>
                        <td><Status value={ticket.status} /></td>
                        <td>{credits(ticket.stake)}</td>
                        <td>{credits(ticket.potential_payout)}</td>
                        <td>{ticket.pending_selection_count} pending / {ticket.selection_count} total</td>
                        <td>{dateTime(ticket.placed_at)}</td>
                      </tr>
                    ))}
                    {!tickets.length && <EmptyRow columns={6} message="No tickets recorded yet." />}
                  </tbody>
                </table>
              </div>
              {selectedTicket && (
                <div className={styles.ticketDetail}>
                  <div className={styles.detailHeading}>
                    <div><span className={styles.kicker}>Ticket detail</span><h3>{selectedTicket}</h3></div>
                    <button className={styles.closeButton} onClick={() => { setSelectedTicket(""); setTicketDetail(null); }}>Close</button>
                  </div>
                  {!ticketDetail ? <p className={styles.muted}>Loading ticket record…</p> : (
                    <>
                      <p className={styles.detailSummary}>
                        {ticketDetail.ticket.status} · stake {credits(ticketDetail.ticket.stake)} ·
                        payout {credits(ticketDetail.ticket.payout_amount)} · {ticketDetail.selections.length} selections
                      </p>
                      <div className={styles.legList}>
                        {ticketDetail.selections.map((leg) => (
                          <article className={styles.leg} key={leg.selection_id}>
                            <div>
                              <strong>{leg.home_team} {leg.home_score ?? "–"}–{leg.away_score ?? "–"} {leg.away_team}</strong>
                              <span>Round {leg.round} · {leg.market_type} · {leg.display_name ?? leg.outcome_code}</span>
                            </div>
                            <div className={styles.legResult}>
                              <Status value={leg.graded_status ?? leg.selection_status} />
                              <span>Accepted {leg.accepted_odds}×</span>
                            </div>
                          </article>
                        ))}
                      </div>
                      <p className={styles.hash}>Rules and result hashes are retained in the ticket’s settlement record.</p>
                    </>
                  )}
                </div>
              )}
            </section>

            <section className={styles.panel}>
              <PanelHeading title="Round ledger" detail="Settlement coverage and no-bet round footprints." count={rounds.length} />
              <div className={styles.roundList}>
                {rounds.map((round) => (
                  <article className={styles.round} key={`${round.season_number}-${round.league_name}-${round.round}`}>
                    <div><span className={styles.kicker}>Season {round.season_number} · Round {round.round}</span><strong>{round.league_name}</strong></div>
                    <Status value={round.status} />
                    <small>{round.settled_fixture_count}/{round.fixture_count} processed · {round.no_bet_fixture_count} no-bet · {round.ticket_count} tickets</small>
                  </article>
                ))}
                {!rounds.length && <p className={styles.empty}>No rounds have been reconciled.</p>}
              </div>
            </section>

            <section className={styles.panel}>
              <PanelHeading title="Fixture reconciliation" detail="Most recently scheduled fixtures and settlement status." count={fixtures.length} />
              <div className={styles.fixtureList}>
                {fixtures.map((fixture) => (
                  <article className={styles.fixture} key={fixture.fixture_id}>
                    <div className={styles.fixtureTeams}>
                      <button type="button" className={styles.rowLink} onClick={() => void openFixture(fixture.fixture_id)}>
                        {fixture.home_team} <b>{fixture.home_score ?? "–"}–{fixture.away_score ?? "–"}</b> {fixture.away_team}
                      </button>
                      <small>{fixture.league_name} · Round {fixture.round} · {dateTime(fixture.finished_at)}</small>
                    </div>
                    <div className={styles.fixtureStatus}>
                      <Status value={fixture.settlement_status ?? fixture.fixture_status} />
                      <small>{fixture.ticket_count ?? 0} tickets</small>
                    </div>
                    {fixture.last_error && <p className={styles.fixtureError}>{fixture.last_error}</p>}
                  </article>
                ))}
                {!fixtures.length && <p className={styles.empty}>No fixtures have been reconciled.</p>}
              </div>
              {selectedFixture && (
                <div className={styles.ticketDetail}>
                  <div className={styles.detailHeading}>
                    <div><span className={styles.kicker}>Fixture record</span><h3>{selectedFixture}</h3></div>
                    <button className={styles.closeButton} onClick={() => { setSelectedFixture(""); setFixtureDetail(null); }}>Close</button>
                  </div>
                  {!fixtureDetail ? <p className={styles.muted}>Loading fixture record…</p> : (
                    <>
                      <p className={styles.detailSummary}>
                        {fixtureDetail.fixture.league_name} · Season {fixtureDetail.fixture.season_number} ·
                        Round {fixtureDetail.fixture.round} · {fixtureDetail.fixture.home_team}{" "}
                        {fixtureDetail.fixture.home_score ?? "–"}–{fixtureDetail.fixture.away_score ?? "–"}{" "}
                        {fixtureDetail.fixture.away_team}
                      </p>
                      {fixtureDetail.fixture.last_error && (
                        <p className={styles.fixtureError}>{fixtureDetail.fixture.last_error}</p>
                      )}
                      <h3>Graded market outcomes</h3>
                      <div className={styles.legList}>
                        {fixtureDetail.markets.map((market, index) => (
                          <article className={styles.leg} key={`${market.market_id}-${market.outcome_code ?? index}`}>
                            <div>
                              <strong>{market.market_type} · {market.display_name ?? market.outcome_code ?? "No outcome"}</strong>
                              <span>{market.outcome_code ?? "—"} · {market.odds ? `${market.odds}×` : "No price"}</span>
                            </div>
                            <div className={styles.legResult}>
                              <Status value={market.graded_status ?? market.outcome_status} />
                            </div>
                          </article>
                        ))}
                        {!fixtureDetail.markets.length && <p className={styles.empty}>No markets were recorded for this fixture.</p>}
                      </div>
                      <h3>Match events</h3>
                      <ol className={styles.activity}>
                        {fixtureDetail.events.map((event) => (
                          <li key={event.sequence}>
                            <span className={styles.activityMark} />
                            <div><strong>{event.event_type.replaceAll("_", " ")}</strong>
                              <small>Minute {event.virtual_minute}:{String(event.virtual_second).padStart(2, "0")}</small>
                            </div>
                            <span>#{event.sequence}</span>
                          </li>
                        ))}
                        {!fixtureDetail.events.length && <li className={styles.empty}>No match events were recorded.</li>}
                      </ol>
                      <p className={styles.hash}>Result fingerprint: {fixtureDetail.fixture.result_hash ?? "not available"}</p>
                    </>
                  )}
                </div>
              )}
            </section>

            <section className={styles.panel}>
              <PanelHeading title="Audit activity" detail="Idempotent records of settlement and reconciliation decisions." count={activity.length} />
              <ol className={styles.activity}>
                {activity.map((item) => (
                  <li key={item.id}>
                    <span className={styles.activityMark} />
                    <div><strong>{item.event_type.replaceAll("_", " ")}</strong>
                      <small>{item.bet_id ? `Ticket ${item.bet_id.slice(0, 10)}` : item.fixture_id ? `Fixture ${item.fixture_id.slice(0, 10)}` : "Settlement service"}</small>
                    </div>
                    <time>{dateTime(item.created_at)}</time>
                  </li>
                ))}
                {!activity.length && <li className={styles.empty}>No settlement activity recorded yet.</li>}
              </ol>
            </section>
          </div>
          <footer className={styles.footer}>
            {overview.worker.consecutiveErrors} consecutive worker errors ·
            {overview.worker.lastFixturesProcessed} fixtures and {overview.worker.lastTicketsSettled} tickets in last scan ·
            Customer virtual-credit balances {credits(overview.customerVirtualCreditBalances)}
          </footer>
        </>
      ) : (
        <section className={styles.unavailable}>
          <span className={styles.signalWarning} />
          <h2>Settlement data unavailable</h2>
          <p>The admin session is valid, but the settlement service did not return its operations data. The live world and accounts processes remain independent.</p>
          <button className={styles.retryButton} onClick={() => { setLoading(true); void loadDashboard().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Settlement data could not be loaded.")).finally(() => setLoading(false)); }}>Retry</button>
        </section>
      )}
    </main>
  );
}

function Metric({ label, value, note }: { label: string; value: string | number; note: string }) {
  return <article className={styles.metric}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function PanelHeading({ title, detail, count }: { title: string; detail: string; count: number }) {
  return <div className={styles.panelHeading}><div><h2>{title}</h2><p>{detail}</p></div><span>{count}</span></div>;
}

function Status({ value }: { value: string }) {
  const normalized = value.toLowerCase().replaceAll("_", "-");
  return <span className={`${styles.status} ${styles[`status_${normalized}`] ?? ""}`}>{value.replaceAll("_", " ")}</span>;
}

function EmptyRow({ columns, message }: { columns: number; message: string }) {
  return <tr><td colSpan={columns} className={styles.empty}>{message}</td></tr>;
}
