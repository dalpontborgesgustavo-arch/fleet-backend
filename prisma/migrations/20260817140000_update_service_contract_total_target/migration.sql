-- A nova meta de 1 dia util da disponibilizacao juridica aumenta a meta
-- total calculada do fluxo de prestacao de servico de 7 para 8 dias uteis.
DO $$
DECLARE
  view_definition text;
BEGIN
  SELECT pg_get_viewdef('bi.pbi_adm_contratos'::regclass, true)
    INTO view_definition;

  IF POSITION('WHEN ''SERVICO''::text THEN 7' IN view_definition) = 0 THEN
    RAISE EXCEPTION
      'Nao foi possivel localizar a meta total atual do fluxo SERVICO';
  END IF;

  view_definition := REPLACE(
    view_definition,
    'WHEN ''SERVICO''::text THEN 7',
    'WHEN ''SERVICO''::text THEN 8'
  );

  EXECUTE 'CREATE OR REPLACE VIEW bi.pbi_adm_contratos AS '
    || view_definition;
END;
$$;

GRANT SELECT ON bi.pbi_adm_contratos TO powerbi_reader;
