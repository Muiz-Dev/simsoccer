"use client";

import { createContext, startTransition, useContext, useEffect, useMemo, useRef, useState } from "react";

export type Team = { id: string; name: string; shortName: string; slug: string };
export type MatchEvent = {
  sequence: number;
  virtualMinute: number;
  virtualSecond: number;
  eventType: string;
  teamId?: string | null;
  playerId?: string | null;
  playerName?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
};
export type MatchStatistics = {
  homeShots: number;
  awayShots: number;
  homeShotsOnTarget: number;
  awayShotsOnTarget: number;
  homeCorners: number;
  awayCorners: number;
  homeFouls: number;
  awayFouls: number;
  homeYellowCards: number;
  awayYellowCards: number;
  homeRedCards: number;
  awayRedCards: number;
};
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
  matchEvents?: MatchEvent[];
  matchStatistics?: MatchStatistics | null;
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

function mergeMatchEvents(current: MatchEvent[] = [], incoming: MatchEvent[] = []): MatchEvent[] {
  const eventsBySequence = new Map(current.map((event) => [event.sequence, event]));
  for (const event of incoming) {
    const previous = eventsBySequence.get(event.sequence);
    eventsBySequence.set(event.sequence, {
      ...previous,
      ...event,
      teamId: event.teamId ?? previous?.teamId,
      playerId: event.playerId ?? previous?.playerId,
      playerName: event.playerName ?? previous?.playerName,
      metadata: event.metadata ?? previous?.metadata,
      createdAt: event.createdAt ?? previous?.createdAt,
    });
  }
  return [...eventsBySequence.values()].sort((a, b) => a.sequence - b.sequence);
}

function mergeFixture(current: Fixture | undefined, incoming: Fixture): Fixture {
  if (!current) return incoming;
  const useIncomingClock = incoming.virtualSecond >= current.virtualSecond;
  const status = statusRank(current.status) > statusRank(incoming.status) ? current.status : incoming.status;
  const matchEvents = mergeMatchEvents(current.matchEvents, incoming.matchEvents);
  const goalEvents = matchEvents.length
    ? matchEvents.filter((event) => event.eventType === "GOAL").map((event) => ({
      sequence: event.sequence,
      minute: event.virtualMinute,
      teamId: event.teamId ?? null,
      playerName: event.playerName ?? null,
      createdAt: event.createdAt ?? new Date().toISOString(),
    }))
    : incoming.goalEvents ?? current.goalEvents;
  return {
    ...incoming,
    status,
    homeScore: Math.max(current.homeScore, incoming.homeScore),
    awayScore: Math.max(current.awayScore, incoming.awayScore),
    virtualSecond: Math.max(current.virtualSecond, incoming.virtualSecond),
    clockUpdatedAt: useIncomingClock ? incoming.clockUpdatedAt : current.clockUpdatedAt,
    finishedAt: current.finishedAt ?? incoming.finishedAt,
    goalEvents,
    matchEvents,
    matchStatistics: incoming.matchStatistics ?? current.matchStatistics,
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
  const latestEventSequenceByFixture = useRef(new Map<string, number>());

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
    for (const league of overview?.leagues ?? []) {
      for (const fixture of league.roundFixtures) {
        const latestSequence = fixture.matchEvents?.reduce(
          (latest, event) => Math.max(latest, event.sequence),
          0,
        ) ?? 0;
        latestEventSequenceByFixture.current.set(
          fixture.id,
          Math.max(latestEventSequenceByFixture.current.get(fixture.id) ?? 0, latestSequence),
        );
      }
    }
  }, [overview]);

  useEffect(() => {
    if (!wsUrl || !selectedLiveFixtureIds) return;
    const connections = selectedLiveFixtureIds.split(",").map((fixtureId) => {
      let socket: WebSocket | undefined;
      let retryTimer: ReturnType<typeof setTimeout> | undefined;
      let retryDelay = 1000;
      let stopped = false;

      const connect = () => {
        if (stopped) return;
        socket = new WebSocket(wsUrl);
        socket.addEventListener("open", () => {
          retryDelay = 1000;
          socket?.send(JSON.stringify({
            type: "SUBSCRIBE_MATCH",
            fixtureId,
            lastSequence: latestEventSequenceByFixture.current.get(fixtureId) ?? 0,
          }));
        });
        socket.addEventListener("message", (message) => {
          try {
            const payload = JSON.parse(String(message.data));
            if (payload.type !== "MATCH_EVENT" || payload.fixtureId !== fixtureId) return;
            const event = payload.event as MatchEvent;
            if (!event || !Number.isInteger(event.sequence) || typeof event.eventType !== "string") {
              throw new Error("Invalid match event shape.");
            }
            const createdAt = event.createdAt ?? new Date().toISOString();
            const metadata = event.metadata ?? {};
            latestEventSequenceByFixture.current.set(
              fixtureId,
              Math.max(latestEventSequenceByFixture.current.get(fixtureId) ?? 0, event.sequence),
            );
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
                    homeScore: typeof metadata.homeScore === "number"
                      ? metadata.homeScore
                      : typeof metadata.finalHomeScore === "number" ? metadata.finalHomeScore : fixture.homeScore,
                    awayScore: typeof metadata.awayScore === "number"
                      ? metadata.awayScore
                      : typeof metadata.finalAwayScore === "number" ? metadata.finalAwayScore : fixture.awayScore,
                    virtualSecond: event.virtualSecond ?? fixture.virtualSecond,
                    clockUpdatedAt: createdAt,
                    finishedAt: isMatchEnd ? createdAt : fixture.finishedAt,
                    matchEvents: mergeMatchEvents(fixture.matchEvents, [{ ...event, createdAt }]),
                  })),
                })),
              };
            });
            if (isMatchEnd) setRefreshSequence((sequence) => sequence + 1);
          } catch {
            setError("A live-match event could not be read.");
          }
        });
        socket.addEventListener("close", () => {
          if (stopped) return;
          retryTimer = setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 30_000);
        });
      };

      connect();
      return () => {
        stopped = true;
        if (retryTimer) clearTimeout(retryTimer);
        socket?.close();
      };
    });
    return () => connections.forEach((disconnect) => disconnect());
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
