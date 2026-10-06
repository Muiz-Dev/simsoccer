"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { getAccessToken, subscribeAuth } from "@/lib/auth-client";
import styles from "./OpenBetsLink.module.css";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
const OPEN_BETS_UPDATED_EVENT = "simsoccer:open-bets-updated";

type OpenBetsResponse = { openCount: number };

export function notifyOpenBetsUpdated(): void {
  window.dispatchEvent(new Event(OPEN_BETS_UPDATED_EVENT));
}

export default function OpenBetsLink({
  className,
  activeClassName,
  active = false,
  icon,
}: {
  className?: string;
  activeClassName?: string;
  active?: boolean;
  icon?: ReactNode;
}) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [openCount, setOpenCount] = useState<number | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    let mounted = true;
    const updateAuth = (value: boolean) => {
      setSignedIn(value);
      if (!value) setOpenCount(null);
    };
    const unsubscribe = subscribeAuth(updateAuth);
    void getAccessToken()
      .then((token) => { if (mounted) updateAuth(Boolean(token)); })
      .catch(() => { if (mounted) updateAuth(false); });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const refreshOpenCount = useCallback(async () => {
    if (!API_URL) return;
    const currentRequest = ++requestId.current;
    try {
      const token = await getAccessToken();
      if (!token) {
        if (currentRequest === requestId.current) {
          setSignedIn(false);
          setOpenCount(null);
        }
        return;
      }
      const query = new URLSearchParams({ status: "OPEN", page: "1", pageSize: "1" });
      const response = await fetch(`${API_URL}/api/bets?${query}`, {
        headers: { Authorization: ["Bearer", token].join(" ") },
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Open bet count returned HTTP ${response.status}.`);
      const result = await response.json() as OpenBetsResponse;
      if (!Number.isInteger(result.openCount) || result.openCount < 0) {
        throw new Error("Open bet count response was invalid.");
      }
      if (currentRequest === requestId.current) setOpenCount(result.openCount);
    } catch (error) {
      if (currentRequest === requestId.current) {
        console.error("Unable to refresh the open bet count.", error);
        setOpenCount(null);
      }
    }
  }, []);

  useEffect(() => {
    if (signedIn !== true) return;

    const initialRefresh = window.setTimeout(() => void refreshOpenCount(), 0);
    const interval = window.setInterval(() => void refreshOpenCount(), 15_000);
    window.addEventListener(OPEN_BETS_UPDATED_EVENT, refreshOpenCount);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
      window.removeEventListener(OPEN_BETS_UPDATED_EVENT, refreshOpenCount);
      requestId.current += 1;
    };
  }, [refreshOpenCount, signedIn]);

  const linkClassName = [styles.link, className, active ? activeClassName : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <Link
      href="/bets"
      className={linkClassName}
      aria-current={active ? "page" : undefined}
      aria-label={signedIn && openCount !== null ? `My bets, ${openCount} open` : "My bets"}
    >
      {icon}
      <span>My bets</span>
      {signedIn && openCount !== null && openCount > 0 ? (
        <span className={styles.count} aria-hidden="true">{openCount > 99 ? "99+" : openCount}</span>
      ) : null}
    </Link>
  );
}
