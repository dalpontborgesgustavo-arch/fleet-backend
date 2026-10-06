CREATE SCHEMA IF NOT EXISTS "bi";

DROP VIEW IF EXISTS "bi"."checklist_mensal_resumo";
DROP VIEW IF EXISTS "bi"."checklist_mensal_fotos";
DROP VIEW IF EXISTS "bi"."checklist_mensal_ocorrencias";
DROP VIEW IF EXISTS "bi"."checklist_mensal_itens";
DROP VIEW IF EXISTS "bi"."checklist_mensal_cobertura";
DROP VIEW IF EXISTS "bi"."checklist_mensal";

CREATE VIEW "bi"."checklist_mensal" AS
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
  checklist."createdAt" AS realizado_em,
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

CREATE VIEW "bi"."checklist_mensal_cobertura" AS
WITH bounds AS (
  SELECT LEAST(
    COALESCE(
      MIN(MAKE_DATE(checklist."year", checklist."month", 1)),
      DATE_TRUNC('month', CURRENT_DATE)::date
    ),
    DATE_TRUNC('month', CURRENT_DATE)::date
  ) AS primeira_competencia
  FROM "Checklist" checklist
  WHERE checklist."type"::text = 'MONTHLY'
    AND checklist."month" BETWEEN 1 AND 12
    AND checklist."year" BETWEEN 2000 AND 2100
),
periods AS (
  SELECT GENERATE_SERIES(
    bounds.primeira_competencia::timestamp,
    DATE_TRUNC('month', CURRENT_DATE),
    INTERVAL '1 month'
  )::date AS competencia
  FROM bounds
),
period_metrics AS (
  SELECT
    period.competencia,
    (
      SELECT COUNT(*)::integer
      FROM GENERATE_SERIES(
        period.competencia,
        (period.competencia + INTERVAL '1 month - 1 day')::date,
        INTERVAL '1 day'
      ) calendar_day
      WHERE EXTRACT(ISODOW FROM calendar_day) BETWEEN 1 AND 5
    ) AS dias_uteis_mes,
    CASE
      WHEN period.competencia < DATE_TRUNC('month', CURRENT_DATE)::date THEN (
        SELECT COUNT(*)::integer
        FROM GENERATE_SERIES(
          period.competencia,
          (period.competencia + INTERVAL '1 month - 1 day')::date,
          INTERVAL '1 day'
        ) calendar_day
        WHERE EXTRACT(ISODOW FROM calendar_day) BETWEEN 1 AND 5
      )
      WHEN period.competencia = DATE_TRUNC('month', CURRENT_DATE)::date THEN (
        SELECT COUNT(*)::integer
        FROM GENERATE_SERIES(
          period.competencia,
          CURRENT_DATE,
          INTERVAL '1 day'
        ) calendar_day
        WHERE EXTRACT(ISODOW FROM calendar_day) BETWEEN 1 AND 5
      )
      ELSE 0
    END AS dias_uteis_decorridos
  FROM periods period
),
checklist_period AS (
  SELECT
    checklist.chave_veiculo_competencia,
    checklist.veiculo_id,
    checklist.competencia,
    COUNT(*)::integer AS checklists_realizados,
    MIN(checklist.realizado_em) AS primeiro_checklist_em,
    MAX(checklist.realizado_em) AS ultimo_checklist_em,
    (ARRAY_AGG(checklist.checklist_id ORDER BY checklist.realizado_em DESC))[1] AS checklist_mais_recente_id,
    COUNT(*) FILTER (WHERE checklist.possui_nao_conformidade)::integer AS checklists_com_nc,
    SUM(checklist.itens_nao_conformes)::integer AS itens_nao_conformes,
    SUM(checklist.ocorrencias_total)::integer AS ocorrencias_total,
    SUM(checklist.ocorrencias_abertas)::integer AS ocorrencias_abertas,
    SUM(checklist.fotos_total)::integer AS fotos_total,
    COUNT(*) FILTER (WHERE checklist.fotos_obrigatorias_completas)::integer AS checklists_com_fotos_completas,
    COUNT(*) FILTER (WHERE checklist.consentimento_status = 'CONFIRMED')::integer AS consentimentos_confirmados,
    COUNT(*) FILTER (WHERE checklist.consentimento_status = 'REJECTED')::integer AS consentimentos_contestados,
    COUNT(*) FILTER (WHERE checklist.consentimento_status = 'PENDING')::integer AS consentimentos_pendentes
  FROM "bi"."checklist_mensal" checklist
  GROUP BY
    checklist.chave_veiculo_competencia,
    checklist.veiculo_id,
    checklist.competencia
),
supervisors AS (
  SELECT
    user_record."tipoFrota" AS tipo_frota,
    STRING_AGG(user_record."name", ', ' ORDER BY user_record."name") AS supervisores_referencia
  FROM "User" user_record
  WHERE user_record."role" = 'supervisor'
    AND NULLIF(BTRIM(user_record."tipoFrota"), '') IS NOT NULL
  GROUP BY user_record."tipoFrota"
)
SELECT
  vehicle."id" || '|' || TO_CHAR(metric.competencia, 'YYYY-MM') AS chave_veiculo_competencia,
  metric.competencia,
  EXTRACT(MONTH FROM metric.competencia)::integer AS mes,
  EXTRACT(YEAR FROM metric.competencia)::integer AS ano,
  CASE
    WHEN metric.competencia < DATE_TRUNC('month', CURRENT_DATE)::date THEN 'ENCERRADO'
    WHEN metric.competencia = DATE_TRUNC('month', CURRENT_DATE)::date THEN 'ATUAL'
    ELSE 'FUTURO'
  END AS situacao_periodo,
  metric.dias_uteis_mes,
  metric.dias_uteis_decorridos,
  CASE
    WHEN metric.competencia < DATE_TRUNC('month', CURRENT_DATE)::date THEN 0
    ELSE GREATEST(1, metric.dias_uteis_mes - metric.dias_uteis_decorridos + 1)
  END::integer AS dias_uteis_restantes,
  vehicle."id" AS veiculo_id,
  vehicle."fleet" AS frota,
  vehicle."plate" AS placa,
  vehicle."name" AS veiculo_nome,
  vehicle."model" AS modelo,
  vehicle."type" AS subtipo_veiculo,
  vehicle."vehicleType" AS tipo_veiculo,
  vehicle."tipoFrota" AS tipo_frota,
  vehicle."responsibleName" AS responsavel_veiculo_nome,
  vehicle."responsibleEmail" AS responsavel_veiculo_email,
  vehicle."hasTimeClockDevice" AS possui_dispositivo_ponto,
  supervisors.supervisores_referencia,
  (COALESCE(checklist_period.checklists_realizados, 0) > 0) AS realizado,
  CASE
    WHEN COALESCE(checklist_period.checklists_realizados, 0) > 0 THEN 'Realizado'
    ELSE 'Pendente'
  END AS status_realizacao,
  COALESCE(checklist_period.checklists_realizados, 0)::integer AS checklists_realizados,
  checklist_period.checklist_mais_recente_id,
  checklist_period.primeiro_checklist_em,
  checklist_period.ultimo_checklist_em,
  COALESCE(checklist_period.checklists_com_nc, 0)::integer AS checklists_com_nc,
  COALESCE(checklist_period.itens_nao_conformes, 0)::integer AS itens_nao_conformes,
  COALESCE(checklist_period.ocorrencias_total, 0)::integer AS ocorrencias_total,
  COALESCE(checklist_period.ocorrencias_abertas, 0)::integer AS ocorrencias_abertas,
  COALESCE(checklist_period.fotos_total, 0)::integer AS fotos_total,
  COALESCE(checklist_period.checklists_com_fotos_completas, 0)::integer AS checklists_com_fotos_completas,
  COALESCE(checklist_period.consentimentos_confirmados, 0)::integer AS consentimentos_confirmados,
  COALESCE(checklist_period.consentimentos_contestados, 0)::integer AS consentimentos_contestados,
  COALESCE(checklist_period.consentimentos_pendentes, 0)::integer AS consentimentos_pendentes
