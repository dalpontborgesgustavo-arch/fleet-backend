BEGIN;

ALTER TABLE "Checklist" ADD COLUMN "captured_at" TIMESTAMP(3);

CREATE OR REPLACE VIEW "bi"."checklist_mensal" AS
WITH item_totals AS (
  SELECT
    item."checklistId" AS checklist_id,
    COUNT(*)::integer AS itens_total,
    COUNT(*) FILTER (WHERE item."ok")::integer AS itens_conformes,
    COUNT(*) FILTER (WHERE NOT item."ok")::integer AS itens_nao_conformes
  FROM "ChecklistItem" item
  GROUP BY item."checklistId"
),
occurrence_totals AS (
  SELECT
    occurrence."checklistId" AS checklist_id,
    COUNT(*)::integer AS ocorrencias_total,
    COUNT(*) FILTER (
      WHERE occurrence."status"::text NOT IN ('RESOLVED', 'CANCELLED')
    )::integer AS ocorrencias_abertas,
    COUNT(*) FILTER (
      WHERE occurrence."status"::text IN ('RESOLVED', 'CANCELLED')
    )::integer AS ocorrencias_encerradas,
    COUNT(*) FILTER (WHERE occurrence."severity"::text = 'HIGH')::integer AS ocorrencias_alta_severidade,
    COUNT(*) FILTER (WHERE occurrence."isEmergency")::integer AS ocorrencias_emergenciais
  FROM "Occurrence" occurrence
  WHERE occurrence."checklistId" IS NOT NULL
  GROUP BY occurrence."checklistId"
),
occurrence_photo_totals AS (
  SELECT
    occurrence."checklistId" AS checklist_id,
    COUNT(photo."id")::integer AS fotos_ocorrencias
  FROM "Occurrence" occurrence
  INNER JOIN "OccurrencePhoto" photo ON photo."occurrenceId" = occurrence."id"
  WHERE occurrence."checklistId" IS NOT NULL
  GROUP BY occurrence."checklistId"
),
fleet_photo_totals AS (
  SELECT
    checklist."id" AS checklist_id,
    COUNT(*) FILTER (
      WHERE NULLIF(BTRIM(photo.entry ->> 'photoUrl'), '') IS NOT NULL
    )::integer AS fotos_frota,
    COUNT(DISTINCT photo.entry ->> 'slot') FILTER (
      WHERE photo.entry ->> 'slot' IN ('front', 'rear', 'interior', 'left', 'right')
        AND NULLIF(BTRIM(photo.entry ->> 'photoUrl'), '') IS NOT NULL
    )::integer AS fotos_padrao_presentes,
    BOOL_OR(
      photo.entry ->> 'slot' = 'timeClockDevice'
      AND NULLIF(BTRIM(photo.entry ->> 'photoUrl'), '') IS NOT NULL
    ) AS foto_dispositivo_ponto_presente
  FROM "Checklist" checklist
  LEFT JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(checklist."fleetPhotos") = 'array' THEN checklist."fleetPhotos"
      ELSE '[]'::jsonb
    END
  ) AS photo(entry) ON TRUE
  WHERE checklist."type"::text = 'MONTHLY'
  GROUP BY checklist."id"
)
SELECT
  checklist."id" AS checklist_id,
  checklist."vehicleId" || '|' || checklist."year"::text || '-' || LPAD(checklist."month"::text, 2, '0') AS chave_veiculo_competencia,
  checklist."title" AS titulo,
  checklist."status" AS status_checklist,
  checklist."month" AS mes,
  checklist."year" AS ano,
  MAKE_DATE(checklist."year", checklist."month", 1) AS competencia,
  COALESCE(checklist."captured_at", checklist."createdAt") AS realizado_em,
  checklist."createdBy" AS supervisor_id,
  creator."name" AS supervisor_nome,
  creator."email" AS supervisor_email,
  creator."role" AS supervisor_perfil,
  creator."tipoFrota" AS supervisor_tipo_frota,
  checklist."vehicleId" AS veiculo_id,
  vehicle."fleet" AS frota,
  vehicle."plate" AS placa,
  vehicle."name" AS veiculo_nome,
  vehicle."model" AS modelo,
  vehicle."type" AS subtipo_veiculo,
  vehicle."vehicleType" AS tipo_veiculo,
  vehicle."tipoFrota" AS tipo_frota,
  vehicle."active" AS veiculo_ativo,
  vehicle."responsibleName" AS responsavel_veiculo_nome,
  vehicle."responsibleEmail" AS responsavel_veiculo_email,
  vehicle."hasTimeClockDevice" AS possui_dispositivo_ponto,
  COALESCE(item_totals.itens_total, 0)::integer AS itens_total,
  COALESCE(item_totals.itens_conformes, 0)::integer AS itens_conformes,
  COALESCE(item_totals.itens_nao_conformes, 0)::integer AS itens_nao_conformes,
  (COALESCE(item_totals.itens_nao_conformes, 0) > 0) AS possui_nao_conformidade,
  CASE
    WHEN COALESCE(item_totals.itens_total, 0) = 0 THEN 0::numeric
    ELSE ROUND(
      COALESCE(item_totals.itens_conformes, 0)::numeric
        / item_totals.itens_total::numeric * 100,
      2
    )
  END AS percentual_conformidade,
  COALESCE(occurrence_totals.ocorrencias_total, 0)::integer AS ocorrencias_total,
  COALESCE(occurrence_totals.ocorrencias_abertas, 0)::integer AS ocorrencias_abertas,
  COALESCE(occurrence_totals.ocorrencias_encerradas, 0)::integer AS ocorrencias_encerradas,
  COALESCE(occurrence_totals.ocorrencias_alta_severidade, 0)::integer AS ocorrencias_alta_severidade,
  COALESCE(occurrence_totals.ocorrencias_emergenciais, 0)::integer AS ocorrencias_emergenciais,
  COALESCE(fleet_photo_totals.fotos_frota, 0)::integer AS fotos_frota,
  COALESCE(occurrence_photo_totals.fotos_ocorrencias, 0)::integer AS fotos_ocorrencias,
  (
    COALESCE(fleet_photo_totals.fotos_frota, 0)
      + COALESCE(occurrence_photo_totals.fotos_ocorrencias, 0)
  )::integer AS fotos_total,
  (5 + CASE WHEN vehicle."hasTimeClockDevice" IS TRUE THEN 1 ELSE 0 END)::integer AS fotos_obrigatorias_esperadas,
  (
    COALESCE(fleet_photo_totals.fotos_padrao_presentes, 0)
      + CASE
          WHEN vehicle."hasTimeClockDevice" IS TRUE
            AND COALESCE(fleet_photo_totals.foto_dispositivo_ponto_presente, FALSE)
            THEN 1
          ELSE 0
        END
  )::integer AS fotos_obrigatorias_presentes,
  (
    COALESCE(fleet_photo_totals.fotos_padrao_presentes, 0) = 5
    AND (
      vehicle."hasTimeClockDevice" IS NOT TRUE
      OR COALESCE(fleet_photo_totals.foto_dispositivo_ponto_presente, FALSE)
    )
  ) AS fotos_obrigatorias_completas,
  COALESCE(fleet_photo_totals.foto_dispositivo_ponto_presente, FALSE) AS foto_dispositivo_ponto_presente,
  checklist."photoUrl" AS foto_representativa_url_origem,
  CASE
    WHEN NULLIF(BTRIM(checklist."photoUrl"), '') IS NULL THEN NULL
    WHEN checklist."photoUrl" ~* '^(https?://|data:|blob:)' THEN checklist."photoUrl"
    ELSE 'https://api.jrconstrucoes.net.br/' || LTRIM(checklist."photoUrl", '/')
  END AS foto_representativa_url,
  (LOWER(COALESCE(vehicle."tipoFrota", '')) = 'veiculos') AS consentimento_aplicavel,
  consent."id" AS consentimento_id,
  COALESCE(
    consent."status"::text,
    CASE
      WHEN LOWER(COALESCE(vehicle."tipoFrota", '')) = 'veiculos' THEN 'NOT_SENT'
      ELSE 'NOT_APPLICABLE'
    END
  ) AS consentimento_status,
  CASE COALESCE(
    consent."status"::text,
    CASE
      WHEN LOWER(COALESCE(vehicle."tipoFrota", '')) = 'veiculos' THEN 'NOT_SENT'
      ELSE 'NOT_APPLICABLE'
    END
  )
    WHEN 'PENDING' THEN 'Pendente'
    WHEN 'CONFIRMED' THEN 'Confirmado'
    WHEN 'REJECTED' THEN 'Contestado'
    WHEN 'NOT_SENT' THEN 'Nao enviado'
    ELSE 'Nao se aplica'
  END AS consentimento_status_nome,
  consent."responsibleName" AS consentimento_responsavel_nome,
  consent."responsibleEmail" AS consentimento_responsavel_email,
  consent."sentAt" AS consentimento_enviado_em,
  consent."lastEmailError" AS consentimento_erro_envio,
  consent."lastReminderAt" AS consentimento_ultimo_lembrete_em,
  consent."lastReminderError" AS consentimento_erro_lembrete,
  COALESCE(consent."reminderCount", 0)::integer AS consentimento_lembretes,
  consent."consentedAt" AS consentimento_confirmado_em,
  consent."rejectedAt" AS consentimento_contestado_em,
  consent."note" AS consentimento_observacao,
  consent."expiresAt" AS consentimento_expira_em,
  (
    consent."status"::text = 'PENDING'
    AND consent."expiresAt" IS NOT NULL
    AND consent."expiresAt" < NOW()
  ) AS consentimento_expirado
