# Publicação segura do backend JR

O repositório, o banco e o código **efetivamente executado** são estados distintos.
`git status` limpo e `nest build` bem-sucedido não demonstram, por si só, que um
novo deploy preserva o comportamento atual. Nunca copiar um checkout sujo para
o servidor nem reiniciar o serviço antes dos gates abaixo.

## Estado encontrado em 06/10/2026

- O servidor executa JavaScript compilado em `dist` que não pode ser reproduzido
  integralmente a partir do seu checkout de origem. O checkout tinha centenas
  de arquivos modificados/não rastreados; não é base de release.
- As 196 migrações aplicadas foram recuperadas com seus checksums originais.
  A comparação do banco com a árvore de migrações candidata retornou zero
  ausentes, divergentes ou pendentes. Nenhuma migração foi executada.
- A fonte de `checklist.service.js`,
  `totvs-employee-integration.service.js` e
  `usina-asphalt-teams.service.js` foi alinhada ao comportamento atual:
  os JS gerados ficaram idênticos aos arquivos em execução. As mudanças mais
  novas permanecem recuperáveis no histórico e não entraram no ar.
- Uma compilação limpa ainda difere do runtime em
  `bucket-activations.service.js`. Há também módulos presentes somente na
  compilação candidata. Essas diferenças requerem revisão funcional antes de
  qualquer substituição do runtime.
- A API de medições atmosféricas e a tela correspondente estão apenas em
  branches/preview. Não fazem parte da produção.

## Sequência obrigatória para cada release

1. Reconciliar a fonte do backend em Git e revisar cada diferença em relação
   ao runtime. O commit publicado deve ser imutável e identificado por SHA.
2. Em um **checkout separado** do diretório do serviço, executar `npm ci`,
   `npx prisma generate`, build e testes. A CI deve estar verde.
3. Executar `node scripts/verify-backend-release.mjs <dist-em-produção>
   [--allow=src/caminho-exato.js]`. Cada exceção é um arquivo de saída JS
   revisado que faz parte da mudança intencional. A ferramenta recusa exceções
   obsoletas, alterações não autorizadas, Git sujo, SHA diferente de
   `origin/main`, migrações divergentes e build falho. A comparação é apenas
   leitura sobre o diretório de produção.
4. Se houver migração nova, revisá-la e executá-la em procedimento separado,
   com backup e plano de reversão; não usar `db push` nem alterar migrações já
   aplicadas. Rodar o gate do banco novamente após a migração.
5. Publicar o artefato exato testado, preservar o anterior para rollback,
   reiniciar o serviço e fazer readback independente de saúde, rotas, SHA,
   logs e migrações. Se o readback falhar, não declarar concluído.
6. Para a web, mesclar a PR após CI e publicar **via integração Git** da
   Vercel. Conferir que o domínio de produção está `READY`, `source: git` e
   aponta para o mesmo SHA de `origin/main`. Uma prévia não é produção.

O estado-alvo é **correspondência de revisões e contratos** por componente:
Git do backend ↔ artefato do servidor ↔ migrações aplicadas; Git da web ↔
deploy Vercel ↔ domínio servido. Web e backend são projetos diferentes, portanto
não compartilham literalmente o mesmo commit. Guardas impedem regressões
acidentais, mas não substituem testes funcionais e readback após o deploy.
