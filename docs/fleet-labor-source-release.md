# Fonte dedicada de mão de obra — Resultados Frota

Esta implementação é isolada da consulta compartilhada `IND.BI.0025` e das
tabelas atuais de funcionários da TOTVS. A fórmula de custo foi definida pelo
Gustavo como oficial; a liberação da nova fonte ainda depende de prova técnica
de identidade, cardinalidade e paridade numérica com a consulta viva.

Em 05/11/2026, `IND.BI.0038` já estava ocupada pelo diagnóstico agregado;
Gustavo cadastrou `IND.BI.0039` em RM Labore/coligada global. A consulta
atualmente cadastrada é um rascunho **integral, sem o rateio oficial** e não
está aprovada para execução, estágio ou ativação. Gustavo decidiu preservar
exatamente o rateio da `IND.BI.0025` como regra oficial. O rascunho também
pode converter componentes ausentes em zero mesmo com cardinalidade
aparentemente válida. É preciso substituir e comparar a consulta dedicada,
não fazer nova escolha de regra de rateio.

O contrato aceito pelo backend é `CODCOLIGADA`, `CHAPA`, `FK_FUNCIONARIO`,
`DT_MES`, `NROPERIODO`, `TOTAL_GERAL_RATEADO`, `CARDINALIDADE_OK` e
`FORMULA_ID=IND.BI.0025_RATEADO_V1`. A antiga saída
`TOTAL_GERAL_INTEGRAL`/`IND.BI.0025_INTEGRAL_V1` falha antes do estágio.
Não impor artificialmente rateio de 100% se a fórmula original não impõe;
a comparação deve usar os próprios valores e filtros da consulta oficial.

## Portas de segurança

1. Corrigir e testar a consulta dedicada `IND.BI.0039` no TOTVS sem alterar a
   `IND.BI.0025`. A consulta deve entregar exatamente as oito colunas aceitas
   pelo normalizador, somente as duas últimas competências de calendário já
   encerradas. Não enviar mês corrente. Histórico antigo é tratado em lotes
   limitados, não por uma consulta completa automática.
2. Aplicar a migration em ambiente controlado, com backup e plano de reversão.
   Não executar a partir de checkout sujo ou diretamente neste worktree.
3. Configurar `TOTVS_RM_FLEET_LABOR_QUERY_CODE=IND.BI.0039`. A consulta é
   lida por demanda e apenas estagiada; não substitui a fonte atual.
4. Confrontar `IND.BI.0039` com a `IND.BI.0025` viva por competência:
   funcionário/coligada/período, contagem de linhas, total exato e fórmula.
   Guardar recibo da comparação independente; o `evidenceRef` da API apenas
   registra sua referência e **não verifica a prova por si só**.
5. Somente após esse aceite técnico, habilitar temporariamente
   `TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED=true` e aprovar cada competência
   com hash, contagem, total e referência da evidência. Confirmar pelo endpoint
   de readback e pela tela. Depois desabilitar a ativação manual, se desejado.
6. Para estágio diário, `TOTVS_RM_FLEET_LABOR_AUTO_STAGE=true` liga o cron
   às 04:30 de São Paulo, após a consulta compartilhada das 04:00. Ele nunca
   ativa competência automaticamente. Deixar desligado até comprovar carga,
   recorrência e execução natural da consulta 0039.

O leitor da frota usa a fonte dedicada somente para competência aprovada e
íntegra. Caso exista aprovação mas os dados percam integridade, falha fechado
sem recorrer aos números provisórios da 0025. Sem aprovação, mantém o legado
provisório. Não mistura fontes no mesmo mês.

O endpoint de Resultados Frota expõe valor de mão de obra apenas a CEO/admin ou
usuários explicitamente autorizados por ID em
`LUCAS_FLEET_LABOR_VIEWER_USER_IDS`. Mesmo nesse público, grupos com menos de
três funcionários distintos efetivamente valorizados têm o valor suprimido.
Não há total geral de mão de obra neste endpoint para reconstruir o grupo por
subtração. O ID explícito de Lucas precisa ser conferido antes de configurar.

## Evidência local em 05/11/2026

- Prisma validou o schema; build e 402 testes do backend passaram.
- As duas migrations foram executadas em PostgreSQL 18.6 isolado (PGlite/WASM),
  com uma tabela `Vehicle` mínima apenas para satisfazer a FK. Seis checagens
  passaram: inserção e leitura, bloqueio de alteração/exclusão de fato aprovado,
  aposentadoria permitida sem mudar valor, reativação bloqueada e aprovação
  imutável. O total de teste permaneceu `100.000000`.
- Isso **não** equivale a ensaiar sobre uma cópia completa do banco JR, nem
  comprova a execução da consulta `IND.BI.0039` no TOTVS. Nenhuma migration foi
  aplicada na produção.
- O ID de Lucas da Apresentação não foi confirmado. Até conferir a identidade
  em fonte autenticada, não configurar `LUCAS_FLEET_LABOR_VIEWER_USER_IDS`;
  apenas CEO/admin recebem valores elegíveis.
