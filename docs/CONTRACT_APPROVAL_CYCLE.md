# Prazo dos contratos a partir da aprovação

O Aethos é a fonte da situação operacional. `P` entra na fila; `O` e `F`
encerram a contagem. `A` e `C` continuam consultáveis no cadastro JR, mas não
participam dos indicadores ou das views do Administrativo.

O sincronismo envia os marcos do mesmo ciclo, sem usar cadastro ou horário de
sincronização como aproximação:

| Payload | Coluna | Regra |
| --- | --- | --- |
| `dataEntradaAprovacao` | `approvedAt` | Último evento exato `AGUARDANDO APROVAÇÃO`, ordenado por data e ID |
| `dataContratacaoCiclo` | `approvalCycleContractedAt` | Primeira contratação depois daquela aprovação; nulo para P |
| `idHistoricoEntradaAprovacao` | `approvalCycleSourceId` | ID do evento de aprovação |
| `historicoCicloAprovacaoCompleto` | `approvalCycleHistoryComplete` | Histórico oficial consultado integralmente |

Os nomes em inglês também são aceitos. Propriedades ausentes em agentes antigos
ficam `undefined` no upsert, preservando marcos já auditados. `null` explícito é
aceito quando uma nova consulta não encontra evidência. Sem histórico auditado,
o prazo fica nulo. Retorno posterior para contratado sem nova aprovação não
reinicia nem alonga o prazo. `contractedAt` e `lastContractedAt` legados continuam
disponíveis para consulta histórica, sem comandar a contagem operacional.

O modelo de etapas mantém uma linha por chave, sem arquivo imutável de todos os
ciclos. Salvar notas com datas ocultadas preserva as datas anteriores existentes;
preencher uma nova data válida na mesma chave continua substituindo seu valor,
como já ocorria no editor. Arquivar cada revisão histórica exigiria outro modelo.

A primeira etapa mostra a entrada em aprovação; a última mostra a contratação
do ciclo. Datas manuais anteriores à aprovação ou posteriores à contratação
permanecem no banco, mas ficam fora dos cálculos. Uma etapa só tem duração quando
suas duas extremidades adjacentes são válidas. Somente a primeira pendente de P
conta até hoje. Contratado com datas faltantes é encerrado operacionalmente e
continua com pendência de preenchimento. O lead time total pode ser calculado
com os dois marcos oficiais mesmo quando faltam datas intermediárias.

O total usa dias de segunda a sexta, exclui o dia inicial e ainda não desconta
feriados, preservando a convenção anterior. Metas totais: serviço 8, empreiteiro
6 dias úteis. A antecedência de solicitação do empreiteiro continua separada:
cadastro até início previsto, em dias corridos, com meta mínima de 15 dias.

As views conservam os nomes, tipos e ordem das colunas existentes e acrescentam
os campos de ciclo/qualidade ao final. `dias_etapa_concluida` só traz intervalos
completos de O/F; médias não incluem tempo em aberto. O resumo mensal conserva
a coorte de cadastro. Não alterar o rótulo desse recorte para aprovação sem
também alterar a relação de calendário no relatório.

Aplicar a migração aditiva antes de iniciar o backend novo, depois atualizar o
agente e sincronizar o histórico antes do refresh do Power BI. Durante essa
janela, contratos ainda não auditados ficam sem prazo, em vez de receber um
prazo estimado. Antes da aplicação, guardar as definições reais e permissões das
views. Reversão restaura a lógica anterior e o artefato anterior do backend;
as quatro colunas novas da tabela podem permanecer. Como `CREATE OR REPLACE`
não remove colunas de views, a definição de reversão deve manter os campos
acrescentados ao final, com tipos compatíveis, em vez de reaplicar cegamente
a definição antiga. Não excluir views dependentes sem inventariá-las.
Seguir também os gates de `RELEASE_SAFETY.md`.

A CI executa `scripts/contracts/rehearse-approval-cycle.mjs` em PostgreSQL local
descartável. O ensaio recria as views anteriores, aplica a migração e verifica
sete cenários, inclusive colunas compatíveis, lacunas e intervalos invertidos.
Ele exige `CONTRACT_APPROVAL_REHEARSAL=1` e rejeita host de banco não local.