FROM period_metrics metric
CROSS JOIN "Vehicle" vehicle
LEFT JOIN checklist_period
  ON checklist_period.veiculo_id = vehicle."id"
  AND checklist_period.competencia = metric.competencia
LEFT JOIN supervisors ON supervisors.tipo_frota = vehicle."tipoFrota"
WHERE vehicle."active" = TRUE;

CREATE VIEW "bi"."checklist_mensal_itens" AS
SELECT
  item."id" AS item_id,
  checklist.checklist_id,
  checklist.chave_veiculo_competencia,
  checklist.competencia,
  checklist.realizado_em,
  checklist.veiculo_id,
  checklist.frota,
  checklist.placa,
  checklist.veiculo_nome,
  checklist.modelo,
  checklist.tipo_veiculo,
  checklist.tipo_frota,
  checklist.supervisor_id,
  checklist.supervisor_nome,
  item."label" AS pergunta,
  item."ok" AS conforme,
  CASE WHEN item."ok" THEN 'Conforme' ELSE 'Nao conforme' END AS resultado,
  item."createdAt" AS respondido_em,
  (COALESCE(occurrence_summary.ocorrencias_total, 0) > 0) AS possui_ocorrencia,
  COALESCE(occurrence_summary.ocorrencias_total, 0)::integer AS ocorrencias_total,
  COALESCE(occurrence_summary.ocorrencias_abertas, 0)::integer AS ocorrencias_abertas,
  COALESCE(occurrence_summary.fotos_evidencia, 0)::integer AS fotos_evidencia,
  occurrence_summary.primeira_ocorrencia_id
