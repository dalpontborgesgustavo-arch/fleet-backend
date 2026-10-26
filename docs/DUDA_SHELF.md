# Planilha da Duda — Prateleiras

Regra confirmada por Duda em 26/10/2026: a Prateleira acompanha serviços
produzidos que ainda não foram faturados. O mês é o mês em que ela acompanha
a pendência. Quando a obra é faturada, deixa a lista ativa no mês seguinte.
Se a nota já faturada não for recebida no mês previsto, o valor faltante deve
ser acompanhado em Observações, nunca como uma nova Prateleira.

O arquivo entregue por Gustavo em 26/10/2026 tem SHA-256
`55d0a8447c57d326c69c76b504fefd6e7d4030903849e7629d0a49af2817297f`.
A aba Prateleiras contém 17 registros de setembro/2026 (R$ 4.114.588,54) e
30 de outubro/2026 (R$ 3.787.315,03). Nove registros têm município, obra,
tipo e valor exatamente iguais em ambos os meses; não se deve somar os dois
meses como se fossem pendências distintas. A linha 27, de outubro, não informa
obra. Não inferir vínculo por nome/município entre meses nem concluir que um
registro ausente do mês seguinte foi necessariamente faturado.

`extract_shelf.py` lê apenas a aba Prateleiras sem executar VBA e produz um
JSON privado. A planilha e o JSON não entram no Git. O endpoint de importação
exige administrador, valida estrutura, meses, valores e unicidade da linha do
Excel; não sobrescreve cargas anteriores. Setembro entra como retrato
histórico, sem status de faturamento presumido. Outubro entra como pendência
em acompanhamento. O primeiro registro de auditoria retém os campos da
origem. Ajustes posteriores são versionados e nunca alteram BD Geral ou
Observações.

Para seguir um novo mês, usar transporte explícito das pendências abertas;
esse transporte só funciona se o mês de destino estiver vazio. Ao marcar um
item como faturado, exigir a data do faturamento. O filtro padrão mostra só
os itens ainda aguardando faturamento. A ação não cria nem altera recebimentos
em Observações automaticamente.

Antes da liberação: CI, migração aditiva em ambiente de teste, backup e
readback da API autenticada. Após importar: comparar hash, 47 linhas, 17/30
por mês e os totais acima com o arquivo entregue. Validar com Duda antes de
substituir o Excel como fonte de trabalho.
