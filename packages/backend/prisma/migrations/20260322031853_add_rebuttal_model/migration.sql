-- CreateTable
CREATE TABLE "Rebuttal" (
    "id" TEXT NOT NULL,
    "raw_input" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "intent" TEXT,
    "emotional_tone" TEXT,
    "urgency" TEXT,
    "rebuttal_1" TEXT NOT NULL,
    "rebuttal_2" TEXT NOT NULL,
    "rebuttal_3" TEXT NOT NULL,
    "rebuttals_json" JSONB,
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rebuttal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Rebuttal_category_idx" ON "Rebuttal"("category");

-- CreateIndex
CREATE INDEX "Rebuttal_created_at_idx" ON "Rebuttal"("created_at");
