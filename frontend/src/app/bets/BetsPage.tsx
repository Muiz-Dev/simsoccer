"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import HighlightOffIcon from "@mui/icons-material/HighlightOff";
import SearchIcon from "@mui/icons-material/Search";
import SportsSoccerIcon from "@mui/icons-material/SportsSoccer";
import AuthAction from "@/components/AuthAction";
import { restoreAccessToken } from "@/lib/auth-client";
import styles from "./BetsPage.module.css";

type TicketSelection = {
  id?: string;
  outcomeCode: string;
  odds: string;
  status: string;
  marketType: string;
  displayName: string;
  fixture: {
    scheduledAt: string;
    status: string;
    homeScore: number | null;
    awayScore: number | null;
    homeTeam: string;
    awayTeam: string;
  } | null;
};

type Ticket = {
  id?: string;
  stake: string;
  totalOdds: string;
  potentialPayout: string;
  status: string;
  placedAt: string;
  settledAt: string | null;
  settlement: { status: string; payoutAmount: string } | null;
  selections: TicketSelection[];
};

type TicketPage = {
  tickets: Ticket[];
  total: number;
  openCount: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

function formatStatus(status: string) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

async function readTicketPage(token: string, status: "OPEN" | "SETTLED", page: number): Promise<TicketPage> {
  if (!API_URL) throw new Error("Bet history is temporarily unavailable.");
  const query = new URLSearchParams({ page: String(page), pageSize: "10", status });
  const response = await fetch(`${API_URL}/api/bets?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message ?? "Your bet history could not be loaded.");
  if (!payload || !Array.isArray(payload.tickets) || typeof payload.total !== "number"
    || typeof payload.openCount !== "number" || typeof payload.hasMore !== "boolean") {
    throw new Error("Bet history returned an unreadable response.");
  }
  return payload as TicketPage;
}

function TicketCard({ ticket, publicView = false }: { ticket: Ticket; publicView?: boolean }) {
  const hasLiveFixture = ticket.selections.some((selection) =>
    ["LIVE", "HALFTIME", "SECOND_HALF"].includes(selection.fixture?.status ?? ""),
  );
  const ticketStatus = ticket.status === "PENDING"
    ? hasLiveFixture ? "In play" : "Open"
    : formatStatus(ticket.status);
  return (
    <article className={`${styles.ticket} ${publicView ? styles.publicTicket : ""}`} id={ticket.id ? `ticket-${ticket.id}` : undefined}>
      <header className={styles.ticketHeader}>
        <div>
          <time dateTime={ticket.placedAt}>{new Date(ticket.placedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</time>
          <span>Play-money ticket</span>
        </div>
        <span className={`${styles.status} ${styles[`status${ticket.status}`] ?? ""}`}>{ticketStatus}</span>
      </header>
      <ol className={styles.legs}>
        {ticket.selections.map((selection, index) => (
          <li key={selection.id ?? `${selection.outcomeCode}-${index}`}>
            <div className={styles.match}>
              <strong>{selection.fixture ? `${selection.fixture.homeTeam} v ${selection.fixture.awayTeam}` : "Match details unavailable"}</strong>
              {selection.fixture ? (
                <div className={styles.fixtureState}>
                  {["LIVE", "HALFTIME", "SECOND_HALF"].includes(selection.fixture.status) ? (
                    <>
                      <span className={styles.liveLabel}>
                        <span className={styles.liveDot} aria-hidden="true" />
                        {selection.fixture.status === "HALFTIME" ? "Half-time" : "Live"}
                      </span>
                      <strong className={styles.score}>
                        {selection.fixture.homeScore ?? 0} – {selection.fixture.awayScore ?? 0}
                      </strong>
                    </>
                  ) : selection.fixture.status === "FINISHED" ? (
                    <>
                      <span className={styles.finishedLabel}>Full time</span>
                      <strong className={styles.score}>
                        {selection.fixture.homeScore ?? 0} – {selection.fixture.awayScore ?? 0}
                      </strong>
                    </>
                  ) : (
                    <span>
                      {selection.fixture.status === "CANCELLED" || selection.fixture.status === "POSTPONED"
                        ? formatStatus(selection.fixture.status)
                        : new Date(selection.fixture.scheduledAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                  )}
                </div>
              ) : null}
            </div>
            <div className={styles.pick}>
              <span>{selection.displayName}</span>
              <strong>{Number(selection.odds).toFixed(2)}</strong>
            </div>
            {selection.status === "WON" ? (
              <span className={`${styles.legStatus} ${styles.legWon}`} role="img" aria-label="Won" title="Won">
                <CheckCircleIcon aria-hidden="true" />
              </span>
            ) : selection.status === "LOST" ? (
              <span className={`${styles.legStatus} ${styles.legLost}`} role="img" aria-label="Lost" title="Lost">
                <HighlightOffIcon aria-hidden="true" />
              </span>
            ) : selection.status === "VOID" ? (
              <span className={`${styles.legStatus} ${styles[`status${selection.status}`] ?? ""}`}>
                Void
              </span>
            ) : <span className={styles.legStatus} aria-hidden="true" />
          </li>
        ))}
      </ol>
      <dl className={styles.figures}>
        <div><dt>Stake</dt><dd>{ticket.stake}</dd></div>
        <div><dt>Combined odds</dt><dd>{ticket.totalOdds}</dd></div>
        <div><dt>{ticket.settlement ? "Paid out" : "Potential return"}</dt><dd>{ticket.settlement?.payoutAmount ?? ticket.potentialPayout}</dd></div>
      </dl>
      {ticket.settledAt ? <p className={styles.settledAt}>Settled {new Date(ticket.settledAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p> : null}
    </article>
  );
}

export default function BetsPage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [openTicketCount, setOpenTicketCount] = useState(0);
  const [ticketCount, setTicketCount] = useState(0);
  const [hasMoreTickets, setHasMoreTickets] = useState(false);
  const [nextTicketPage, setNextTicketPage] = useState(2);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [tab, setTab] = useState<"OPEN" | "SETTLED">("OPEN");
  const historyRequestId = useRef(0);
  const ticketHistoryPages = useRef(1);
  const [ticketCode, setTicketCode] = useState("");
  const [lookedUpCode, setLookedUpCode] = useState("");
  const [publicTicket, setPublicTicket] = useState<Ticket | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadHistory() {
      try {
        const token = await restoreAccessToken();
        if (!active) return;
        setSignedIn(Boolean(token));
        if (!token) return;
        const requestId = ++historyRequestId.current;
        const result = await readTicketPage(token, "OPEN", 1);
        if (!active || requestId !== historyRequestId.current) return;
        setTickets(result.tickets);
        setTicketCount(result.total);
        setOpenTicketCount(result.openCount);
        setHasMoreTickets(result.hasMore);
        setNextTicketPage(2);
      } catch (cause) {
        if (active) setHistoryError(cause instanceof Error ? cause.message : "Your bet history could not be loaded.");
      } finally {
        if (active) setLoadingHistory(false);
      }
    }
    void loadHistory();
    return () => {
      active = false;
      historyRequestId.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    let stopped = false;
    let refreshing = false;
    const refreshOpenTickets = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const token = await restoreAccessToken();
        if (!token) throw new Error("Sign in again to view your tickets.");
        const pageCount = ticketHistoryPages.current;
        const pages = await Promise.all(
          Array.from({ length: pageCount }, (_, index) => readTicketPage(token, tab, index + 1)),
        );
        if (stopped) return;
        const latestPage = pages[pages.length - 1];
        const uniqueTickets = new Map(pages.flatMap((page) => page.tickets).map((ticket) => [ticket.id, ticket] as const));
        setTickets([...uniqueTickets.values()]);
        setTicketCount(latestPage?.total ?? 0);
        setOpenTicketCount(latestPage?.openCount ?? 0);
        setHasMoreTickets(latestPage?.hasMore ?? false);
        setHistoryError("");
      } catch (cause) {
        if (!stopped) setHistoryError(cause instanceof Error ? cause.message : "Ticket updates could not be loaded.");
      } finally {
        refreshing = false;
      }
    };
    const timer = window.setInterval(() => void refreshOpenTickets(), 15_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [signedIn, tab]);

  useEffect(() => {
    if (loadingHistory && signedIn) return;
    const anchor = window.location.hash.slice(1);
    if (anchor) document.getElementById(anchor)?.scrollIntoView({ block: "start" });
  }, [loadingHistory, signedIn, tickets]);

  async function lookupTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLookupError("");
    setPublicTicket(null);
    setCopied(false);
    setLookingUp(true);
    try {
      if (!API_URL) throw new Error("Ticket lookup is temporarily unavailable.");
      const response = await fetch(`${API_URL}/api/bets/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketCode: ticketCode.trim() }),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message ?? "Ticket code not found.");
      setPublicTicket(payload as Ticket);
      setLookedUpCode(ticketCode.trim());
    } catch (cause) {
      setLookupError(cause instanceof Error ? cause.message : "Ticket details could not be loaded.");
    } finally {
      setLookingUp(false);
    }
  }

  async function copyTicketCode() {
    try {
      await navigator.clipboard.writeText(lookedUpCode);
      setCopied(true);
    } catch {
      setLookupError("Copy failed. Select the code and copy it manually.");
    }
  }

  async function changeTicketTab(nextTab: "OPEN" | "SETTLED") {
    if (nextTab === tab || loadingHistory) return;
    setLoadingMore(false);
    setTab(nextTab);
    setTickets([]);
    ticketHistoryPages.current = 1;
    setTicketCount(0);
    setHasMoreTickets(false);
    setHistoryError("");
    setLoadingHistory(true);
    const requestId = ++historyRequestId.current;
    try {
      const token = await restoreAccessToken();
      if (!token) throw new Error("Sign in again to view your tickets.");
      const result = await readTicketPage(token, nextTab, 1);
      if (requestId !== historyRequestId.current) return;
      setTickets(result.tickets);
      setTicketCount(result.total);
      setOpenTicketCount(result.openCount);
      setHasMoreTickets(result.hasMore);
      setNextTicketPage(2);
    } catch (cause) {
      if (requestId === historyRequestId.current) {
        setHistoryError(cause instanceof Error ? cause.message : "Your bet history could not be loaded.");
      }
    } finally {
      if (requestId === historyRequestId.current) setLoadingHistory(false);
    }
  }

  async function loadMoreTickets() {
    if (loadingMore || loadingHistory || !hasMoreTickets) return;
    setLoadingMore(true);
    setHistoryError("");
    const requestId = ++historyRequestId.current;
    try {
      const token = await restoreAccessToken();
      if (!token) throw new Error("Sign in again to view your tickets.");
      const result = await readTicketPage(token, tab, nextTicketPage);
      if (requestId !== historyRequestId.current) return;
      setTickets((current) => [...current, ...result.tickets]);
      setTicketCount(result.total);
      setOpenTicketCount(result.openCount);
      setHasMoreTickets(result.hasMore);
      ticketHistoryPages.current = nextTicketPage;
      setNextTicketPage((current) => current + 1);
    } catch (cause) {
      if (requestId === historyRequestId.current) {
        setHistoryError(cause instanceof Error ? cause.message : "More tickets could not be loaded.");
      }
    } finally {
      if (requestId === historyRequestId.current) setLoadingMore(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="SimSoccer home">
          <SportsSoccerIcon aria-hidden="true" />
          <span>SimSoccer</span>
        </Link>
        <nav aria-label="Page links">
          <Link href="/betting">Betting desk</Link>
          <AuthAction />
        </nav>
      </header>

      <div className={styles.content}>
        <Link className={styles.backLink} href="/betting"><ArrowBackIcon fontSize="small" /> Betting desk</Link>
        <div className={styles.title}>
          <h1>My bets</h1>
        </div>

        {signedIn === false ? (
          <section className={styles.lookup} aria-labelledby="lookup-title">
            <div className={styles.lookupHeading}>
              <div>
                <h2 id="lookup-title">Look up a ticket</h2>
                <p>Use the code from your accepted ticket.</p>
              </div>
              <SearchIcon aria-hidden="true" />
            </div>
            <form onSubmit={(event) => void lookupTicket(event)}>
              <label className={styles.srOnly} htmlFor="ticket-code">Ticket code</label>
              <input
                id="ticket-code"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={24}
                placeholder="Paste your 24-character code"
                value={ticketCode}
                onChange={(event) => {
                  setTicketCode(event.target.value);
                  setPublicTicket(null);
                  setLookedUpCode("");
                  setCopied(false);
                }}
                required
              />
              <button type="submit" disabled={lookingUp || !ticketCode.trim()}>
                {lookingUp ? <span className={styles.spinner} aria-hidden="true" /> : null}
                {lookingUp ? "Checking" : "Check ticket"}
              </button>
            </form>
            {lookupError ? <p className={styles.error} role="alert">{lookupError}</p> : null}
            {publicTicket ? (
              <div className={styles.lookupResult}>
                <div className={styles.publicCode}>
                  <span>Ticket code</span>
                  <strong>{lookedUpCode}</strong>
                  <button type="button" aria-label="Copy ticket code" onClick={() => void copyTicketCode()}>
                    <ContentCopyIcon fontSize="small" />
                  </button>
                </div>
                {copied ? <p className={styles.copyNotice} role="status">Code copied.</p> : null}
                <TicketCard ticket={publicTicket} publicView />
              </div>
            ) : null}
          </section>
        ) : null}

        {signedIn ? (
          <section className={styles.history} aria-labelledby="history-title">
            <div className={styles.tabs} role="tablist" aria-label="Bet ticket status">
              <button type="button" role="tab" aria-selected={tab === "OPEN"} onClick={() => void changeTicketTab("OPEN")}>
                Open <span className={styles.tabCount}>{openTicketCount}</span>
              </button>
              <button type="button" role="tab" aria-selected={tab === "SETTLED"} onClick={() => void changeTicketTab("SETTLED")}>
                Settled
              </button>
            </div>
            {loadingHistory ? (
              <div className={styles.ticketSkeletons} role="status" aria-label="Loading tickets">
                <span /><span /><span />
              </div>
            ) : null}
            {historyError ? <p className={styles.error} role="alert">{historyError}</p> : null}
            {!loadingHistory && !historyError && tickets.length === 0 ? (
              <div className={styles.empty}>
                <p>{tab === "OPEN" ? "No open tickets." : "No settled tickets yet."}</p>
                <Link href="/betting">Go to the betting desk</Link>
              </div>
            ) : null}
            <div className={styles.ticketList}>
              {tickets.map((ticket, index) => <TicketCard key={ticket.id ?? `${ticket.placedAt}-${index}`} ticket={ticket} />)}
            </div>
            {!loadingHistory && !historyError && ticketCount > 0 ? (
              <p className={styles.ticketCount} aria-live="polite">
                Showing {tickets.length} of {ticketCount} {tab === "OPEN" ? "open" : "settled"} tickets
              </p>
            ) : null}
            {hasMoreTickets ? (
              <button className={styles.loadMore} type="button" onClick={() => void loadMoreTickets()} disabled={loadingMore || loadingHistory}>
                {loadingMore ? <span className={styles.spinner} aria-hidden="true" /> : null}
                {loadingMore ? "Loading tickets" : "Load more"}
              </button>
            ) : null}
          </section>
        ) : signedIn === false ? (
          <p className={styles.signInNote}>Sign in to see all of your tickets here.</p>
        ) : null}
      </div>
    </main>
  );
}