FROM "ChecklistItem" item
INNER JOIN "bi"."checklist_mensal" checklist ON checklist.checklist_id = item."checklistId"
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)::integer AS ocorrencias_total,
    COUNT(*) FILTER (
      WHERE occurrence."status"::text NOT IN ('RESOLVED', 'CANCELLED')
    )::integer AS ocorrencias_abertas,
    COALESCE(SUM((
      SELECT COUNT(*)
      FROM "OccurrencePhoto" photo
      WHERE photo."occurrenceId" = occurrence."id"
    )), 0)::integer AS fotos_evidencia,
    (ARRAY_AGG(occurrence."id" ORDER BY occurrence."createdAt"))[1] AS primeira_ocorrencia_id
  FROM "Occurrence" occurrence
  WHERE occurrence."checklistId" = item."checklistId"
    AND LOWER(BTRIM(occurrence."questionLabel")) = LOWER(BTRIM(item."label"))
) occurrence_summary ON TRUE;

CREATE VIEW "bi"."checklist_mensal_ocorrencias" AS
SELECT
  occurrence."id" AS ocorrencia_id,
  checklist.checklist_id,
  checklist.chave_veiculo_competencia,
  checklist.competencia,
  checklist.realizado_em AS checklist_realizado_em,
  occurrence."questionId" AS pergunta_id,
  occurrence."questionLabel" AS pergunta,
  question."critical" AS pergunta_critica,
  occurrence."description" AS descricao,
  occurrence."status"::text AS status,
  CASE occurrence."status"::text
    WHEN 'OPEN' THEN 'Aberta'
    WHEN 'PENDING_SUPERVISOR' THEN 'Aguardando supervisor'
    WHEN 'APPROVED_SUPERVISOR' THEN 'Aguardando programacao'
    WHEN 'REJECTED_SUPERVISOR' THEN 'Rejeitada pelo supervisor'
    WHEN 'IN_PROGRESS' THEN 'Em execucao'
    WHEN 'RESOLVED' THEN 'Resolvida'
    WHEN 'CANCELLED' THEN 'Cancelada'
    ELSE occurrence."status"::text
  END AS status_nome,
  occurrence."severity"::text AS severidade,
  CASE occurrence."severity"::text
    WHEN 'HIGH' THEN 'Alta'
    WHEN 'MEDIUM' THEN 'Media'
    WHEN 'LOW' THEN 'Baixa'
    ELSE occurrence."severity"::text
  END AS severidade_nome,
  occurrence."isEmergency" AS emergencial,
  (occurrence."status"::text NOT IN ('RESOLVED', 'CANCELLED')) AS aberta,
  occurrence."createdAt" AS criada_em,
  occurrence."updatedAt" AS atualizada_em,
  occurrence."createdBy" AS criada_por_id,
  creator."name" AS criada_por_nome,
  creator."email" AS criada_por_email,
  checklist.veiculo_id,
  checklist.frota,
  checklist.placa,
  checklist.veiculo_nome,
  checklist.modelo,
  checklist.tipo_veiculo,
  checklist.tipo_frota,
  occurrence."localExecucao" AS local_execucao,
  occurrence."responsavelUserId" AS responsavel_id,
  responsible."name" AS responsavel_nome,
  responsible."email" AS responsavel_email,
  occurrence."maintenanceTargetUserId" AS manutencao_destino_id,
  maintenance_target."name" AS manutencao_destino_nome,
  occurrence."dataEntrada" AS entrada_em,
  occurrence."dataPrevistaSaida" AS previsao_saida_em,
  occurrence."entregaLimiteEm" AS entrega_limite_em,
  occurrence."entregueEm" AS entregue_em,
  occurrence."dataInicioExecucao" AS inicio_execucao_em,
  occurrence."dataConclusao" AS conclusao_em,
  (
    occurrence."dataPrevistaSaida" IS NOT NULL
    AND occurrence."dataPrevistaSaida" < NOW()
    AND occurrence."status"::text NOT IN ('RESOLVED', 'CANCELLED')
  ) AS atrasada,
  FLOOR(EXTRACT(EPOCH FROM (COALESCE(occurrence."dataConclusao", NOW()) - occurrence."createdAt")) / 86400)::integer AS dias_em_aberto,
  CASE
    WHEN occurrence."dataConclusao" IS NULL THEN NULL
    ELSE ROUND(
      (EXTRACT(EPOCH FROM (occurrence."dataConclusao" - occurrence."createdAt")) / 3600)::numeric,
      2
    )
  END AS horas_ate_resolucao,
  COALESCE(photo_summary.fotos_total, 0)::integer AS fotos_total,
  photo_summary.foto_principal_url_origem,
  CASE
    WHEN NULLIF(BTRIM(photo_summary.foto_principal_url_origem), '') IS NULL THEN NULL
    WHEN photo_summary.foto_principal_url_origem ~* '^(https?://|data:|blob:)' THEN photo_summary.foto_principal_url_origem
    ELSE 'https://api.jrconstrucoes.net.br/' || LTRIM(photo_summary.foto_principal_url_origem, '/')
  END AS foto_principal_url
