ALTER TABLE "AethosContract"
ADD COLUMN "generatedAttachments" JSONB;

UPDATE "AethosContract"
SET "generatedAttachments" = raw -> 'anexosGerados'
WHERE jsonb_typeof(raw -> 'anexosGerados') = 'object';
