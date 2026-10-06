import Image from "next/image";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import styles from "./PaymentDialogs.module.css";

export default function WalletIcon({ icon, size = 34 }: { icon: string | null; size?: number }) {
  return (
    <span className={styles.walletIconFrame} style={{ width: size, height: size, flexBasis: size }}>
      {icon ? (
        <Image className={styles.walletIcon} src={icon} alt="" width={size} height={size} unoptimized />
      ) : (
        <AccountBalanceWalletIcon className={styles.walletIconFallback} aria-hidden="true" />
      )}
    </span>
  );
}
