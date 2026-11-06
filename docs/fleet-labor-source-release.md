# Fonte dedicada de mão de obra — Resultados Frota

Esta implementação é isolada da consulta compartilhada `IND.BI.0025` e das
tabelas atuais de funcionários da TOTVS. Gustavo definiu a fórmula rateada da
`0025` como oficial. A consulta dedicada já passou na prova direta de
identidade, cardinalidade e paridade numérica, mas ainda **não está ativa no JR**.

Em 05/11/2026, `IND.BI.0038` já estava ocupada pelo diagnóstico agregado;
Gustavo cadastrou `IND.BI.0039` em RM Labore/coligada global. O rascunho
integral, sem rateio, foi substituído em 06/11/2026 pela candidata que
preserva a fórmula da `0025`. A `0039` ficou instalada no TOTVS após
comparação direta; não houve estágio, aprovação ou sincronização dela no JR.

O contrato aceito pelo backend é `CODCOLIGADA`, `CHAPA`, `FK_FUNCIONARIO`,
`DT_MES`, `NROPERIODO`, `TOTAL_GERAL_RATEADO`, `CARDINALIDADE_OK` e
`FORMULA_ID=IND.BI.0025_RATEADO_V1`. A antiga saída
`TOTAL_GERAL_INTEGRAL`/`IND.BI.0025_INTEGRAL_V1` falha antes do estágio.
Não impor artificialmente rateio de 100% se a fórmula original não impõe;
a comparação deve usar os próprios valores e filtros da consulta oficial.

## Portas de segurança

1. Manter a consulta dedicada `IND.BI.0039` homologada no TOTVS sem alterar a
   `IND.BI.0025`. A consulta deve entregar exatamente as oito colunas aceitas
   pelo normalizador, somente as duas últimas competências de calendário já
   encerradas. Não enviar mês corrente. Histórico antigo é tratado em lotes
   limitados, não por uma consulta completa automática.
2. Aplicar a migration em ambiente controlado, com backup e plano de reversão.
   Não executar a partir de checkout sujo ou diretamente neste worktree.
3. Configurar `TOTVS_RM_FLEET_LABOR_QUERY_CODE=IND.BI.0039`. A consulta é
   lida por demanda e apenas estagiada; não substitui a fonte atual.
4. Confrontar `IND.BI.0039` com a `IND.BI.0025` viva por competência:
   funcionário/coligada/período, conjunto completo de chaves e valor individual.
   O endpoint administrativo `GET /lucas-fleet-results/labor-source/runs/:runId/parity?competence=AAAA-MM`
   informa até 25 exemplos e a contagem total de divergências. Custo nulo,
   chave ausente, duplicada ou valor diferente bloqueia o aceite, inclusive
   quando o total geral coincide. O último run da `0025` deve estar concluído
   sem rejeições; as duas capturas devem estar dentro de 36 horas. O campo
   `evidenceRef` é apenas observação humana e não substitui essa comparação.
   A migration nova não retroage prova para runs antigos: aguardar a próxima
   execução natural da `0025`, fora do horário comercial. Cada run grava dois
   manifests imutáveis (as duas competências fechadas), com contagem, hash e
   vínculo aos agregados vistos, inclusive quando o valor não mudou. Isso limita
   o ledger às competências usadas pela `0039`, em vez de repetir todo o
   histórico da `0025` a cada dia. Em mês fechado, qualquer chave corrente
   ausente ou redução da quantidade de linhas-fonte da chave reprova o run antes
   da transação. Nenhum agregado é aposentado automaticamente nesse cenário;
   a cobertura precisa ser corrigida ou revisada manualmente.
5. Somente após esse aceite técnico, habilitar temporariamente
   `TOTVS_RM_FLEET_LABOR_ACTIVATION_ENABLED=true` e aprovar cada competência
   com hash, contagem, total e referência da evidência. O backend recalcula o
   hash de cada fato estagiado e grava um recibo imutável vinculado aos runs
   `0039` e `0025`, com os hashes de ambos os lados. Confirmar pelo endpoint
   de readback e pela tela. Se o hash do lote ou da base `0025` mudar depois,
   o readback falha fechado. Depois desabilitar a ativação manual.
6. Para estágio diário, `TOTVS_RM_FLEET_LABOR_AUTO_STAGE=true` liga o cron
   às 04:30 de São Paulo, após a consulta compartilhada das 04:00. Ele nunca
   ativa competência automaticamente. Deixar desligado até comprovar carga,
   recorrência e execução natural da consulta 0039.

