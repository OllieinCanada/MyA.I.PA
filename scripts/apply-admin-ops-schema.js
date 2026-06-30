require("dotenv").config();

const { Client } = require("pg");

const sql = `
DO $$ BEGIN
  CREATE TYPE "CallOutcome" AS ENUM ('UNREVIEWED','BOOKED','QUOTE_NEEDED','EMERGENCY','SPAM','FOLLOW_UP','NOT_A_LEAD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TaskStatus" AS ENUM ('OPEN','DONE','ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "externalProvider" TEXT;
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "outcome" "CallOutcome" NOT NULL DEFAULT 'UNREVIEWED';
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "qualityScore" INTEGER;
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "aiSummary" TEXT;
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "followUpNeeded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "lastAlertAt" TIMESTAMP(3);
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "twilioCallSid" TEXT;
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "twilioPrice" DOUBLE PRECISION;
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "twilioPriceUnit" TEXT;
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "vapiCost" DOUBLE PRECISION;
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "vapiCostBreakdown" JSONB;
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "totalInternalCost" DOUBLE PRECISION;
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "costSyncedAt" TIMESTAMP(3);

ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "qualityScore" INTEGER;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "outcomeTag" TEXT;

CREATE TABLE IF NOT EXISTS "CallNote" (
  "id" SERIAL PRIMARY KEY,
  "callId" INTEGER NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CallNote_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "CallTask" (
  "id" SERIAL PRIMARY KEY,
  "callId" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
  "dueAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CallTask_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "VapiBusinessMapping" (
  "id" SERIAL PRIMARY KEY,
  "businessId" INTEGER NOT NULL,
  "matchType" TEXT NOT NULL,
  "matchValue" TEXT NOT NULL UNIQUE,
  "label" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VapiBusinessMapping_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Call_outcome_idx" ON "Call"("outcome");
CREATE UNIQUE INDEX IF NOT EXISTS "Call_externalProvider_externalId_key" ON "Call"("externalProvider","externalId");
CREATE UNIQUE INDEX IF NOT EXISTS "Call_twilioCallSid_key" ON "Call"("twilioCallSid");
CREATE INDEX IF NOT EXISTS "Call_twilioCallSid_idx" ON "Call"("twilioCallSid");
CREATE INDEX IF NOT EXISTS "Call_costSyncedAt_idx" ON "Call"("costSyncedAt");
CREATE INDEX IF NOT EXISTS "CallNote_callId_createdAt_idx" ON "CallNote"("callId","createdAt");
CREATE INDEX IF NOT EXISTS "CallTask_callId_status_idx" ON "CallTask"("callId","status");
CREATE INDEX IF NOT EXISTS "CallTask_dueAt_idx" ON "CallTask"("dueAt");
CREATE INDEX IF NOT EXISTS "VapiBusinessMapping_businessId_idx" ON "VapiBusinessMapping"("businessId");
CREATE INDEX IF NOT EXISTS "VapiBusinessMapping_matchType_idx" ON "VapiBusinessMapping"("matchType");
`;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
  console.log("Admin ops schema is applied.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