FROM "Occurrence" occurrence
INNER JOIN "bi"."checklist_mensal" checklist ON checklist.checklist_id = occurrence."checklistId"
LEFT JOIN "ChecklistQuestion" question ON question."id" = occurrence."questionId"
LEFT JOIN "User" creator ON creator."id" = occurrence."createdBy"
LEFT JOIN "User" responsible ON responsible."id" = occurrence."responsavelUserId"
LEFT JOIN "User" maintenance_target ON maintenance_target."id" = occurrence."maintenanceTargetUserId"
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)::integer AS fotos_total,
    (ARRAY_AGG(photo."url" ORDER BY photo."createdAt", photo."id"))[1] AS foto_principal_url_origem
  FROM "OccurrencePhoto" photo
  WHERE photo."occurrenceId" = occurrence."id"
) photo_summary ON TRUE;

CREATE VIEW "bi"."checklist_mensal_fotos" AS
WITH fleet_photos AS (
  SELECT
    checklist.checklist_id || ':frota:' || photo.ordinality::text AS foto_id,
    checklist.checklist_id,
    checklist.chave_veiculo_competencia,
    checklist.competencia,
    checklist.realizado_em AS checklist_realizado_em,
    checklist.veiculo_id,
    checklist.frota,
    checklist.placa,
    checklist.veiculo_nome,
    checklist.modelo,
    checklist.tipo_veiculo,
    checklist.tipo_frota,
    'FROTA'::text AS tipo_foto,
    'Foto obrigatoria da frota'::text AS tipo_foto_nome,
    photo.entry ->> 'slot' AS slot,
    COALESCE(
      NULLIF(BTRIM(photo.entry ->> 'label'), ''),
      CASE photo.entry ->> 'slot'
        WHEN 'front' THEN 'Foto frontal'
        WHEN 'rear' THEN 'Foto traseira'
        WHEN 'interior' THEN 'Foto interna'
        WHEN 'left' THEN 'Foto lado esquerdo'
        WHEN 'right' THEN 'Foto lado direito'
        WHEN 'timeClockDevice' THEN 'Foto do dispositivo de ponto'
        ELSE 'Foto da frota'
      END
    ) AS foto_descricao,
    photo.ordinality::integer AS foto_ordem,
    NULL::text AS ocorrencia_id,
    NULL::text AS pergunta,
    NULL::text AS descricao_ocorrencia,
    NULL::text AS status_ocorrencia,
    NULL::text AS severidade_ocorrencia,
    photo.entry ->> 'photoUrl' AS url_origem,
    CASE
      WHEN photo.entry ->> 'photoUrl' ~* '^(https?://|data:|blob:)' THEN photo.entry ->> 'photoUrl'
      ELSE 'https://api.jrconstrucoes.net.br/' || LTRIM(photo.entry ->> 'photoUrl', '/')
    END AS url_imagem,
    checklist.realizado_em AS foto_criada_em,
    FALSE AS evidencia_nao_conformidade,
    (photo.entry ->> 'slot' = 'timeClockDevice') AS foto_dispositivo_ponto
  FROM "bi"."checklist_mensal" checklist
  INNER JOIN "Checklist" source_checklist ON source_checklist."id" = checklist.checklist_id
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(source_checklist."fleetPhotos") = 'array' THEN source_checklist."fleetPhotos"
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS photo(entry, ordinality)
  WHERE NULLIF(BTRIM(photo.entry ->> 'photoUrl'), '') IS NOT NULL
),
legacy_photos AS (
  SELECT
    checklist.checklist_id || ':legado:1' AS foto_id,
    checklist.checklist_id,
    checklist.chave_veiculo_competencia,
    checklist.competencia,
    checklist.realizado_em AS checklist_realizado_em,
    checklist.veiculo_id,
    checklist.frota,
    checklist.placa,
    checklist.veiculo_nome,
    checklist.modelo,
    checklist.tipo_veiculo,
    checklist.tipo_frota,
    'LEGADO'::text AS tipo_foto,
    'Foto representativa legada'::text AS tipo_foto_nome,
    'representative'::text AS slot,
    'Foto representativa'::text AS foto_descricao,
    1::integer AS foto_ordem,
    NULL::text AS ocorrencia_id,
    NULL::text AS pergunta,
    NULL::text AS descricao_ocorrencia,
    NULL::text AS status_ocorrencia,
    NULL::text AS severidade_ocorrencia,
    source_checklist."photoUrl" AS url_origem,
    checklist.foto_representativa_url AS url_imagem,
    checklist.realizado_em AS foto_criada_em,
    FALSE AS evidencia_nao_conformidade,
    FALSE AS foto_dispositivo_ponto
  FROM "bi"."checklist_mensal" checklist
  INNER JOIN "Checklist" source_checklist ON source_checklist."id" = checklist.checklist_id
  WHERE NULLIF(BTRIM(source_checklist."photoUrl"), '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(source_checklist."fleetPhotos") = 'array' THEN source_checklist."fleetPhotos"
          ELSE '[]'::jsonb
        END
      ) photo(entry)
      WHERE NULLIF(BTRIM(photo.entry ->> 'photoUrl'), '') IS NOT NULL
    )
),
occurrence_photos AS (
  SELECT
    photo."id" AS foto_id,
    checklist.checklist_id,
    checklist.chave_veiculo_competencia,
    checklist.competencia,
    checklist.realizado_em AS checklist_realizado_em,
    checklist.veiculo_id,
    checklist.frota,
    checklist.placa,
    checklist.veiculo_nome,
    checklist.modelo,
    checklist.tipo_veiculo,
    checklist.tipo_frota,
    'OCORRENCIA'::text AS tipo_foto,
    'Evidencia de nao conformidade'::text AS tipo_foto_nome,
    'nc'::text AS slot,
    'Evidencia: ' || occurrence."questionLabel" AS foto_descricao,
    ROW_NUMBER() OVER (
      PARTITION BY occurrence."id"
      ORDER BY photo."createdAt", photo."id"
    )::integer AS foto_ordem,
    occurrence."id" AS ocorrencia_id,
    occurrence."questionLabel" AS pergunta,
    occurrence."description" AS descricao_ocorrencia,
    occurrence."status"::text AS status_ocorrencia,
    occurrence."severity"::text AS severidade_ocorrencia,
    photo."url" AS url_origem,
    CASE
      WHEN photo."url" ~* '^(https?://|data:|blob:)' THEN photo."url"
      ELSE 'https://api.jrconstrucoes.net.br/' || LTRIM(photo."url", '/')
    END AS url_imagem,
    photo."createdAt" AS foto_criada_em,
    TRUE AS evidencia_nao_conformidade,
    FALSE AS foto_dispositivo_ponto
  FROM "OccurrencePhoto" photo
  INNER JOIN "Occurrence" occurrence ON occurrence."id" = photo."occurrenceId"
  INNER JOIN "bi"."checklist_mensal" checklist ON checklist.checklist_id = occurrence."checklistId"
)
SELECT * FROM fleet_photos
UNION ALL
SELECT * FROM legacy_photos
UNION ALL
SELECT * FROM occurrence_photos;

