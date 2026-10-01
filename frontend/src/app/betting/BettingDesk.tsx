"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import SportsSoccerIcon from "@mui/icons-material/SportsSoccer";
import { formatLocalDateTime, formatLocalTime, useBrowserTimeZone } from "@/lib/time-zone";
import styles from "./BettingDesk.module.css";

type Outcome = {
  id: string;
  outcomeCode: string;
  displayName: string;
  odds: string;
  status: string;
};
type Market = {
  id: string;
  marketType: string;
  marketScope: string;
  status: string;
  outcomes: Outcome[];
};
type Fixture = {
  id: string;
  round: number;
  scheduledAt: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  homeTeam: { id: string; name: string; shortName: string } | null;
  awayTeam: { id: string; name: string; shortName: string } | null;
  league: { id: string; name: string } | null;
  markets: Market[];
};
type MarketResponse = {
  round: number;
  worldRound: number;
  totalRounds?: number;
  currentRoundOpen: boolean;
  defaultRound: number;
  nextRoundAvailable?: boolean;
  serverNow: string;
  cutoffAt: string | null;
  fixtures: Fixture[];
};
type Selection = {
  fixtureId: string;
  marketId: string;
  outcomeId?: string;
  outcomeCode: string;
  round: number;
  scheduledAt: string;
  leagueName: string;
  homeName: string;
  awayName: string;
  marketType: string;
  displayName: string;
  quotedOdds: string;
  currentOdds: string;
  priceChanged: boolean;
  status: string;
};
type BookingResponse = {
  code: string;
  round: number | null;
  cutoffAt: string | null;
  available: boolean;
  selections: Array<{
    fixtureId: string;
    marketId: string;
    outcomeId: string;
    round: number;
    scheduledAt: string;
    league: { id: string; name: string };
    homeTeam: { id: string; name: string; shortName: string } | null;
    awayTeam: { id: string; name: string; shortName: string } | null;
    marketType: string;
    outcomeCode: string;
    displayName: string;
    quotedOdds: string;
    currentOdds: string;
    priceChanged: boolean;
    status: string;
  }>;
};
type FormLine = {
  fixtureId: string;
  scheduledAt: string;
  opponent: string;
  teamScore: number | null;
  opponentScore: number | null;
  outcome: "W" | "D" | "L";
};
type FixtureStatistics = {
  homeTeam: { name: string; sampleSize: number; form: { record: { wins: number; draws: number; losses: number }; matches: FormLine[] } };
  awayTeam: { name: string; sampleSize: number; form: { record: { wins: number; draws: number; losses: number }; matches: FormLine[] } };
  headToHead: {
    sampleSize: number;
    homeWins: number;
    draws: number;
    awayWins: number;
    meetings: Array<{
      fixtureId: string;
      scheduledAt: string;
      homeTeam: string;
      awayTeam: string;
      homeScore: number | null;
      awayScore: number | null;
      resultForSelectedHome: "W" | "D" | "L";
    }>;
  };
};

type QuickMarket = { marketType: string; outcomeCode: string; label: string };
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
const QUICK_MARKETS: QuickMarket[] = [
  { marketType: "1X2", outcomeCode: "1", label: "1" },
  { marketType: "1X2", outcomeCode: "X", label: "X" },
  { marketType: "1X2", outcomeCode: "2", label: "2" },
  { marketType: "DOUBLE_CHANCE", outcomeCode: "1X", label: "1X" },
  { marketType: "DOUBLE_CHANCE", outcomeCode: "12", label: "12" },
  { marketType: "DOUBLE_CHANCE", outcomeCode: "X2", label: "X2" },
  { marketType: "TOTAL_GOALS_2.5", outcomeCode: "OVER_2.5", label: "O 2.5" },
  { marketType: "TOTAL_GOALS_2.5", outcomeCode: "UNDER_2.5", label: "U 2.5" },
];

function formatTimeRemaining(seconds: number) {
  if (seconds <= 0) return "closed";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

async function readApiResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const result = isJson ? await response.json() : null;
  if (!response.ok) {
    throw new Error(result?.message ?? `${fallbackMessage} (HTTP ${response.status}).`);
  }
  if (result === null) throw new Error(fallbackMessage);
  return result as T;
}

