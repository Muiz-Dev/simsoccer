"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Skeleton from "@mui/material/Skeleton";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import NavigateBeforeIcon from "@mui/icons-material/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import HistoryIcon from "@mui/icons-material/History";
import LiveTvIcon from "@mui/icons-material/LiveTv";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import RefreshIcon from "@mui/icons-material/Refresh";
import SportsSoccerIcon from "@mui/icons-material/SportsSoccer";
import SignalWifiStatusbar4BarIcon from "@mui/icons-material/SignalWifiStatusbar4Bar";
import AuthAction from "@/components/AuthAction";
import { formatLocalDateTime, useBrowserTimeZone } from "@/lib/time-zone";
import type { Fixture, Standing, WorldOverview } from "@/contexts/WorldDataContext";
import { useWorldData } from "@/contexts/WorldDataContext";
import styles from "./MatchCentre.module.css";

export type MatchCentreView = "live" | "fixtures" | "results" | "table";
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

type NavItem = { href: string; label: string; icon: typeof LiveTvIcon };
type MatchStatRow = {
  label: string;
  home: number;
  away: number;
  homeCards?: { yellow: number; red: number };
  awayCards?: { yellow: number; red: number };
};

const navigation: NavItem[] = [
  { href: "/live", label: "Live", icon: LiveTvIcon },
  { href: "/fixtures", label: "Fixtures", icon: CalendarMonthIcon },
  { href: "/results", label: "Results", icon: HistoryIcon },
  { href: "/table", label: "Table", icon: FormatListNumberedIcon },
  { href: "/bets", label: "My bets", icon: ReceiptLongIcon },
];

