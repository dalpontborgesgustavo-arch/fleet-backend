BEGIN;
ALTER TABLE "ProductionControlLine" ADD COLUMN "monthlyTarget" DECIMAL(16,3);
-- Preserve only complete, pre-existing monthly allocations. Never substitute
-- weekly forecasts or interpret a missing allocation as zero.
WITH calendar AS (
  SELECT id, to_date(competence || '-01','YYYY-MM-DD') AS start
  FROM "ProductionControlLine"
), periods AS (
  SELECT id, ceil((extract(dow FROM start) + extract(day FROM (start + interval '1 month - 1 day'))) / 7)::int AS weeks
  FROM calendar
), targets AS (
  SELECT p.id, sum(w."monthPlanQuantity") AS target
  FROM periods p JOIN "ProductionControlWeek" w ON w."lineId" = p.id
    AND w."weekIndex" >= 0 AND w."weekIndex" < p.weeks
  GROUP BY p.id, p.weeks HAVING count(w."monthPlanQuantity") = p.weeks
)
UPDATE "ProductionControlLine" l SET "monthlyTarget" = t.target
FROM targets t WHERE t.id = l.id;
COMMIT;