function marketLabel(marketType: string) {
  if (marketType.startsWith("TOTAL_GOALS_")) return `Total goals ${marketType.slice("TOTAL_GOALS_".length)}`;
  if (marketType === "1X2") return "Match result";
  if (marketType === "DOUBLE_CHANCE") return "Double chance";
  if (marketType === "BTTS") return "Both teams to score";
  if (marketType === "CORRECT_SCORE") return "Correct score";
  if (marketType === "TOTAL_CORNERS") return "Total corners";
  if (marketType === "TOTAL_CARDS") return "Total cards";
  return marketType.replaceAll("_", " ");
}

function findOutcome(fixture: Fixture, marketType: string, outcomeCode: string) {
  const market = fixture.markets.find((item) => item.marketType === marketType);
  const outcome = market?.outcomes.find((item) => item.outcomeCode === outcomeCode);
  return market && outcome ? { market, outcome } : null;
}

function selectionFromMarket(fixture: Fixture, market: Market, outcome: Outcome): Selection {
  const currentOdds = Number(outcome.odds).toFixed(2);
  return {
    fixtureId: fixture.id,
    marketId: market.id,
    outcomeId: outcome.id,
    outcomeCode: outcome.outcomeCode,
    round: fixture.round,
    scheduledAt: fixture.scheduledAt,
    leagueName: fixture.league?.name ?? "Competition",
    homeName: fixture.homeTeam?.shortName ?? fixture.homeTeam?.name ?? "Home",
    awayName: fixture.awayTeam?.shortName ?? fixture.awayTeam?.name ?? "Away",
    marketType: market.marketType,
    displayName: outcome.displayName,
    quotedOdds: currentOdds,
    currentOdds,
    priceChanged: false,
    status: market.status === "OPEN" && outcome.status === "OPEN" && fixture.status === "SCHEDULED" ? "OPEN" : "SUSPENDED",
  };
}

