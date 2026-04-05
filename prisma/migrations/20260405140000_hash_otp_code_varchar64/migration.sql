-- AlterTable: expand code column to hold SHA-256 hex (64 chars)
ALTER TABLE "email_verifications" ALTER COLUMN "code" SET DATA TYPE VARCHAR(64);
