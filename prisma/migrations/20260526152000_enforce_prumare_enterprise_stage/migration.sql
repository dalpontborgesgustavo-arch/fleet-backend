UPDATE "PrumareEnterprise"
SET "status" = 'Obras iniciadas'
WHERE COALESCE(BTRIM("status"), '') = ''
   OR "status" NOT IN (
    'Lancamento',
    'Obras iniciadas',
    'Infraestrutura 50%',
    'Entrega proxima',
    'Entregue'
  );

ALTER TABLE "PrumareEnterprise"
ADD CONSTRAINT "PrumareEnterprise_status_stage_check"
CHECK (
  "status" IN (
    'Lancamento',
    'Obras iniciadas',
    'Infraestrutura 50%',
    'Entrega proxima',
    'Entregue'
  )
);