FROM "Checklist" checklist
LEFT JOIN "User" creator ON creator."id" = checklist."createdBy"
LEFT JOIN "Vehicle" vehicle ON vehicle."id" = checklist."vehicleId"
LEFT JOIN "ChecklistConsent" consent ON consent."checklistId" = checklist."id"
LEFT JOIN item_totals ON item_totals.checklist_id = checklist."id"
LEFT JOIN occurrence_totals ON occurrence_totals.checklist_id = checklist."id"
LEFT JOIN occurrence_photo_totals ON occurrence_photo_totals.checklist_id = checklist."id"
LEFT JOIN fleet_photo_totals ON fleet_photo_totals.checklist_id = checklist."id"
WHERE checklist."type"::text = 'MONTHLY';

CREATE OR REPLACE VIEW "bi"."checklist_mensal_ajudas" AS
SELECT
  checklist."id" AS checklist_id,
  MAKE_DATE(checklist."year", checklist."month", 1) AS competencia,
  COALESCE(checklist."captured_at", checklist."createdAt") AS realizado_em,
  checklist."vehicleId" AS veiculo_id,
  vehicle."fleet" AS frota,
  vehicle."plate" AS placa,
  vehicle."name" AS veiculo_nome,
  vehicle."tipoFrota" AS tipo_frota,
  checklist."monthly_responsible_user_id" AS responsavel_mensal_id,
  COALESCE(checklist."monthly_responsible_name", responsible."name") AS responsavel_mensal_nome,
  checklist."createdBy" AS executor_id,
  creator."name" AS executor_nome,
  checklist."assisted_execution" AS realizado_por_ajuda
FROM "Checklist" checklist
LEFT JOIN "Vehicle" vehicle ON vehicle."id" = checklist."vehicleId"
LEFT JOIN "User" responsible ON responsible."id" = checklist."monthly_responsible_user_id"
LEFT JOIN "User" creator ON creator."id" = checklist."createdBy"
WHERE checklist."type"::text = 'MONTHLY';

COMMIT;