export default function BettingDesk() {
  const timeZone = useBrowserTimeZone();
  const [data, setData] = useState<MarketResponse | null>(null);
  const [round, setRound] = useState<number | null>(null);
  const [selectedLeagueId, setSelectedLeagueId] = useState("");
  const [selections, setSelections] = useState<Selection[]>([]);
  const [slipView, setSlipView] = useState<"slip" | "booking">("slip");
  const [expandedFixtureId, setExpandedFixtureId] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<"markets" | "statistics">("markets");
  const [fixtureStatistics, setFixtureStatistics] = useState<FixtureStatistics | null>(null);
  const [statisticsLoading, setStatisticsLoading] = useState(false);
  const [mobileSlipOpen, setMobileSlipOpen] = useState(false);
  const [bookingCode, setBookingCode] = useState("");
  const [savedCode, setSavedCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    const load = async () => {
      controller = new AbortController();
      try {
        if (!API_URL) throw new Error("The market service is not configured.");
        const query = round === null ? "" : `?round=${round}`;
        const response = await fetch(`${API_URL}/api/betting/markets${query}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (stopped) return;
        const marketData = await readApiResponse<MarketResponse>(response, "Market service returned an unreadable response.");
        const cutoffPassed = marketData.cutoffAt !== null
          && Date.parse(marketData.serverNow) >= Date.parse(marketData.cutoffAt);
        const currentRoundClosed = !marketData.currentRoundOpen || cutoffPassed;
        const activeRound = currentRoundClosed && marketData.worldRound < (marketData.totalRounds ?? 38)
          ? marketData.worldRound + 1
          : marketData.worldRound;
        if (marketData.round !== activeRound) {
          setRound(activeRound);
          return;
        }
        setData(marketData);
        setRound(activeRound);
        setSelectedLeagueId((current) => current || marketData.fixtures[0]?.league?.id || "");
        setError("");
      } catch (cause) {
        if (!stopped && !(cause instanceof DOMException && cause.name === "AbortError")) {
          setError(cause instanceof Error ? cause.message : "Markets could not be loaded.");
        }
      } finally {
        if (!stopped) {
          setLoading(false);
          timer = setTimeout(load, 15_000);
        }
      }
    };

    void load();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, [round]);

  const leaguesForRound = Array.from(new Map(
    (data?.fixtures ?? []).filter((fixture) => fixture.league).map((fixture) => [fixture.league!.id, fixture.league!]),
  ).values());
  const selectedFixtures = (data?.fixtures ?? []).filter((fixture) => fixture.league?.id === selectedLeagueId);
  const expandedFixture = selectedFixtures.find((fixture) => fixture.id === expandedFixtureId) ?? null;

  function resolveSelection(selection: Selection): Selection {
    const fixture = data?.fixtures.find((item) => item.id === selection.fixtureId);
    const market = fixture?.markets.find((item) => item.id === selection.marketId);
    const outcome = market?.outcomes.find((item) => item.outcomeCode === selection.outcomeCode);
    if (!fixture || !market || !outcome) return { ...selection, status: "SUSPENDED" };
    const currentOdds = Number(outcome.odds).toFixed(2);
    return {
      ...selection,
      currentOdds,
      priceChanged: Number(currentOdds) !== Number(selection.quotedOdds),
      status: market.status === "OPEN" && outcome.status === "OPEN" && fixture.status === "SCHEDULED" ? "OPEN" : "SUSPENDED",
    };
  }

  const resolvedSelections = selections.map(resolveSelection);
  const totalOdds = resolvedSelections.reduce((total, selection) => total * Number(selection.currentOdds), 1);
  const roundedTotalOdds = resolvedSelections.length ? totalOdds.toFixed(2) : "0.00";
  const hasUnavailableLeg = resolvedSelections.some((selection) => selection.status !== "OPEN");
  const hasChangedPrice = resolvedSelections.some((selection) => selection.priceChanged);
  const cutoff = data?.cutoffAt ? formatLocalDateTime(data.cutoffAt, timeZone) : null;
  const cutoffSeconds = data?.cutoffAt && data.serverNow
    ? Math.ceil((Date.parse(data.cutoffAt) - Date.parse(data.serverNow)) / 1000)
    : null;

  function chooseOutcome(fixture: Fixture, market: Market, outcome: Outcome) {
    if (market.status !== "OPEN" || outcome.status !== "OPEN" || fixture.status !== "SCHEDULED") return;
    const next = selectionFromMarket(fixture, market, outcome);
    setSelections((current) => {
      if (current.length && current[0].round !== next.round) {
        setMessage("Selections must be from one world round.");
        return current;
      }
      const existing = current.find((selection) => selection.fixtureId === fixture.id);
      if (existing?.marketId === market.id && existing.outcomeCode === outcome.outcomeCode) {
        setMessage("");
        setSavedCode("");
        return current.filter((selection) => selection.fixtureId !== fixture.id);
      }
      setMessage("");
      setSavedCode("");
      return [...current.filter((selection) => selection.fixtureId !== fixture.id), next];
    });
  }

  async function saveBooking() {
    if (!resolvedSelections.length || hasUnavailableLeg || hasChangedPrice) return;
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${API_URL}/api/betting/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selections: resolvedSelections.map(({ fixtureId, marketId, outcomeCode }) => ({ fixtureId, marketId, outcomeCode })),
        }),
      });
      const booking = await readApiResponse<BookingResponse>(response, "Booking code could not be created.");
      setBookingCode(booking.code);
      setSavedCode(booking.code);
      setMessage("Booking code created.");
      setSlipView("booking");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Booking code could not be created.");
    }
  }

  async function loadBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = bookingCode.trim().toUpperCase();
    if (!code) return;
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${API_URL}/api/betting/bookings/${encodeURIComponent(code)}`, { cache: "no-store" });
      const booking = await readApiResponse<BookingResponse>(response, "Booking code could not be loaded.");
      const loaded = booking.selections.map((selection): Selection => ({
        fixtureId: selection.fixtureId,
        marketId: selection.marketId,
        outcomeId: selection.outcomeId,
        outcomeCode: selection.outcomeCode,
        round: selection.round,
        scheduledAt: selection.scheduledAt,
        leagueName: selection.league.name,
        homeName: selection.homeTeam?.shortName ?? selection.homeTeam?.name ?? "Home",
        awayName: selection.awayTeam?.shortName ?? selection.awayTeam?.name ?? "Away",
        marketType: selection.marketType,
        displayName: selection.displayName,
        quotedOdds: selection.quotedOdds,
        currentOdds: selection.currentOdds,
        priceChanged: selection.priceChanged,
        status: selection.status,
      }));
      setSelections(loaded);
      setSavedCode(booking.code);
      setRound(booking.round);
      setSelectedLeagueId(booking.selections[0]?.league.id ?? "");
      setMessage(booking.available ? "Booking loaded." : "This booking contains unavailable or changed selections.");
      setSlipView("slip");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Booking code could not be loaded.");
    }
  }

  function removeSelection(fixtureId: string) {
    setSelections((current) => current.filter((selection) => selection.fixtureId !== fixtureId));
    setSavedCode("");
  }

  function acceptCurrentPrices() {
    setSelections((current) => current.map((selection) => {
      const resolved = resolveSelection(selection);
      return resolved.status === "OPEN" ? { ...resolved, quotedOdds: resolved.currentOdds, priceChanged: false } : resolved;
    }));
    setSavedCode("");
    setMessage("Current prices accepted for this slip.");
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(savedCode);
      setMessage("Booking code copied.");
    } catch {
      setMessage("Select and copy the booking code.");
    }
  }

  function renderOddsButton(fixture: Fixture, marketType: string, outcomeCode: string, label: string) {
    const result = findOutcome(fixture, marketType, outcomeCode);
    const isSelected = selections.some((selection) =>
      selection.fixtureId === fixture.id && selection.marketId === result?.market.id && selection.outcomeCode === outcomeCode,
    );
    const closed = !result
      || result.market.status !== "OPEN"
      || result.outcome.status !== "OPEN"
      || fixture.status !== "SCHEDULED";
    const accessibleName = result
      ? `${fixture.homeTeam?.name ?? "Home"} versus ${fixture.awayTeam?.name ?? "Away"}, ${result.outcome.displayName}, odds ${Number(result.outcome.odds).toFixed(2)}`
      : `${label}, market unavailable`;

    return (
      <button
        key={`${marketType}-${outcomeCode}`}
        className={`${styles.oddsButton} ${isSelected ? styles.oddsSelected : ""}`}
        type="button"
        disabled={closed}
        aria-label={accessibleName}
        aria-pressed={isSelected}
        onClick={() => result && chooseOutcome(fixture, result.market, result.outcome)}
      >
        {result ? Number(result.outcome.odds).toFixed(2) : "—"}
      </button>
    );
  }

  function renderExpandedMarkets(fixture: Fixture) {
    const markets = fixture.markets.filter((market) => market.status !== "VOID");
    if (!markets.length) return <p className={styles.emptyMarkets}>Markets are being prepared.</p>;
    return (
      <div className={styles.expandedGrid}>
        {markets.map((market) => (
          <section className={styles.marketGroup} key={market.id}>
            <h3>{marketLabel(market.marketType)}</h3>
            <div className={styles.marketOutcomes}>
              {market.outcomes.map((outcome) => {
                const selected = selections.some((selection) =>
                  selection.fixtureId === fixture.id && selection.marketId === market.id && selection.outcomeCode === outcome.outcomeCode,
                );
                const disabled = market.status !== "OPEN" || outcome.status !== "OPEN" || fixture.status !== "SCHEDULED";
                return (
                  <button
                    className={`${styles.expandedOutcome} ${selected ? styles.expandedSelected : ""}`}
                    key={outcome.id}
                    type="button"
                    disabled={disabled}
                    aria-pressed={selected}
                    onClick={() => chooseOutcome(fixture, market, outcome)}
                  >
                    <span>{outcome.displayName}</span>
                    <strong>{Number(outcome.odds).toFixed(2)}</strong>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    );
  }

  async function openStatistics(fixture: Fixture) {
    setExpandedFixtureId(fixture.id);
    setDialogMode("statistics");
    setFixtureStatistics(null);
    setStatisticsLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/betting/fixtures/${fixture.id}/statistics`, { cache: "no-store" });
      setFixtureStatistics(await readApiResponse<FixtureStatistics>(response, "Match statistics are unavailable."));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Match statistics are unavailable.");
    } finally {
      setStatisticsLoading(false);
    }
  }

  function renderForm(teamName: string, sampleSize: number, form: FixtureStatistics["homeTeam"]["form"]) {
    return (
      <section className={styles.formGroup}>
        <div className={styles.statsTitle}>
          <h3>{teamName} recent form</h3>
          <span>{sampleSize} {sampleSize === 1 ? "match" : "matches"}</span>
        </div>
        <p className={styles.formRecord}>{form.record.wins} W <span>{form.record.draws} D</span> {form.record.losses} L</p>
        <div className={styles.formLines}>
          {form.matches.map((match) => (
            <div className={styles.formLine} key={match.fixtureId}>
              <span className={`${styles.formResult} ${styles[`result${match.outcome}`]}`}>{match.outcome}</span>
              <span>{match.opponent}</span>
              <strong>{match.teamScore} - {match.opponentScore}</strong>
            </div>
          ))}
          {!form.matches.length ? <p className={styles.emptyMarkets}>No completed matches yet.</p> : null}
        </div>
      </section>
    );
  }

  function renderStatistics() {
    if (statisticsLoading) return <p className={styles.emptyMarkets}>Loading match history…</p>;
    if (!fixtureStatistics) return <p className={styles.emptyMarkets}>Match statistics are unavailable.</p>;
    return (
      <div className={styles.statsGrid}>
        <section className={styles.h2hGroup}>
          <div className={styles.statsTitle}>
            <h3>Head to head</h3>
            <span>Last {fixtureStatistics.headToHead.sampleSize} meetings</span>
          </div>
          <div className={styles.h2hRecord}>
            <span><strong>{fixtureStatistics.headToHead.homeWins}</strong>{fixtureStatistics.homeTeam.name}</span>
            <span><strong>{fixtureStatistics.headToHead.draws}</strong>Draws</span>
            <span><strong>{fixtureStatistics.headToHead.awayWins}</strong>{fixtureStatistics.awayTeam.name}</span>
          </div>
          <div className={styles.formLines}>
            {fixtureStatistics.headToHead.meetings.map((meeting) => (
              <div className={styles.meetingLine} key={meeting.fixtureId}>
                <time dateTime={meeting.scheduledAt}>{formatLocalDateTime(meeting.scheduledAt, timeZone)}</time>
                <span>{meeting.homeTeam} <strong>{meeting.homeScore} - {meeting.awayScore}</strong> {meeting.awayTeam}</span>
              </div>
            ))}
            {!fixtureStatistics.headToHead.meetings.length ? <p className={styles.emptyMarkets}>No previous meetings in SimSoccer.</p> : null}
          </div>
        </section>
        {renderForm(fixtureStatistics.homeTeam.name, fixtureStatistics.homeTeam.sampleSize, fixtureStatistics.homeTeam.form)}
        {renderForm(fixtureStatistics.awayTeam.name, fixtureStatistics.awayTeam.sampleSize, fixtureStatistics.awayTeam.form)}
      </div>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="SimSoccer home">
          <SportsSoccerIcon aria-hidden="true" />
          <span>SimSoccer</span>
        </Link>
        <div className={styles.headerLinks}>
          <Link href="/">Match centre</Link>
          <span className={styles.worldState}>
            <span aria-hidden="true" />
            Virtual world
          </span>
        </div>
      </header>

      <div className={styles.titleBar}>
        <div>
          <p className={styles.eyebrow}>Markets</p>
          <h1>Football</h1>
        </div>
        <div className={styles.roundStatus} aria-label="Active market round">
          <span>Active market round</span>
          <strong>Round {round ?? "—"}</strong>
        </div>
      </div>

      <div className={styles.desk}>
        <nav className={styles.competitionRail} aria-label="Competitions">
          <h2>Competitions</h2>
          <div className={styles.competitionList}>
            {leaguesForRound.map((league) => (
              <button
                className={selectedLeagueId === league.id ? styles.competitionActive : ""}
                key={league.id}
                type="button"
                aria-pressed={selectedLeagueId === league.id}
                onClick={() => setSelectedLeagueId(league.id)}
              >
                <span className={styles.flag} aria-hidden="true">●</span>
                {league.name}
              </button>
            ))}
            {!leaguesForRound.length && <span className={styles.muted}>No scheduled competitions</span>}
          </div>
        </nav>

        <section className={styles.marketColumn} aria-label="Fixture markets">
          <div className={styles.marketHeading}>
            <div>
              <span className={styles.roundLabel}>{selectedFixtures[0]?.league?.name ?? "World fixtures"} · {timeZone.replaceAll("_", " ")}</span>
              <h2>Round {round ?? "—"}</h2>
            </div>
            <span className={styles.cutoffLabel}>
              {cutoffSeconds !== null
                ? cutoffSeconds > 0
                  ? <>Closes in {formatTimeRemaining(cutoffSeconds)}<small>at {cutoff}</small></>
                  : `Closed at ${cutoff}`
                : "Markets unavailable"}
            </span>
          </div>

          <div className={styles.marketKey} aria-hidden="true">
            <span>Fixture</span>
            {QUICK_MARKETS.map((market) => <span key={`${market.marketType}-${market.outcomeCode}`}>{market.label}</span>)}
            <span />
          </div>

          {error ? <p className={styles.errorBanner} role="alert">{error}</p> : null}
          {message ? <p className={styles.statusBanner} role="status">{message}</p> : null}
          {loading && !data ? <p className={styles.emptyState}>Loading markets…</p> : null}
          {!loading && !error && selectedFixtures.length === 0 ? (
            <p className={styles.emptyState}>No fixtures are scheduled for this round.</p>
          ) : null}

          <div className={styles.fixtureList}>
            {selectedFixtures.map((fixture) => {
              const fixtureCanBet = fixture.status === "SCHEDULED" && fixture.markets.some((market) => market.status === "OPEN");
              return (
                <article className={styles.fixture} key={fixture.id}>
                  <div className={styles.fixtureLine}>
                    <div className={styles.fixtureInfo}>
                      <time dateTime={fixture.scheduledAt}>{formatLocalTime(fixture.scheduledAt, timeZone)}</time>
                      <div className={styles.teams}>
                        <button
                          className={styles.playButton}
                          type="button"
                          aria-label={`Open markets for ${fixture.homeTeam?.name ?? "Home"} versus ${fixture.awayTeam?.name ?? "Away"}`}
                          title="Open match markets"
                          onClick={() => {
                            setDialogMode("markets");
                            setExpandedFixtureId(fixture.id);
                          }}
                        >
                          <PlayArrowIcon aria-hidden="true" />
                        </button>
                        <strong>{fixture.homeTeam?.shortName ?? fixture.homeTeam?.name ?? "Home"}</strong>
                        <span aria-hidden="true">v</span>
                        <strong>{fixture.awayTeam?.shortName ?? fixture.awayTeam?.name ?? "Away"}</strong>
                      </div>
                    </div>
                    {QUICK_MARKETS.map((quick) => renderOddsButton(fixture, quick.marketType, quick.outcomeCode, quick.label))}
                    <button
                      className={styles.moreButton}
                      type="button"
                      aria-label={`More markets for ${fixture.homeTeam?.name ?? "Home"} versus ${fixture.awayTeam?.name ?? "Away"}`}
                      title="More markets"
                      onClick={() => {
                        setDialogMode("markets");
                        setExpandedFixtureId(fixture.id);
                      }}
                    >
                      <ExpandMoreIcon aria-hidden="true" />
                    </button>
                  </div>
                  {!fixtureCanBet ? <span className={styles.fixtureState}>Markets suspended</span> : null}
                </article>
              );
            })}
          </div>
        </section>

        <aside className={styles.slipPanel} data-mobile-open={mobileSlipOpen}>
          <div className={styles.slipTopline}>
            <div>
              <h2>Bet slip <span>{selections.length}</span></h2>
            </div>
            <button
              className={styles.mobileSlipToggle}
              type="button"
              aria-expanded={mobileSlipOpen}
              onClick={() => setMobileSlipOpen((open) => !open)}
            >
              {mobileSlipOpen ? "Close" : "Open"}
            </button>
          </div>

          <div className={styles.slipTabs} role="tablist" aria-label="Slip views">
            <button type="button" role="tab" aria-selected={slipView === "slip"} onClick={() => setSlipView("slip")}>Selections</button>
            <button type="button" role="tab" aria-selected={slipView === "booking"} onClick={() => setSlipView("booking")}>Booking code</button>
          </div>

          <div className={styles.slipContent}>
            {slipView === "slip" ? (
              <>
                {resolvedSelections.length ? (
                  <div className={styles.selectionList}>
                    {resolvedSelections.map((selection) => (
                      <article className={styles.selection} key={selection.fixtureId}>
                        <div className={styles.selectionTitle}>
                          <div>
                            <span>{selection.leagueName} · {formatLocalDateTime(selection.scheduledAt, timeZone)}</span>
                            <strong>{selection.homeName} v {selection.awayName}</strong>
                          </div>
                          <button type="button" aria-label={`Remove ${selection.homeName} versus ${selection.awayName}`} onClick={() => removeSelection(selection.fixtureId)}>
                            <CloseIcon fontSize="small" />
                          </button>
                        </div>
                        <div className={styles.selectionMarket}>
                          <span>{selection.displayName}</span>
                          <strong>{selection.currentOdds}</strong>
                        </div>
                        {selection.status !== "OPEN" ? <p className={styles.selectionWarning}>Suspended for this round</p> : null}
                        {selection.priceChanged ? <p className={styles.selectionWarning}>Price changed from {selection.quotedOdds}</p> : null}
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className={styles.slipEmpty} aria-hidden="true" />
                )}

                <div className={styles.oddsSummary}>
                  <span>Combined odds</span>
                  <strong>{roundedTotalOdds}</strong>
                </div>
                {hasUnavailableLeg ? <p className={styles.selectionWarning}>Remove unavailable selections to save this slip.</p> : null}
                {hasChangedPrice ? (
                  <button className={styles.secondaryAction} type="button" onClick={acceptCurrentPrices}>Accept current prices</button>
                ) : null}
                <button className={styles.primaryAction} type="button" disabled={!resolvedSelections.length || hasUnavailableLeg || hasChangedPrice} onClick={() => void saveBooking()}>
                  Save booking code
                </button>
              </>
            ) : (
              <>
                <form className={styles.bookingForm} onSubmit={(event) => void loadBooking(event)}>
                  <label htmlFor="booking-code">Booking code</label>
                  <div>
                    <input id="booking-code" autoComplete="off" value={bookingCode} onChange={(event) => setBookingCode(event.target.value.toUpperCase())} maxLength={16} />
                    <button type="submit" disabled={!bookingCode.trim()}>Load</button>
                  </div>
                </form>
                {savedCode ? (
                  <div className={styles.savedCode}>
                    <span>Saved code</span>
                    <strong>{savedCode}</strong>
                    <button type="button" aria-label="Copy booking code" title="Copy booking code" onClick={() => void copyCode()}>
                      <ContentCopyIcon fontSize="small" />
                    </button>
                  </div>
                ) : null}
                {message ? <p className={styles.slipMessage} role="status">{message}</p> : null}
                {error ? <p className={styles.slipError} role="alert">{error}</p> : null}
              </>
            )}
          </div>
        </aside>
      </div>

      {expandedFixture ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setExpandedFixtureId(null);
        }}>
          <section className={styles.marketDialog} role="dialog" aria-modal="true" aria-labelledby="more-markets-title">
            <header>
              <div>
                <p>{formatLocalDateTime(expandedFixture.scheduledAt, timeZone)}</p>
                <h2 id="more-markets-title">{expandedFixture.homeTeam?.name} v {expandedFixture.awayTeam?.name}</h2>
              </div>
              <button type="button" aria-label="Close markets" onClick={() => setExpandedFixtureId(null)}><CloseIcon /></button>
            </header>
            <div className={styles.dialogTabs} role="tablist" aria-label="Fixture details">
              <button type="button" role="tab" aria-selected={dialogMode === "markets"} onClick={() => setDialogMode("markets")}>Markets</button>
              <button type="button" role="tab" aria-selected={dialogMode === "statistics"} onClick={() => {
                if (dialogMode !== "statistics") void openStatistics(expandedFixture);
              }}>Statistics</button>
            </div>
            {dialogMode === "markets" ? renderExpandedMarkets(expandedFixture) : renderStatistics()}
          </section>
        </div>
      ) : null}

      <div className={styles.mobileSlipBar} aria-hidden="true">
        <span>{selections.length} selections</span>
        <strong>{roundedTotalOdds}</strong>
        <button type="button" tabIndex={-1} onClick={() => setMobileSlipOpen(true)}>Bet slip</button>
      </div>
    </main>
  );
}
