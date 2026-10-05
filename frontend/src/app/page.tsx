"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import RefreshIcon from "@mui/icons-material/Refresh";
import SportsSoccerIcon from "@mui/icons-material/SportsSoccer";
import SignalWifiStatusbar4BarIcon from "@mui/icons-material/SignalWifiStatusbar4Bar";
import { formatLocalTime, useBrowserTimeZone } from "@/lib/time-zone";
import styles from "./page.module.css";

gsap.registerPlugin(useGSAP);

type Team = { id: string; name: string; shortName: string; slug: string };
type Fixture = {
  id: string;
  round: number;
  status: string;
  scheduledAt: string;
  homeScore: number;
  awayScore: number;
  virtualSecond: number;
  homeTeam: Team | null;
  awayTeam: Team | null;
};
type LeagueOverview = {
  league: { id: string; name: string; slug: string };
  season: { id: string; name: string; currentRound: number; totalRounds: number } | null;
  standings: Array<{
    position: number;
    teamId: string;
    teamName: string;
    shortName: string;
    played: number;
    won: number;
    drawn: number;
    lost: number;
    goalsFor: number;
    goalsAgainst: number;
    goalDifference: number;
    points: number;
  }>;
  roundFixtures: Fixture[];
  nextRoundFixtures: Fixture[];
};
type Overview = {
  generatedAt: string;
  world: { status: string; currentRound: number; totalRounds: number };
  leagues: LeagueOverview[];
};

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "";
const REFRESH_INTERVAL_MS = 15_000;

function matchMinute(second: number) {
  return Math.min(90, Math.floor(second / 60));
}

function LiveMark() {
  return (
    <span className={styles.liveMark}>
      <span aria-hidden="true" className={styles.liveDot} />
      Live
    </span>
  );
}

function FixtureRow({ fixture, timeZone }: { fixture: Fixture; timeZone: string }) {
  const isLive = fixture.status === "LIVE";
  const isFinished = fixture.status === "FINISHED";

  return (
    <div className={styles.fixtureRow} data-fixture-id={fixture.id}>
      <div className={styles.fixtureState}>
        {isLive ? (
          <>
            <LiveMark />
            <span className={styles.minute}>{matchMinute(fixture.virtualSecond)}&apos;</span>
          </>
        ) : isFinished ? (
          <span className={styles.finishedLabel}>Full time</span>
        ) : (
          <span className={styles.kickoff}>{formatLocalTime(fixture.scheduledAt, timeZone)}</span>
        )}
      </div>
      <div className={styles.fixtureTeams}>
        <span className={fixture.homeScore > fixture.awayScore && (isLive || isFinished) ? styles.leadingTeam : ""}>
          {fixture.homeTeam?.name ?? "Home"}
        </span>
        <span className={fixture.awayScore > fixture.homeScore && (isLive || isFinished) ? styles.leadingTeam : ""}>
          {fixture.awayTeam?.name ?? "Away"}
        </span>
      </div>
      <div className={styles.score} aria-label={`${fixture.homeScore} to ${fixture.awayScore}`}>
        <span>{fixture.homeScore}</span>
        <span className={styles.scoreSeparator}>:</span>
        <span>{fixture.awayScore}</span>
      </div>
    </div>
  );
}

