"use client";

import { createContext, startTransition, useContext, useEffect, useMemo, useRef, useState } from "react";

export type Team = { id: string; name: string; shortName: string; slug: string };
export type Fixture = {
  id: string;
  round: number;
  status: string;
  matchStatus: string | null;
  scheduledAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  homeScore: number;
  awayScore: number;
  virtualSecond: number;
  clockUpdatedAt: string | null;
  goalEvents?: GoalEvent[];
  homeTeam: Team | null;
  awayTeam: Team | null;
};
export type GoalEvent = {
  sequence: number;
  minute: number;
  teamId: string | null;
  playerName: string | null;
  createdAt: string;
};
export type Standing = {
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
};
export type LeagueOverview = {
  league: { id: string; name: string; slug: string };
  season: { id: string; name: string; seasonNumber?: number; currentRound: number; totalRounds: number } | null;
  standings: Standing[];
  roundFixtures: Fixture[];
  nextRoundFixtures: Fixture[];
  previousRoundFixtures: Fixture[];
};
export type WorldOverview = {
  generatedAt: string;
  world: { status: string; activeSeasonId: string | null; currentRound: number; totalRounds: number };
  leagues: LeagueOverview[];
  availableSeasons: Array<{ seasonNumber: number; name: string; totalRounds: number }>;
};

type WorldDataValue = {
  overview: WorldOverview | null;
  selectedLeague: LeagueOverview | null;
  selectedLeagueId: string;
  setSelectedLeagueId: (leagueId: string) => void;
  refresh: () => void;
  error: string;
  serverNow: number;
};

const WorldDataContext = createContext<WorldDataValue | null>(null);
const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? "";
const REFRESH_INTERVAL_MS = 15_000;

function statusRank(status: string) {
  if (status === "FINISHED" || status === "CANCELLED") return 2;
  if (status === "LIVE" || status === "HALFTIME" || status === "SECOND_HALF") return 1;
  return 0;
}

function mergeFixture(current: Fixture | undefined, incoming: Fixture): Fixture {
  if (!current) return incoming;
  const useIncomingClock = incoming.virtualSecond >= current.virtualSecond;
  const status = statusRank(current.status) > statusRank(incoming.status) ? current.status : incoming.status;
  return {
    ...incoming,
    status,
    homeScore: Math.max(current.homeScore, incoming.homeScore),
    awayScore: Math.max(current.awayScore, incoming.awayScore),
    virtualSecond: Math.max(current.virtualSecond, incoming.virtualSecond),
    clockUpdatedAt: useIncomingClock ? incoming.clockUpdatedAt : current.clockUpdatedAt,
    finishedAt: current.finishedAt ?? incoming.finishedAt,
  };
}

function mergeFixtureLists(current: Fixture[], incoming: Fixture[]) {
  const currentById = new Map(current.map((fixture) => [fixture.id, fixture]));
  return incoming.map((fixture) => mergeFixture(currentById.get(fixture.id), fixture));
}

function mergeOverview(current: WorldOverview | null, incoming: WorldOverview): WorldOverview {
  if (!current) return incoming;
  const currentLeagues = new Map(current.leagues.map((league) => [league.league.id, league]));
  return {
    ...incoming,
    leagues: incoming.leagues.map((league) => {
      const previous = currentLeagues.get(league.league.id);
      if (!previous || previous.season?.id !== league.season?.id) return league;
      const previousStandings = new Map(previous.standings.map((row) => [row.teamId, row]));
      const standings = league.standings.map((row) => {
        const old = previousStandings.get(row.teamId);
        if (!old) return row;
        return {
          ...row,
          played: Math.max(row.played, old.played),
          won: Math.max(row.won, old.won),
          drawn: Math.max(row.drawn, old.drawn),
          lost: Math.max(row.lost, old.lost),
          goalsFor: Math.max(row.goalsFor, old.goalsFor),
          goalsAgainst: Math.max(row.goalsAgainst, old.goalsAgainst),
          points: Math.max(row.points, old.points),
        };
      }).sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor || a.teamName.localeCompare(b.teamName))
        .map((row, index) => ({ ...row, position: index + 1 }));
      return {
        ...league,
        season: league.season && previous.season
          ? { ...league.season, currentRound: Math.max(league.season.currentRound, previous.season.currentRound) }
          : league.season,
        standings,
        roundFixtures: mergeFixtureLists(previous.roundFixtures, league.roundFixtures),
        nextRoundFixtures: mergeFixtureLists(previous.nextRoundFixtures, league.nextRoundFixtures),
        previousRoundFixtures: mergeFixtureLists(previous.previousRoundFixtures, league.previousRoundFixtures),
      };
    }),
  };
}

