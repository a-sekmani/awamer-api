-- CreateEnum
CREATE TYPE "rate_limit_type" AS ENUM ('forgot_password', 'verification_resend');

-- CreateTable
CREATE TABLE "rate_limited_requests" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "type" "rate_limit_type" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_limited_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rate_limited_requests_type_email_createdAt_idx" ON "rate_limited_requests"("type", "email", "createdAt");

-- CreateIndex
CREATE INDEX "rate_limited_requests_type_ip_createdAt_idx" ON "rate_limited_requests"("type", "ip", "createdAt");
