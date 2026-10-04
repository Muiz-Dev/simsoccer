"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";

export default function AuthAction() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (active) setSignedIn(Boolean(data.user));
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session?.user));
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return <Link href={signedIn ? "/account" : "/auth"}>{signedIn ? "Account" : "Sign in"}</Link>;
}