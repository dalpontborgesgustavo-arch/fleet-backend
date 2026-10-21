# Planilha da Duda — BD Geral, primeira fase

Escopo aprovado em 21/10/2026: importar somente a aba `BD Geral` para uma
área privada de conferência. As abas `Observações` e `Prateleiras` serão
especificadas depois com a usuária. `Resumo`/VBA de relatórios fica por último.
As demais abas, incluindo as ocultas, `Contratos`, `Faturamentos` e
`Prateleiras (Ad. e Med.)`, não integram esta fase. Isso não significa excluir
linhas ocultas **dentro** da tabela `BD Geral`: elas permanecem no extrato.

As colunas H (`VALOR DE CONTRATO`) e I (`SALDO CONTRATO`) foram retiradas do
pacote e do sistema por decisão do usuário. O Excel original não é editado.
Todas as 1.528 linhas físicas de `A7:AC1534` são mantidas, incluindo linhas
sem conteúdo nos 27 campos restantes, para rastreabilidade de posição.

## Natureza da carga

`DudaBdGeralImport` e `DudaBdGeralRow` são staging imutável e isolado do
faturamento operacional. Não representam documento, recebimento ou saldo
certificado; nenhuma API de escrita pública ou sincronização automática é
instalada nesta fase. A chave da linha é `(importId, excelRow)`, não o legado
`ITEM`, que se repete. O hash do workbook distingue snapshots, e o hash do
JSONL impede importar um extrato alterado. A importação é idempotente.

A auditoria independente do SERVER BI confirmou que a cópia principal e a
`conflicted copy` divergem em 44 células de negócio, mesmo sem H/I, nas linhas
1380, 1413, 1418, 1438, 1439, 1456 e 1510. O extrator marca essas linhas
apenas quando o hash da fonte é o da principal auditada. Elas entram no
staging bruto para conferência, **não** como valores financeiros homologados.
É necessária decisão da Duda sobre a versão correta antes de substituir o
Excel ou produzir relatórios consolidados a partir desse histórico.

O extrator de somente leitura fica em
`scripts/duda-bd-geral/extract_workbook.py`. O importador verifica hash da
planilha-fonte, estrutura, 27 colunas, contagens, linhas e hashes antes de
conectar ao banco. `--verify-only` não usa o banco. Não versionar o JSONL,
manifesto ou a planilha: contêm dados internos da JR.

Antes de executar a carga em produção: CI verde, artefato/backend reconciliado
com o runtime, backup, migração aditiva testada, API privada revisada e
ambiente isolado. Depois: comparar contagens, linhas 7/1534, hashes e
disponibilidade autenticada apenas a Gustavo. Não substituir o Excel até
validação funcional com Duda. A cópia `conflicted copy` permanece separada;
as sete linhas divergentes não serão mescladas por data do arquivo.
