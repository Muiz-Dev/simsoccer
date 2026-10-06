"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import { restoreAccessToken, subscribeAuth } from "@/lib/auth-client";

export default function AuthAction() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeAuth((value) => setSignedIn(value));
    void restoreAccessToken()
      .then((token) => { if (active) setSignedIn(Boolean(token)); })
      .catch(() => { if (active) setSignedIn(false); });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return (
    <Link href={signedIn ? "/account" : "/auth"} aria-label={signedIn ? "My account" : "Sign in"}>
      {signedIn ? <AccountCircleIcon fontSize="small" aria-hidden="true" /> : "Sign in"}
    </Link>
  );
}