O leitor da frota usa a fonte dedicada somente para competência aprovada e
íntegra. Caso exista aprovação mas os dados percam integridade, falha fechado
sem recorrer aos números provisórios da 0025. Sem aprovação, mantém o legado
provisório. Não mistura fontes no mesmo mês.

Para retirar uma aprovação, usar apenas a rota administrativa
`POST /lucas-fleet-results/labor-source/approvals/:approvalId/reverse` com
justificativa. Ela requer a mesma flag temporária de ativação, grava recibo de
reversão imutável e retira as linhas da condição corrente sem apagar fatos,
aprovação ou auditoria. O leitor não trata uma reversão como zero nem recorre
silenciosamente à fonte provisória. Uma aprovação posterior exige novo lote
e nova prova de paridade.

O endpoint de Resultados Frota expõe valor de mão de obra apenas a CEO/admin ou
usuários explicitamente autorizados por ID em
`LUCAS_FLEET_LABOR_VIEWER_USER_IDS`. Mesmo nesse público, grupos com menos de
três funcionários distintos efetivamente valorizados têm o valor suprimido.
Não há total geral de mão de obra neste endpoint para reconstruir o grupo por
subtração. O usuário da Apresentação é Lucas Arcaro Cirico (perfil de
Licitação); não confundir com Lucas Rodrigues Figueira (Produção). Configure
o ID autenticado do primeiro somente após o corte, preservando CEO/admin por
papel. Não expor IDs internos na interface.

A edição da equipe mensal usa uma autorização separada:
`LUCAS_FLEET_WORKFORCE_EDITOR_USER_IDS`. Administradores continuam autorizados;
`licitacao_gestor` só recebe `canEdit=true` e consegue gravar quando seu ID está
nessa lista. Sem a variável, o comportamento é negar escrita por padrão. Outros
usuários de apresentação mantêm somente a leitura dos vínculos mensais já
gravados. A lista nominal de funcionários selecionáveis usa a mesma autorização
da escrita e responde `403` para os demais gestores.

## Evidência em 06/11/2026

- Prisma validou o schema; build e 424 testes do backend passaram localmente.
  A CI da PR #53 também passou no commit `e90af9f`; ainda não houve merge
  nem publicação da API.
- A versão anterior das duas migrations foi executada em PostgreSQL 18.6 isolado (PGlite/WASM),
  com uma tabela `Vehicle` mínima apenas para satisfazer a FK. Seis checagens
  passaram: inserção e leitura, bloqueio de alteração/exclusão de fato aprovado,
  aposentadoria permitida sem mudar valor, reativação bloqueada e aprovação
  imutável. O total de teste permaneceu `100.000000`.
- As novas colunas de recibo, trigger de fatos estagiados e tabela de reversão
  têm ensaio PostgreSQL adicionado à CI, incluindo mutações/deleções bloqueadas
  e as transições permitidas de aprovação e aposentadoria; a CI Linux passou.
  O ensaio anterior **não** equivale a ensaiar sobre uma cópia completa do banco JR, nem
  comprova a carga na API de produção. Nenhuma migration foi aplicada na produção.
- A consulta `IND.BI.0039` instalada no TOTVS foi comparada diretamente com a
  `0025` viva: setembro 481/481 chaves, outubro 495/495, valores idênticos,
  zero linhas inválidas e nenhuma diferença. Readback SOAP independente
  confirmou a `0039` instalada e a `0025` intacta.
- O PostgreSQL ainda tem uma chave antiga a mais em setembro (482 contra 481
  da fonte viva), valor zero e não elegível como custo oficial. A reconciliação
  pontual exige snapshot, alteração condicionada e readback antes do primeiro
  manifesto novo da `0025`. Não excluir a linha histórica nem afrouxar a
  proteção geral contra respostas parciais. A PR agora falha antes de gravar
  agregados se a `0025` devolver alguma linha inválida, e preserva a versão
  histórica se uma chave aposentada reaparecer.
- A identidade de Lucas da Apresentação foi conferida no banco da JR em modo
  somente leitura. A variável `LUCAS_FLEET_LABOR_VIEWER_USER_IDS` ainda não
  foi configurada neste worktree; até o corte, apenas CEO/admin recebem
  valores elegíveis.
