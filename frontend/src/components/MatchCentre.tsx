"use client";

import { useRef } from "react";
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
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import HistoryIcon from "@mui/icons-material/History";
import LiveTvIcon from "@mui/icons-material/LiveTv";
import RefreshIcon from "@mui/icons-material/Refresh";
import SportsSoccerIcon from "@mui/icons-material/SportsSoccer";
import SignalWifiStatusbar4BarIcon from "@mui/icons-material/SignalWifiStatusbar4Bar";
import { formatLocalDateTime, useBrowserTimeZone } from "@/lib/time-zone";
import type { Fixture, Standing } from "@/contexts/WorldDataContext";
import { useWorldData } from "@/contexts/WorldDataContext";
import styles from "./MatchCentre.module.css";

export type MatchCentreView = "live" | "fixtures" | "results" | "table";

type NavItem = { href: string; label: string; icon: typeof LiveTvIcon };

const navigation: NavItem[] = [
  { href: "/live", label: "Live", icon: LiveTvIcon },
  { href: "/fixtures", label: "Fixtures", icon: CalendarMonthIcon },
  { href: "/results", label: "Results", icon: HistoryIcon },
  { href: "/table", label: "Table", icon: FormatListNumberedIcon },
];

function MatchRow({ fixture, serverNow, timeZone }: { fixture: Fixture; serverNow: number; timeZone: string }) {
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

  return (
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

function FixturesByRound({ fixtures, serverNow, loading, timeZone }: { fixtures: Fixture[]; serverNow: number; loading: boolean; timeZone: string }) {
  const rounds = [...new Set(fixtures.map((fixture) => fixture.round))].sort((a, b) => a - b);
  if (loading) return <MatchSkeletonList />;
  if (rounds.length === 0) return <p className={styles.empty}>No fixtures are scheduled.</p>;

  return rounds.map((round) => (
    <section className={styles.roundBlock} key={round}>
      <h2 className={styles.roundLabel}>Round {round}</h2>
      <div className={styles.matchList}>
        {fixtures.filter((fixture) => fixture.round === round).map((fixture) => (
          <MatchRow key={fixture.id} fixture={fixture} serverNow={serverNow} timeZone={timeZone} />
        ))}
      </div>
    </section>
  ));
}

function ResultsByRound({ fixtures, serverNow, loading, timeZone }: { fixtures: Fixture[]; serverNow: number; loading: boolean; timeZone: string }) {
  const rounds = [...new Set(fixtures.map((fixture) => fixture.round))].sort((a, b) => b - a);
  if (loading) return <MatchSkeletonList />;
  if (rounds.length === 0) return <p className={styles.empty}>No completed results yet.</p>;

  return rounds.map((round) => (
    <section className={styles.roundBlock} key={round}>
      <h2 className={styles.roundLabel}>Round {round}</h2>
      <div className={styles.matchList}>
        {fixtures.filter((fixture) => fixture.round === round).map((fixture) => (
          <MatchRow key={fixture.id} fixture={fixture} serverNow={serverNow} timeZone={timeZone} />
        ))}
      </div>
    </section>
  ));
}

export default function MatchCentre({ view }: { view: MatchCentreView }) {
  const pathname = usePathname();
  const timeZone = useBrowserTimeZone();
  const pageRef = useRef<HTMLElement>(null);
  const animated = useRef(false);
  const { overview, selectedLeague, selectedLeagueId, setSelectedLeagueId, refresh, error, serverNow } = useWorldData();

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

  const liveFixtures = (selectedLeague?.roundFixtures ?? []).filter((fixture) => fixture.status === "LIVE");
  const upcomingFixtures = [
    ...(selectedLeague?.roundFixtures ?? []).filter((fixture) => fixture.status === "SCHEDULED"),
    ...(selectedLeague?.nextRoundFixtures ?? []).filter((fixture) => fixture.status === "SCHEDULED"),
  ].sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
  const completedFixtures = [
    ...(selectedLeague?.previousRoundFixtures ?? []).filter((fixture) => fixture.status === "FINISHED"),
    ...(selectedLeague?.roundFixtures ?? []).filter((fixture) => fixture.status === "FINISHED"),
  ].sort((a, b) => b.round - a.round || Date.parse(b.scheduledAt) - Date.parse(a.scheduledAt));

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

      <section className={styles.masthead} data-enter>
        <div>
          <p className={styles.kicker}>Simulated football · live world</p>
          <h1>{viewTitle[view]}</h1>
        </div>
        <div className={styles.roundSummary}>
          <span>{selectedLeague?.season?.name ?? "Waiting for season"}</span>
          <strong>Round {selectedLeague?.season?.currentRound ?? 0}<span>/</span>{selectedLeague?.season?.totalRounds ?? 0}</strong>
        </div>
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

      {error ? <p className={styles.connectionError} role="status">Match data unavailable: {error}</p> : null}

      <section className={styles.content} aria-label={viewTitle[view]}>
        {view === "live" ? (
          <>
            <div className={styles.sectionHeading} data-enter>
              <h2>{selectedLeague?.league.name ?? "Live matches"}</h2>
              <span className={styles.count}>{liveFixtures.length ? `${liveFixtures.length} live` : "No live matches"}</span>
            </div>
            <div className={styles.matchList}>
              {liveFixtures.map((fixture) => <MatchRow key={fixture.id} fixture={fixture} serverNow={serverNow} timeZone={timeZone} />)}
              {overview && liveFixtures.length === 0 ? (
                <p className={styles.empty}>No live fixtures right now. <Link href="/fixtures">View fixtures</Link></p>
              ) : null}
            </div>
            {!overview && !error ? <MatchSkeletonList count={6} /> : null}
            {!overview && error ? <p className={styles.empty}>Live scores are unavailable. Use refresh to try again.</p> : null}
          </>
        ) : null}

        {view === "fixtures" ? (
          <>
            <div className={styles.sectionHeading} data-enter>
              <h2>{selectedLeague?.league.name ?? "Upcoming fixtures"}</h2>
              <span className={styles.count}>Kickoff times in {timeZone}</span>
            </div>
            <FixturesByRound fixtures={upcomingFixtures} serverNow={serverNow} loading={!overview && !error} timeZone={timeZone} />
            {!overview && error ? <p className={styles.empty}>Fixtures are unavailable. Use refresh to try again.</p> : null}
          </>
        ) : null}

        {view === "results" ? (
          <>
            <div className={styles.sectionHeading} data-enter>
              <h2>{selectedLeague?.league.name ?? "Completed matches"}</h2>
              <span className={styles.count}>Full-time results</span>
            </div>
            <ResultsByRound fixtures={completedFixtures} serverNow={serverNow} loading={!overview && !error} timeZone={timeZone} />
            {!overview && error ? <p className={styles.empty}>Results are unavailable. Use refresh to try again.</p> : null}
          </>
        ) : null}

        {view === "table" ? (
          <>
            <div className={styles.sectionHeading} data-enter>
              <h2>{selectedLeague?.league.name ?? "League table"}</h2>
              <span className={styles.count}>{selectedLeague?.season?.name ?? "Season"}</span>
            </div>
            {overview ? <StandingsTable rows={selectedLeague?.standings ?? []} /> : !error ? <StandingsSkeleton /> : (
              <p className={styles.empty}>The table is unavailable. Use refresh to try again.</p>
            )}
          </>
        ) : null}
      </section>

      <footer className={styles.footer}>
        <span>Clock synced to match server</span>
      </footer>
    </main>
  );
}