export function WorldDataProvider({ children }: { children: React.ReactNode }) {
  const [overview, setOverview] = useState<WorldOverview | null>(null);
  const [selectedLeagueId, setSelectedLeagueId] = useState("");
  const [error, setError] = useState("");
  const [refreshSequence, setRefreshSequence] = useState(0);
  const [serverNow, setServerNow] = useState(0);
  const serverClockAnchor = useRef({ serverMs: 0, performanceMs: 0 });

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    const scheduleNext = () => {
      if (!stopped) {
        const hiddenDelay = typeof document !== "undefined" && document.hidden ? 60_000 : REFRESH_INTERVAL_MS;
        timer = setTimeout(() => void loadOverview(), hiddenDelay);
      }
    };

    const loadOverview = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        if (!apiUrl) throw new Error("NEXT_PUBLIC_API_URL is missing.");
        const response = await fetch(`${apiUrl}/api/world/overview`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Overview API returned HTTP ${response.status}.`);
        const result = (await response.json()) as WorldOverview;
        if (stopped) return;
        startTransition(() => {
          setOverview((current) => mergeOverview(current, result));
          setSelectedLeagueId((current) => current || result.leagues[0]?.league.id || "");
        });
        setError("");
      } catch (cause) {
        if (!stopped && !(cause instanceof DOMException && cause.name === "AbortError")) {
          setError(cause instanceof Error ? cause.message : "Could not load the world overview.");
        }
      } finally {
        scheduleNext();
      }
    };

    const onVisibilityChange = () => {
      if (!document.hidden) {
        if (timer) clearTimeout(timer);
        void loadOverview();
      }
    };

    void loadOverview();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshSequence]);

  useEffect(() => {
    if (!overview?.generatedAt) return;
    serverClockAnchor.current = {
      serverMs: Date.parse(overview.generatedAt),
      performanceMs: performance.now(),
    };
    const syncClock = () => {
      const anchor = serverClockAnchor.current;
      setServerNow(anchor.serverMs + performance.now() - anchor.performanceMs);
    };
    syncClock();
    const interval = setInterval(syncClock, 1000);
    document.addEventListener("visibilitychange", syncClock);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", syncClock);
    };
  }, [overview?.generatedAt]);

  const selectedLeague = overview?.leagues.find((league) => league.league.id === selectedLeagueId)
    ?? overview?.leagues[0]
    ?? null;
  const selectedLiveFixtureIds = (selectedLeague?.roundFixtures ?? [])
    .filter((fixture) => fixture.status === "LIVE")
    .map((fixture) => fixture.id)
    .join(",");

  useEffect(() => {
    if (!wsUrl || !selectedLiveFixtureIds) return;
    const sockets = selectedLiveFixtureIds.split(",").map((fixtureId) => {
      const socket = new WebSocket(wsUrl);
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "SUBSCRIBE_MATCH", fixtureId }));
      });
      socket.addEventListener("message", (message) => {
        try {
          const payload = JSON.parse(String(message.data));
          if (payload.type !== "MATCH_EVENT" || payload.fixtureId !== fixtureId) return;
          const event = payload.event;
          const metadata = event.metadata ?? {};
          const isMatchEnd = event.eventType === "MATCH_END";
          setOverview((current) => {
            if (!current) return current;
            return {
              ...current,
              leagues: current.leagues.map((league) => ({
                ...league,
                roundFixtures: league.roundFixtures.map((fixture) => fixture.id !== fixtureId ? fixture : mergeFixture(fixture, {
                  ...fixture,
                  status: isMatchEnd ? "FINISHED" : "LIVE",
                  matchStatus: isMatchEnd ? "FINISHED" : fixture.matchStatus,
                  homeScore: metadata.homeScore ?? metadata.finalHomeScore ?? fixture.homeScore,
                  awayScore: metadata.awayScore ?? metadata.finalAwayScore ?? fixture.awayScore,
                  virtualSecond: event.virtualSecond ?? fixture.virtualSecond,
                  clockUpdatedAt: new Date().toISOString(),
                  finishedAt: isMatchEnd ? new Date().toISOString() : fixture.finishedAt,
                })),
              })),
            };
          });
          if (isMatchEnd) setRefreshSequence((sequence) => sequence + 1);
        } catch {
          setError("A live-match event could not be read.");
        }
      });
      return socket;
    });
    return () => sockets.forEach((socket) => socket.close());
  }, [selectedLiveFixtureIds]);

  const value = useMemo<WorldDataValue>(() => ({
    overview,
    selectedLeague,
    selectedLeagueId,
    setSelectedLeagueId,
    refresh: () => setRefreshSequence((sequence) => sequence + 1),
    error,
    serverNow,
  }), [overview, selectedLeague, selectedLeagueId, error, serverNow]);

  return <WorldDataContext.Provider value={value}>{children}</WorldDataContext.Provider>;
}

export function useWorldData() {
  const context = useContext(WorldDataContext);
  if (!context) throw new Error("useWorldData must be used inside WorldDataProvider.");
  return context;
}
