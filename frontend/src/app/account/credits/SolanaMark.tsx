import Image from "next/image";

export default function SolanaMark({ className }: { className: string }) {
  return <Image className={className} src="/solana-logo.svg" alt="" width={24} height={21} aria-hidden="true" />;
}