CREATE VIEW "bi"."checklist_mensal_resumo" AS
SELECT
  coverage.competencia,
  coverage.tipo_frota,
  coverage.supervisores_referencia,
  MAX(coverage.dias_uteis_mes)::integer AS dias_uteis_mes,
  MAX(coverage.dias_uteis_decorridos)::integer AS dias_uteis_decorridos,
  MAX(coverage.dias_uteis_restantes)::integer AS dias_uteis_restantes,
  COUNT(*)::integer AS veiculos_meta,
  COUNT(*) FILTER (WHERE coverage.realizado)::integer AS veiculos_realizados,
  COUNT(*) FILTER (WHERE NOT coverage.realizado)::integer AS veiculos_pendentes,
  ROUND(
    COUNT(*) FILTER (WHERE coverage.realizado)::numeric
      / NULLIF(COUNT(*), 0)::numeric * 100,
    2
  ) AS percentual_realizado,
  CEIL(
    COUNT(*)::numeric
      * MAX(coverage.dias_uteis_decorridos)::numeric
      / NULLIF(MAX(coverage.dias_uteis_mes), 0)::numeric
  )::integer AS meta_esperada_ate_hoje,
  GREATEST(
    0,
    CEIL(
      COUNT(*)::numeric
        * MAX(coverage.dias_uteis_decorridos)::numeric
        / NULLIF(MAX(coverage.dias_uteis_mes), 0)::numeric
    )::integer - COUNT(*) FILTER (WHERE coverage.realizado)::integer
  )::integer AS defasagem_meta,
  CASE
    WHEN MAX(coverage.dias_uteis_restantes) > 0 THEN CEIL(
      COUNT(*) FILTER (WHERE NOT coverage.realizado)::numeric
        / MAX(coverage.dias_uteis_restantes)::numeric
    )::integer
    ELSE COUNT(*) FILTER (WHERE NOT coverage.realizado)::integer
  END AS meta_diaria_necessaria,
  SUM(coverage.checklists_realizados)::integer AS checklists_realizados,
  SUM(coverage.checklists_com_nc)::integer AS checklists_com_nc,
  SUM(coverage.itens_nao_conformes)::integer AS itens_nao_conformes,
  SUM(coverage.ocorrencias_total)::integer AS ocorrencias_total,
  SUM(coverage.ocorrencias_abertas)::integer AS ocorrencias_abertas,
  SUM(coverage.fotos_total)::integer AS fotos_total,
  SUM(coverage.consentimentos_confirmados)::integer AS consentimentos_confirmados,
  SUM(coverage.consentimentos_contestados)::integer AS consentimentos_contestados,
  SUM(coverage.consentimentos_pendentes)::integer AS consentimentos_pendentes
