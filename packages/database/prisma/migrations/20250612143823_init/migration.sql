-- CreateTable
CREATE TABLE "monitored_accounts" (
    "id" SERIAL NOT NULL,
    "x_account_id" TEXT NOT NULL,
    "x_username" TEXT NOT NULL,
    "display_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitored_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" SERIAL NOT NULL,
    "post_id" TEXT NOT NULL,
    "account_id" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "post_url" TEXT NOT NULL,
    "posted_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_results" (
    "id" SERIAL NOT NULL,
    "post_id" INTEGER NOT NULL,
    "sentiment_score" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "decision" VARCHAR(10) NOT NULL,
    "reasons" JSONB NOT NULL,
    "market_conditions" JSONB,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trades" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "analysis_id" INTEGER NOT NULL,
    "token_symbol" VARCHAR(10) NOT NULL,
    "token_amount" DOUBLE PRECISION NOT NULL,
    "price_usd" DOUBLE PRECISION NOT NULL,
    "transaction_hash" TEXT,
    "is_paper_trade" BOOLEAN NOT NULL DEFAULT true,
    "status" VARCHAR(10) NOT NULL,
    "executed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error_message" TEXT,

    CONSTRAINT "trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "monitored_accounts_x_account_id_key" ON "monitored_accounts"("x_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "posts_post_id_key" ON "posts"("post_id");

-- CreateIndex
CREATE INDEX "posts_account_id_idx" ON "posts"("account_id");

-- CreateIndex
CREATE INDEX "posts_posted_at_idx" ON "posts"("posted_at");

-- CreateIndex
CREATE INDEX "analysis_results_post_id_idx" ON "analysis_results"("post_id");

-- CreateIndex
CREATE INDEX "analysis_results_decision_idx" ON "analysis_results"("decision");

-- CreateIndex
CREATE UNIQUE INDEX "trades_uuid_key" ON "trades"("uuid");

-- CreateIndex
CREATE INDEX "trades_analysis_id_idx" ON "trades"("analysis_id");

-- CreateIndex
CREATE INDEX "trades_status_idx" ON "trades"("status");

-- CreateIndex
CREATE INDEX "trades_executed_at_idx" ON "trades"("executed_at");

-- CreateIndex
CREATE INDEX "notifications_type_idx" ON "notifications"("type");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "monitored_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_results" ADD CONSTRAINT "analysis_results_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "analysis_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
