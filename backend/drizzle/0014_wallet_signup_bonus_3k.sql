-- Set the default wallet balance to match the 3,000-credit signup bonus.
ALTER TABLE "wallets" ALTER COLUMN "balance" SET DEFAULT '3000.00';