FROM "bi"."checklist_mensal_cobertura" coverage
GROUP BY
  coverage.competencia,
  coverage.tipo_frota,
  coverage.supervisores_referencia;

COMMENT ON VIEW "bi"."checklist_mensal" IS 'Uma linha por checklist mensal, com veiculo, supervisor, conformidade, ocorrencias, fotos e consentimento.';
COMMENT ON VIEW "bi"."checklist_mensal_cobertura" IS 'Uma linha por veiculo ativo e competencia para reproduzir realizados, pendentes, meta esperada e cobranca mensal.';
COMMENT ON VIEW "bi"."checklist_mensal_itens" IS 'Respostas dos itens dos checklists mensais, incluindo vinculacao com ocorrencias e evidencias.';
COMMENT ON VIEW "bi"."checklist_mensal_ocorrencias" IS 'Nao conformidades e manutencoes originadas pelos checklists mensais.';
COMMENT ON VIEW "bi"."checklist_mensal_fotos" IS 'Fotos obrigatorias da frota, foto do dispositivo de ponto, fotos legadas e evidencias de nao conformidade com URL publica.';
COMMENT ON VIEW "bi"."checklist_mensal_resumo" IS 'Resumo mensal por tipo de frota com os indicadores de execucao exibidos no Sistema JR.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA bi TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON "bi"."checklist_mensal" TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON "bi"."checklist_mensal_cobertura" TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON "bi"."checklist_mensal_itens" TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON "bi"."checklist_mensal_ocorrencias" TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON "bi"."checklist_mensal_fotos" TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON "bi"."checklist_mensal_resumo" TO powerbi_reader';
  END IF;
END $$;