export default function Home() {
  const timeZone = useBrowserTimeZone();
  const pageRef = useRef<HTMLElement>(null);
  const hasEntered = useRef(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [selectedLeagueId, setSelectedLeagueId] = useState("");
  const [loadError, setLoadError] = useState("");
  const [refreshSequence, setRefreshSequence] = useState(0);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let activeController: AbortController | undefined;

    const loadOverview = async () => {
      activeController = new AbortController();
      try {
        if (!API_URL) throw new Error("NEXT_PUBLIC_API_URL is not configured.");
        const response = await fetch(`${API_URL}/api/world/overview`, {
          cache: "no-store",
          signal: activeController.signal,
        });
        if (!response.ok) throw new Error(`API returned HTTP ${response.status}.`);
        const result = (await response.json()) as Overview;
        if (stopped) return;
        setOverview(result);
        setLoadError("");
        setSelectedLeagueId((current) => current || result.leagues[0]?.league.id || "");
      } catch (error) {
        if (!stopped && !(error instanceof DOMException && error.name === "AbortError")) {
          setLoadError(error instanceof Error ? error.message : "Could not load match data.");
        }
      } finally {
        if (!stopped) timer = setTimeout(loadOverview, REFRESH_INTERVAL_MS);
      }
    };

    void loadOverview();
    return () => {
      stopped = true;
      clearTimeout(timer);
      activeController?.abort();
    };
  }, [refreshSequence]);

  const selectedLeague = overview?.leagues.find((item) => item.league.id === selectedLeagueId) ?? overview?.leagues[0];
  const liveFixtureKey = (selectedLeague?.roundFixtures ?? [])
    .filter((fixture) => fixture.status === "LIVE")
    .map((fixture) => fixture.id)
    .join(",");

  useEffect(() => {
    if (!WS_URL || !liveFixtureKey) return;

    const sockets = liveFixtureKey.split(",").map((fixtureId) => {
      const socket = new WebSocket(WS_URL);
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "SUBSCRIBE_MATCH", fixtureId, lastSequence: 0 }));
      });
      socket.addEventListener("message", (message) => {
        try {
          const payload = JSON.parse(String(message.data));
          if (payload.type !== "MATCH_EVENT" || payload.fixtureId !== fixtureId) return;
          const event = payload.event;
          const metadata = event.metadata ?? {};
          setOverview((current) => {
            if (!current) return current;
            return {
              ...current,
              leagues: current.leagues.map((league) => ({
                ...league,
                roundFixtures: league.roundFixtures.map((fixture) => fixture.id !== fixtureId ? fixture : ({
                  ...fixture,
                  status: event.eventType === "MATCH_END" ? "FINISHED" : "LIVE",
                  homeScore: metadata.homeScore ?? metadata.finalHomeScore ?? fixture.homeScore,
                  awayScore: metadata.awayScore ?? metadata.finalAwayScore ?? fixture.awayScore,
                  virtualSecond: event.virtualSecond ?? fixture.virtualSecond,
                })),
              })),
            };
          });
        } catch {
          setLoadError("Received an unreadable live-match event.");
        }
      });
      return socket;
    });

    return () => sockets.forEach((socket) => socket.close());
  }, [liveFixtureKey]);

  useGSAP(() => {
    if (!overview || hasEntered.current || !pageRef.current) return;
    hasEntered.current = true;
    const motion = gsap.matchMedia();
    motion.add("(prefers-reduced-motion: no-preference)", () => {
      const targets = pageRef.current?.querySelectorAll("[data-reveal]");
      if (!targets?.length) return;
      gsap.fromTo(
        targets,
        { autoAlpha: 0, y: 7 },
        { autoAlpha: 1, y: 0, duration: 0.32, stagger: 0.045, ease: "power2.out" },
      );
    });
    return () => motion.revert();
  }, { dependencies: [Boolean(overview)], revertOnUpdate: true, scope: pageRef });

  const liveCount = selectedLeague?.roundFixtures.filter((fixture) => fixture.status === "LIVE").length ?? 0;

  return (
    <main className={styles.page} ref={pageRef}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="SimSoccer match centre">
          <SportsSoccerIcon aria-hidden="true" />
          <span>SimSoccer</span>
        </Link>
        <div className={styles.headerStatus} aria-live="polite">
          {overview ? (
            <>
              <SignalWifiStatusbar4BarIcon aria-hidden="true" />
              <span>World connected</span>
            </>
          ) : loadError ? (
            <span className={styles.offline}>Connection unavailable</span>
          ) : (
            <CircularProgress size={14} aria-label="Connecting" />
          )}
          <Tooltip title="Refresh match data">
            <IconButton
              className={styles.refreshButton}
              aria-label="Refresh match data"
              onClick={() => setRefreshSequence((sequence) => sequence + 1)}
              size="small"
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </div>
      </header>

      <section className={styles.masthead} data-reveal>
        <div>
          <h1>Match centre</h1>
        </div>
        <div className={styles.worldSummary}>
          <span>{selectedLeague?.season?.name ?? "Waiting for season"}</span>
          <strong>
            Round {selectedLeague?.season?.currentRound ?? overview?.world.currentRound ?? 0}
            <span className={styles.summaryDivider}>/</span>
            {selectedLeague?.season?.totalRounds ?? overview?.world.totalRounds ?? 0}
          </strong>
        </div>
      </section>

      <nav className={styles.competitionNav} aria-label="Choose competition" data-reveal>
        {overview?.leagues.length ? (
          <Tabs
            value={selectedLeagueId || overview.leagues[0].league.id}
            onChange={(_, value: string) => setSelectedLeagueId(value)}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            aria-label="Competitions"
          >
            {overview.leagues.map((item) => (
              <Tab key={item.league.id} label={item.league.name} value={item.league.id} />
            ))}
          </Tabs>
        ) : null}
      </nav>

      {loadError ? (
        <p className={styles.connectionError} role="alert">
          Match centre is unavailable. Try again in a moment.
        </p>
      ) : null}

      <div className={styles.contentGrid}>
        <section className={styles.matchesSection} aria-labelledby="round-heading">
          <div className={styles.sectionHeading} data-reveal>
            <div>
              <p className={styles.kicker}>{selectedLeague?.league.name ?? "Competition"}</p>
              <h2 id="round-heading">Round {selectedLeague?.season?.currentRound ?? 1}</h2>
            </div>
            <span className={styles.liveCount}>{liveCount ? `${liveCount} live` : "Fixtures"}</span>
          </div>

          <div className={styles.fixtureList}>
            {selectedLeague?.roundFixtures.length ? selectedLeague.roundFixtures.map((fixture) => (
              <FixtureRow key={fixture.id} fixture={fixture} timeZone={timeZone} />
            )) : (
              <p className={styles.emptyState}>
                {overview ? "No fixtures are scheduled for this round." : "Connecting to the match centre…"}
              </p>
            )}
          </div>

          <section className={styles.nextRound} aria-labelledby="next-round-heading" data-reveal>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.kicker}>Coming up</p>
                <h2 id="next-round-heading">
                  {selectedLeague?.season && selectedLeague.season.currentRound < selectedLeague.season.totalRounds
                    ? `Round ${selectedLeague.season.currentRound + 1}`
                    : "Next round"}
                </h2>
              </div>
            </div>
            <div className={styles.fixtureList}>
              {selectedLeague?.nextRoundFixtures.length ? selectedLeague.nextRoundFixtures.map((fixture) => (
                <FixtureRow key={fixture.id} fixture={fixture} timeZone={timeZone} />
              )) : <p className={styles.emptyState}>The next round will appear here when scheduled.</p>}
            </div>
          </section>
        </section>

        <section className={styles.tableSection} aria-labelledby="table-heading" data-reveal>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.kicker}>{selectedLeague?.season?.name ?? "League"}</p>
              <h2 id="table-heading">Standings</h2>
            </div>
            <span className={styles.tableUpdated}>After completed matches</span>
          </div>

          <div className={styles.tableWrap} role="region" aria-label="League standings" tabIndex={0}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col" className={styles.clubHeading}>Club</th>
                  <th scope="col">P</th>
                  <th scope="col">W</th>
                  <th scope="col">D</th>
                  <th scope="col">L</th>
                  <th scope="col">GD</th>
                  <th scope="col" className={styles.pointsHeading}>Pts</th>
                </tr>
              </thead>
              <tbody>
                {selectedLeague?.standings.map((row) => (
                  <tr key={row.teamId} className={row.position <= 4 ? styles.topPlace : ""}>
                    <td>{row.position}</td>
                    <th scope="row" className={styles.clubName}>{row.teamName}</th>
                    <td>{row.played}</td>
                    <td>{row.won}</td>
                    <td>{row.drawn}</td>
                    <td>{row.lost}</td>
                    <td>{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</td>
                    <td className={styles.points}>{row.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!selectedLeague?.standings.length ? (
              <p className={styles.emptyState}>Standings update after the first result.</p>
            ) : null}
          </div>
        </section>
      </div>

      <footer className={styles.footer}>
        <span>Match times shown in {timeZone}</span>
        <span>Refreshes every 15 seconds{liveFixtureKey ? " · live events connected" : ""}</span>
      </footer>
    </main>
  );
}
