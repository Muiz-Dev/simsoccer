import type { Metadata } from "next";
import BetsPage from "./BetsPage";

export const metadata: Metadata = {
  title: "My bets | SimSoccer",
  description: "Check open and settled SimSoccer bet tickets.",
};

export default function MyBetsPage() {
  return <BetsPage />;
}
