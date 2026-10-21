# BD Geral — fontes para novos lançamentos

Diagnóstico de 21/10/2026. A aba importada é um espelho de trabalho, não um
livro contábil homologado. A seleção da obra para um lançamento novo usa o
**código da obra no cadastro Aethos**, escolhido explicitamente pelo usuário.
O campo `A · ITEM` da planilha não é essa chave: nos dados importados há
itens repetidos e coincidências numéricas com códigos de obras distintas.
Não fazer junção por `ITEM`, contrato em texto livre, nome parecido ou mês.

| Coluna | Campo | Fonte segura nesta fase |
| --- | --- | --- |
| A | ITEM | Manual; referência interna repetida da planilha. |
| B | MÊS DE SERVIÇO | Manual; competência do serviço não se deduz do cadastro da obra. |
| C | ENG. RESPONSÁVEL | Controle de Obras JR, somente se houver uma obra com o mesmo código Aethos. |
| D | Nº DE CONTRATO | Controle de Obras JR, mesma condição de código único. Não há vínculo validado entre a linha da Duda e `AethosContract`; essa tabela não é usada. |
| E | CLIENTE | `AethosObra.clientName`. |
| F | MUNICÍPIO | Manual; não existe campo estruturado no catálogo Aethos e a planilha às vezes descreve trecho/rodovia. |
| G | OBRA | `AethosObra.name`. |
| J | PREVISÃO PLANILHA DE FATURAMENTO | Manual; projeção da planilha não é saldo contratual do Aethos. |
| K | PREVISÃO ATUALIZADA | Manual; depende de revisão humana. |
| L | PRODUÇÃO | Manual; movimentos de produção sincronizados não são a medição desta linha. |
| M | MÊS DE FATURAMENTO | Manual; requer vínculo inequívoco com a fatura. |
| N | VALOR FATURADO | Manual; sem vínculo fatura/linha validado. |
| O | VALOR A RECEBER | Manual; sem regra de recebíveis por linha validada. |
| P | DATA DE FATURAMENTO PREVISTA | Manual; planejamento comercial. |
| Q | DATA DE FATURAMENTO | Manual; sem chave fiscal validada para esta linha. |
| R | MEDIÇÃO DE | Manual; não ligar por semelhança às medições do Controle de Obras. |
| S | MEDIÇÃO ATÉ | Manual; idem. |
| T | MÊS PREVISTO P/ RECEBIMENTO | Manual; previsão financeira. |
| U | VALOR PREVISTO PARA RECEBIMENTO | Manual; previsão financeira. |
| V | VALOR PREVISTO ATUALIZADO P/ RECEB. | Manual; revisão de previsão. |
| W | MÊS RECEBIDO | Manual; sem conciliação de baixa por linha. |
| X | DATA DE RECEBIMENTO | Manual; idem. |
| Y | VALOR RECEBIDO | Manual; idem. |
| Z | PRATELEIRAS | Manual; aba Prateleiras ainda não especificada/importada. |
| AA | OBS PRATELEIRA | Manual; idem. |
| AB | DATA DE FATURAMENTO PRATELEIRAS | Manual; idem. |
| AC | OBSERVAÇÃO | Manual. |

Implementação: consulta autenticada exclusiva de administradores, somente obras
ativas, até 20 resultados. Ao selecionar uma obra, preencher C/D/E/G **apenas
se vazios**, exibir a fonte ao lado do campo e permitir correção antes de
salvar. Não altera linhas importadas nem cria valores financeiros. O histórico
de revisão existente registra os valores finais e quem salvou; o vínculo do
código da obra não é persistido nesta fase, portanto isto é um preenchimento
assistido no ato, não uma sincronização contínua das linhas da BD Geral.
