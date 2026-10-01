import type { Metadata } from "next";
import BettingDesk from "./BettingDesk";

export const metadata: Metadata = {
  title: "Markets | SimSoccer",
  description: "Browse virtual football markets and save a selection with a booking code.",
};

export default function BettingPage() {
  return <BettingDesk />;
}