function MatchRow({ fixture, serverNow, timeZone, detailsEnabled = false }: {
  fixture: Fixture;
  serverNow: number;
  timeZone: string;
  detailsEnabled?: boolean;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const isLive = fixture.status === "LIVE";
  const isFinished = fixture.status === "FINISHED";
  const startAt = fixture.startedAt ? Date.parse(fixture.startedAt) : Date.parse(fixture.scheduledAt);
  const wallElapsed = isLive && serverNow > 0 ? Math.max(0, (serverNow - startAt) / 1000) : 0;
  const wallSecond = Math.min(5400, Math.floor(wallElapsed));
  const matchSecond = Math.min(5400, Math.max(fixture.virtualSecond, wallSecond));
  const clockDelaySeconds = Math.max(0, wallSecond - fixture.virtualSecond);
  const finalizing = isLive && wallSecond >= 5400;
  const clockDelayed = isLive && !finalizing && clockDelaySeconds >= 120;
  const minute = Math.min(90, Math.floor(matchSecond / 60));
  const scheduled = !isLive && !isFinished;
  const homeName = fixture.homeTeam?.name ?? "Home team";
  const awayName = fixture.awayTeam?.name ?? "Away team";
  const matchRow = (
    <div className={styles.matchRow}>
      <div className={styles.matchTime}>
        {isFinished ? (
          <span className={styles.finished}>Full time</span>
        ) : finalizing ? (
          <>
            <span className={styles.finalizing}>Finalizing</span>
            <span className={styles.minute}>90&apos;</span>
          </>
        ) : isLive ? (
          <>
            <span className={clockDelayed ? styles.delayed : styles.live}>
              <span aria-hidden="true" className={clockDelayed ? styles.delayedDot : styles.liveDot} />
              {clockDelayed ? "Delayed" : "Live"}
            </span>
            <span className={styles.minute}>{minute}&apos;</span>
            {clockDelayed ? <span className={styles.lag}>+{Math.ceil(clockDelaySeconds / 60)}m</span> : null}
          </>
        ) : (
          <span className={styles.kickoff}>{formatLocalDateTime(fixture.scheduledAt, timeZone)}</span>
        )}
      </div>
      <div className={styles.matchLine} aria-label={`${homeName} ${scheduled ? "versus" : `${fixture.homeScore} to ${fixture.awayScore}`} ${awayName}`}>
        <span
          className={`${styles.teamName} ${styles.homeTeam} ${isLive || isFinished ? (fixture.homeScore > fixture.awayScore ? styles.winner : "") : ""}`}
          title={homeName}
        >
          <span className={styles.fullName}>{homeName}</span>
          <span className={styles.shortName}>{fixture.homeTeam?.shortName ?? homeName}</span>
        </span>
        {scheduled ? (
          <span className={styles.versus}>vs</span>
        ) : (
          <span className={styles.score}>
            {fixture.homeScore}<span className={styles.scoreColon}>:</span>{fixture.awayScore}
          </span>
        )}
        <span
          className={`${styles.teamName} ${styles.awayTeam} ${isLive || isFinished ? (fixture.awayScore > fixture.homeScore ? styles.winner : "") : ""}`}
          title={awayName}
        >
          <span className={styles.fullName}>{awayName}</span>
          <span className={styles.shortName}>{fixture.awayTeam?.shortName ?? awayName}</span>
        </span>
      </div>
    </div>
  );

  if (!detailsEnabled) return matchRow;

  const goalMarkers = fixture.matchEvents
    ? fixture.matchEvents
      .filter((event) => event.eventType === "GOAL")
      .map((event) => ({ sequence: event.sequence, minute: event.virtualMinute, teamId: event.teamId }))
    : (fixture.goalEvents ?? []).map((goal) => ({
      sequence: goal.sequence,
      minute: goal.minute,
      teamId: goal.teamId,
    }));
  const homeGoals = goalMarkers.filter((goal) => goal.teamId === fixture.homeTeam?.id);
  const awayGoals = goalMarkers.filter((goal) => goal.teamId === fixture.awayTeam?.id);
  const stats = getDisplayedMatchStatistics(fixture);
  const detailsId = `match-details-${fixture.id}`;
  return (
    <article className={styles.resultMatch}>
      <button
        type="button"
        className={styles.resultMatchToggle}
        aria-expanded={detailsOpen}
        aria-controls={detailsId}
        aria-label={`${homeName} ${fixture.homeScore} to ${fixture.awayScore} ${awayName}. ${detailsOpen ? "Hide" : "Show"} match details.`}
        onClick={() => setDetailsOpen((open) => !open)}
      >
        {matchRow}
        <ExpandMoreIcon className={detailsOpen ? styles.timelineChevronOpen : styles.timelineChevron} aria-hidden="true" />
      </button>
      {detailsOpen ? (
        <div className={styles.matchDetails} id={detailsId}>
          <div className={styles.goalMarkers} aria-label="Goals">
            <div
              className={styles.goalMarkersHome}
              role="list"
              aria-label={`${homeName} goals`}
              tabIndex={homeGoals.length > 1 ? 0 : undefined}
            >
              {homeGoals.map((goal) => (
                <span
                  className={styles.goalMarker}
                  key={goal.sequence}
                  role="listitem"
                  aria-label={`${goal.minute} minute goal`}
                  title={`${goal.minute}'`}
                >
                  <SportsSoccerIcon className={styles.goalMarkerIcon} aria-hidden="true" />
                  <span>{goal.minute}&apos;</span>
                </span>
              ))}
            </div>
            <div aria-hidden="true" />
            <div
              className={styles.goalMarkersAway}
              role="list"
              aria-label={`${awayName} goals`}
              tabIndex={awayGoals.length > 1 ? 0 : undefined}
            >
              {awayGoals.map((goal) => (
                <span
                  className={styles.goalMarker}
                  key={goal.sequence}
                  role="listitem"
                  aria-label={`${goal.minute} minute goal`}
                  title={`${goal.minute}'`}
                >
                  <SportsSoccerIcon className={styles.goalMarkerIcon} aria-hidden="true" />
                  <span>{goal.minute}&apos;</span>
                </span>
              ))}
            </div>
          </div>
          <table className={styles.matchStats} aria-label="Match statistics">
            <tbody>
              {stats.map((row) => {
                const total = row.home + row.away;
                const homeShare = total > 0 ? (row.home / total) * 100 : 50;
                return (
                  <tr key={row.label}>
                    <td className={styles.statValue}>
                      <MatchStatValue row={row} side="home" />
                    </td>
                    <th scope="row" className={styles.statCenter}>
                      <span className={styles.statLabel}>{row.label}</span>
                      <span className={styles.statMeter} aria-hidden="true">
                        <span className={styles.statMeterHome} style={{ width: `${homeShare}%` }} />
                        <span className={styles.statMeterAway} style={{ width: `${100 - homeShare}%` }} />
                      </span>
                    </th>
                    <td className={styles.statValue}>
                      <MatchStatValue row={row} side="away" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </article>
  );
}

function getDisplayedMatchStatistics(fixture: Fixture): MatchStatRow[] {
  const finalStats = fixture.matchStatistics;
  if (finalStats) {
    return [
      { label: "Shots", home: finalStats.homeShots, away: finalStats.awayShots },
      { label: "On target", home: finalStats.homeShotsOnTarget, away: finalStats.awayShotsOnTarget },
      { label: "Corners", home: finalStats.homeCorners, away: finalStats.awayCorners },
      { label: "Fouls", home: finalStats.homeFouls, away: finalStats.awayFouls },
      {
        label: "Cards",
        home: finalStats.homeYellowCards + finalStats.homeRedCards,
        away: finalStats.awayYellowCards + finalStats.awayRedCards,
        homeCards: { yellow: finalStats.homeYellowCards, red: finalStats.homeRedCards },
        awayCards: { yellow: finalStats.awayYellowCards, red: finalStats.awayRedCards },
      },
    ];
  }

  const totals = new Map<string, {
    shots: number;
    shotsOnTarget: number;
    corners: number;
    fouls: number;
    yellowCards: number;
    redCards: number;
  }>();
  for (const teamId of [fixture.homeTeam?.id, fixture.awayTeam?.id]) {
    if (teamId) totals.set(teamId, { shots: 0, shotsOnTarget: 0, corners: 0, fouls: 0, yellowCards: 0, redCards: 0 });
  }
  for (const event of fixture.matchEvents ?? []) {
    const teamStats = event.teamId ? totals.get(event.teamId) : undefined;
    if (!teamStats) continue;
    if (["GOAL", "SHOT", "SHOT_ON_TARGET"].includes(event.eventType)) teamStats.shots++;
    if (event.eventType === "GOAL" || event.eventType === "SHOT_ON_TARGET") teamStats.shotsOnTarget++;
    if (event.eventType === "CORNER") teamStats.corners++;
    if (event.eventType === "FOUL" || ["YELLOW_CARD", "RED_CARD"].includes(event.eventType)) teamStats.fouls++;
    if (event.eventType === "YELLOW_CARD" || event.metadata?.secondYellowDismissal === true) teamStats.yellowCards++;
    if (event.eventType === "RED_CARD") teamStats.redCards++;
  }
  const home = fixture.homeTeam ? totals.get(fixture.homeTeam.id) : undefined;
  const away = fixture.awayTeam ? totals.get(fixture.awayTeam.id) : undefined;
  return [
    { label: "Shots", home: home?.shots ?? 0, away: away?.shots ?? 0 },
    { label: "On target", home: home?.shotsOnTarget ?? 0, away: away?.shotsOnTarget ?? 0 },
    { label: "Corners", home: home?.corners ?? 0, away: away?.corners ?? 0 },
    { label: "Fouls", home: home?.fouls ?? 0, away: away?.fouls ?? 0 },
    {
      label: "Cards",
      home: (home?.yellowCards ?? 0) + (home?.redCards ?? 0),
      away: (away?.yellowCards ?? 0) + (away?.redCards ?? 0),
      homeCards: { yellow: home?.yellowCards ?? 0, red: home?.redCards ?? 0 },
      awayCards: { yellow: away?.yellowCards ?? 0, red: away?.redCards ?? 0 },
    },
  ];
}

function MatchStatValue({ row, side }: { row: MatchStatRow; side: "home" | "away" }) {
  const cards = side === "home" ? row.homeCards : row.awayCards;
  if (!cards) return <>{row[side]}</>;
  return (
    <span className={styles.statCards} aria-label={`${cards.yellow} yellow, ${cards.red} red`}>
      <span className={styles.statCard}>
        <span className={`${styles.statCardMark} ${styles.statCardYellow}`} aria-hidden="true" />
        {cards.yellow}
      </span>
      <span className={styles.statCard}>
        <span className={`${styles.statCardMark} ${styles.statCardRed}`} aria-hidden="true" />
        {cards.red}
      </span>
    </span>
  );
}

function MatchSkeletonList({ count = 5 }: { count?: number }) {
  return (
    <div className={styles.matchList} role="status" aria-label="Loading matches">
      {Array.from({ length: count }, (_, index) => (
        <div className={styles.matchRow} key={index} aria-hidden="true">
          <div className={styles.matchTime}><Skeleton variant="rectangular" width={52} height={13} /></div>
          <div className={styles.matchLine}>
            <Skeleton className={styles.homeSkeleton} variant="rectangular" height={15} />
            <Skeleton className={styles.middleSkeleton} variant="rectangular" width={34} height={20} />
            <Skeleton className={styles.awaySkeleton} variant="rectangular" height={15} />
          </div>
        </div>
      ))}
    </div>
  );
}

function GoalTicker({ goals }: { goals: Array<{ id: string; minute: number; team: string; match: string }> }) {
  if (!goals.length) return null;

  const items = (hidden: boolean) => (
    <ul className={styles.goalTickerGroup} aria-hidden={hidden || undefined}>
      {goals.map((goal) => (
        <li key={goal.id}>
          <SportsSoccerIcon aria-hidden="true" />
          <span>{goal.minute}&apos;</span>
          <strong>{goal.team}</strong>
          <span className={styles.tickerMatchup}>{goal.match}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <aside className={styles.goalTicker} aria-label="Latest live goals">
      <div className={styles.goalTickerViewport}>
        <div className={styles.goalTickerTrack}>
          {items(false)}
          {items(true)}
        </div>
      </div>
    </aside>
  );
}

function StandingsTable({ rows }: { rows: Standing[] }) {
  if (!rows.length) return <p className={styles.empty}>Standings will appear when this season is active.</p>;

  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col" className={styles.clubHead}>Club</th>
            <th scope="col">P</th>
            <th scope="col" className={styles.compactColumn}>W</th>
            <th scope="col" className={styles.compactColumn}>D</th>
            <th scope="col" className={styles.compactColumn}>L</th>
            <th scope="col" className={styles.smallColumn}>GD</th>
            <th scope="col">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.teamId}>
              <td className={row.position <= 4 ? styles.topPosition : ""}>{row.position}</td>
              <th scope="row" className={styles.clubName}>{row.teamName}</th>
              <td>{row.played}</td>
              <td className={styles.compactColumn}>{row.won}</td>
              <td className={styles.compactColumn}>{row.drawn}</td>
              <td className={styles.compactColumn}>{row.lost}</td>
              <td className={styles.smallColumn}>{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</td>
              <td className={styles.points}>{row.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StandingsSkeleton() {
  return (
    <div className={styles.tableScroll} role="status" aria-label="Loading league table">
      <table className={styles.table} aria-hidden="true">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col" className={styles.clubHead}>Club</th>
            <th scope="col">P</th>
            <th scope="col" className={styles.compactColumn}>W</th>
            <th scope="col" className={styles.compactColumn}>D</th>
            <th scope="col" className={styles.compactColumn}>L</th>
            <th scope="col" className={styles.smallColumn}>GD</th>
            <th scope="col">Pts</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 8 }, (_, index) => (
            <tr key={index}>
              <td><Skeleton variant="rectangular" width={14} height={13} /></td>
              <td><Skeleton variant="rectangular" width={`${48 + (index % 3) * 12}%`} height={13} /></td>
              <td><Skeleton variant="rectangular" width={14} height={13} /></td>
              <td className={styles.compactColumn}><Skeleton variant="rectangular" width={14} height={13} /></td>
              <td className={styles.compactColumn}><Skeleton variant="rectangular" width={14} height={13} /></td>
              <td className={styles.compactColumn}><Skeleton variant="rectangular" width={14} height={13} /></td>
              <td className={styles.smallColumn}><Skeleton variant="rectangular" width={18} height={13} /></td>
              <td><Skeleton variant="rectangular" width={18} height={13} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FixtureList({ fixtures, serverNow, loading, timeZone }: { fixtures: Fixture[]; serverNow: number; loading: boolean; timeZone: string }) {
  if (loading) return <MatchSkeletonList />;
  if (fixtures.length === 0) return <p className={styles.empty}>No fixtures are scheduled.</p>;

  return (
    <div className={styles.matchList}>
      {fixtures.map((fixture) => (
        <MatchRow key={fixture.id} fixture={fixture} serverNow={serverNow} timeZone={timeZone} />
      ))}
    </div>
  );
}

function ResultsList({ fixtures, serverNow, loading, timeZone }: { fixtures: Fixture[]; serverNow: number; loading: boolean; timeZone: string }) {
  if (loading) return <MatchSkeletonList />;
  if (fixtures.length === 0) return <p className={styles.empty}>No completed results yet.</p>;

  return (
    <div className={styles.matchList}>
      {fixtures.map((fixture) => (
        <MatchRow key={fixture.id} fixture={fixture} serverNow={serverNow} timeZone={timeZone} detailsEnabled />
      ))}
    </div>
  );
}

export default function MatchCentre({ view }: { view: MatchCentreView }) {
  const pathname = usePathname();
  const timeZone = useBrowserTimeZone();
  const pageRef = useRef<HTMLElement>(null);
  const animated = useRef(false);
  const {
    overview,
    selectedLeague: activeSelectedLeague,
    selectedLeagueId,
    setSelectedLeagueId,
    refresh,
    error,
    serverNow,
  } = useWorldData();
  const [selectedSeasonNumber, setSelectedSeasonNumber] = useState<number | null>(null);
  const [resultRound, setResultRound] = useState<number | null>(null);
  const [seasonOverview, setSeasonOverview] = useState<WorldOverview | null>(null);
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [seasonError, setSeasonError] = useState("");

  useGSAP(() => {
    if (animated.current || !pageRef.current) return;
    animated.current = true;
    const motion = gsap.matchMedia();
    motion.add("(prefers-reduced-motion: no-preference)", () => {
      const targets = pageRef.current?.querySelectorAll("[data-enter]");
      if (targets?.length) gsap.fromTo(targets, { autoAlpha: 0, y: 5 }, { autoAlpha: 1, y: 0, duration: 0.28, stagger: 0.04, ease: "power2.out" });
    });
    return () => motion.revert();
  }, { scope: pageRef });

  const activeSeasonNumber = overview?.leagues[0]?.season?.seasonNumber ?? null;

  const effectiveSeasonNumber = selectedSeasonNumber ?? activeSeasonNumber;
  const selectedSeasonInfo = overview?.availableSeasons.find((season) => season.seasonNumber === effectiveSeasonNumber);
  const defaultResultRound = effectiveSeasonNumber === activeSeasonNumber
    ? Math.max(1, (activeSelectedLeague?.season?.currentRound ?? 1) - 1)
    : selectedSeasonInfo?.totalRounds ?? 1;
  const requestedResultRound = resultRound ?? defaultResultRound;

  useEffect(() => {
    if (effectiveSeasonNumber === null || !API_URL || (view !== "results" && view !== "table")) return;

    const controller = new AbortController();
    const loadSeason = async () => {
      setSeasonLoading(true);
      setSeasonError("");
      setSeasonOverview(null);
      const query = new URLSearchParams({ seasonNumber: String(effectiveSeasonNumber) });
      if (view === "results") query.set("round", String(requestedResultRound));
      try {
        const response = await fetch(`${API_URL}/api/world/overview?${query}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Season data returned HTTP ${response.status}.`);
        const result = await response.json() as WorldOverview;
        setSeasonOverview(result);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setSeasonError(cause instanceof Error ? cause.message : "Season data could not be loaded.");
        }
      } finally {
        if (!controller.signal.aborted) setSeasonLoading(false);
      }
    };

    void loadSeason();
    return () => controller.abort();
  }, [effectiveSeasonNumber, requestedResultRound, view]);

  const showingActiveSeason = effectiveSeasonNumber === activeSeasonNumber;
  const displayOverview = seasonOverview
    ?? (showingActiveSeason ? overview : null);
  const selectedLeague = displayOverview?.leagues.find((league) => league.league.id === selectedLeagueId)
    ?? displayOverview?.leagues[0]
    ?? null;
  const seasons = overview?.availableSeasons ?? [];
  const previousSeasonNumber = seasons
    .filter((season) => activeSeasonNumber !== null && season.seasonNumber < activeSeasonNumber)
    .reduce<number | null>((previous, season) => previous === null || season.seasonNumber > previous ? season.seasonNumber : previous, null);
  const currentSeasonName = seasons.find((season) => season.seasonNumber === activeSeasonNumber)?.name ?? "Current season";
  const displayedSeasonName = selectedSeasonInfo?.name ?? currentSeasonName;
  const displayedTotalRounds = selectedLeague?.season?.totalRounds ?? selectedSeasonInfo?.totalRounds ?? 38;
  const liveFixtures = (selectedLeague?.roundFixtures ?? []).filter((fixture) => fixture.status === "LIVE");
  const currentRoundUpcoming = (selectedLeague?.roundFixtures ?? []).filter((fixture) => fixture.status === "SCHEDULED");
  const nextRoundUpcoming = (selectedLeague?.nextRoundFixtures ?? []).filter((fixture) => fixture.status === "SCHEDULED");
  const upcomingFixtures = (currentRoundUpcoming.length ? currentRoundUpcoming : nextRoundUpcoming)
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
  const fixturesRound = upcomingFixtures[0]?.round ?? selectedLeague?.season?.currentRound ?? 0;
  const displayedRound = view === "fixtures" ? fixturesRound : selectedLeague?.season?.currentRound ?? 0;
  const resultsRound = requestedResultRound;
  const resultsFixtures = (selectedLeague?.roundFixtures ?? [])
    .filter((fixture) => fixture.round === resultsRound && fixture.status === "FINISHED")
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
  const tickerGoals = (overview?.leagues ?? [])
    .flatMap((league) => league.roundFixtures.flatMap((fixture) =>
      fixture.status !== "LIVE"
        ? []
        : (fixture.goalEvents ?? []).flatMap((goal) => {
          const scoringTeam = goal.teamId === fixture.homeTeam?.id
            ? fixture.homeTeam?.shortName ?? fixture.homeTeam?.name
            : goal.teamId === fixture.awayTeam?.id
              ? fixture.awayTeam?.shortName ?? fixture.awayTeam?.name
              : null;
          if (!scoringTeam) return [];
          return [{
            id: `${fixture.id}-${goal.sequence}`,
            createdAt: goal.createdAt,
            minute: goal.minute,
            team: scoringTeam,
            match: `${fixture.homeTeam?.shortName ?? fixture.homeTeam?.name ?? "Home"} vs ${fixture.awayTeam?.shortName ?? fixture.awayTeam?.name ?? "Away"}`,
          }];
        }),
    ))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 12);
  const goalTickerItems = tickerGoals;

  function selectSeason(seasonNumber: number) {
    setSelectedSeasonNumber(seasonNumber);
    setResultRound(null);
  }

  function renderSeasonSwitcher() {
    if (!seasons.length || activeSeasonNumber === null || (view !== "results" && view !== "table")) return null;
    return (
      <div className={styles.seasonSwitcher} role="group" aria-label="Choose season">
        {previousSeasonNumber !== null ? (
          <button
            type="button"
            aria-pressed={effectiveSeasonNumber === previousSeasonNumber}
            onClick={() => selectSeason(previousSeasonNumber)}
          >
            Previous season
          </button>
        ) : null}
        <button
          type="button"
          aria-pressed={effectiveSeasonNumber === activeSeasonNumber}
          onClick={() => selectSeason(activeSeasonNumber)}
        >
          Current season
        </button>
      </div>
    );
  }

  const viewTitle: Record<MatchCentreView, string> = {
    live: "Live scores",
    fixtures: "Fixtures",
    results: "Results",
    table: "Table",
  };

  return (
    <main className={styles.page} ref={pageRef}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/live" aria-label="SimSoccer live scores">
          <SportsSoccerIcon aria-hidden="true" />
          <span>SimSoccer</span>
        </Link>
        <div className={styles.worldStatus} aria-live="polite">
          {overview ? <><SignalWifiStatusbar4BarIcon aria-hidden="true" /><span>World connected</span></> : error ? <span className={styles.error}>Offline</span> : <CircularProgress size={14} aria-label="Connecting" />}
          <Tooltip title="Refresh match data">
            <IconButton aria-label="Refresh match data" onClick={refresh} size="small" className={styles.refresh}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <AuthAction />
        </div>
      </header>

      <nav className={styles.primaryNav} aria-label="Match centre pages">
        {navigation.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className={pathname === href ? styles.activeNav : ""}>
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>

      <section className={`${styles.masthead} ${styles.mastheadCentered}`} data-enter>
        <div>
          <h1>{viewTitle[view]}</h1>
        </div>
        {view === "live" || view === "fixtures" ? (
          <div className={styles.roundSummary}>
            <strong>Round {displayedRound}</strong>
          </div>
        ) : null}
      </section>

      {overview?.leagues.length ? (
        <nav className={styles.competitionNav} aria-label="Choose competition" data-enter>
          <Tabs
            value={selectedLeagueId || overview.leagues[0].league.id}
            onChange={(_, value: string) => setSelectedLeagueId(value)}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            aria-label="Competitions"
          >
            {overview.leagues.map((league) => <Tab key={league.league.id} label={league.league.name} value={league.league.id} />)}
          </Tabs>
        </nav>
      ) : null}

      {view !== "results" && view !== "table" && error
        ? <p className={styles.connectionError} role="alert">Match data is temporarily unavailable. Try again.</p>
        : null}
      {(view === "results" || view === "table") && seasonError
        ? <p className={styles.connectionError} role="alert">Season data is temporarily unavailable. Try again.</p>
        : null}

      <section className={styles.content} aria-label={viewTitle[view]}>
        {view === "live" ? (
          <>
            <div className={styles.sectionHeading} data-enter>
              <h2>{selectedLeague?.league.name ?? "Live matches"}</h2>
              <span className={styles.count}>{liveFixtures.length ? `${liveFixtures.length} live` : "No live matches"}</span>
            </div>
            <div className={styles.matchList}>
              {liveFixtures.map((fixture) => <MatchRow key={fixture.id} fixture={fixture} serverNow={serverNow} timeZone={timeZone} detailsEnabled />)}
              {overview && liveFixtures.length === 0 ? (
                <p className={styles.empty}>No live fixtures right now. <Link href="/fixtures">View fixtures</Link></p>
              ) : null}
            </div>
            {!overview && !error ? <MatchSkeletonList count={6} /> : null}
          </>
        ) : null}

        {view === "fixtures" ? (
          <>
            <div className={styles.sectionHeading} data-enter>
              <h2>{selectedLeague?.league.name ?? "Upcoming fixtures"}</h2>
              <span className={styles.count}>Kickoff times in {timeZone}</span>
            </div>
            <FixtureList fixtures={upcomingFixtures} serverNow={serverNow} loading={!overview && !error} timeZone={timeZone} />
          </>
        ) : null}

        {view === "results" ? (
          <>
            <div className={styles.sectionHeading} data-enter>
              <h2>{selectedLeague?.league.name ?? "Completed matches"}</h2>
              {renderSeasonSwitcher()}
              <div className={styles.roundNavigator} aria-label="Results round">
                <IconButton
                  aria-label="Previous round"
                  disabled={resultsRound <= 1 || seasonLoading}
                  onClick={() => setResultRound((round) => Math.max(1, (round ?? resultsRound) - 1))}
                  size="small"
                >
                  <NavigateBeforeIcon />
                </IconButton>
                <span>{displayedSeasonName} · Round {resultsRound}</span>
                <IconButton
                  aria-label="Next round"
                  disabled={resultsRound >= displayedTotalRounds || seasonLoading}
                  onClick={() => setResultRound((round) => Math.min(displayedTotalRounds, (round ?? resultsRound) + 1))}
                  size="small"
                >
                  <NavigateNextIcon />
                </IconButton>
              </div>
              <span className={styles.count}>Full-time results</span>
            </div>
            <ResultsList fixtures={resultsFixtures} serverNow={serverNow} loading={seasonLoading || !displayOverview} timeZone={timeZone} />
          </>
        ) : null}

        {view === "table" ? (
          <>
            <div className={styles.sectionHeading} data-enter>
              <h2>{selectedLeague?.league.name ?? "League table"}</h2>
              {renderSeasonSwitcher()}
              <span className={styles.count}>{displayedSeasonName} standings</span>
            </div>
            {displayOverview ? <StandingsTable rows={selectedLeague?.standings ?? []} /> : seasonLoading ? <StandingsSkeleton /> : seasonError ? null : (
              <p className={styles.empty}>The table is unavailable. Use refresh to try again.</p>
            )}
          </>
        ) : null}
      </section>

      {view === "live" ? <GoalTicker goals={goalTickerItems} /> : null}
    </main>
  );
}
