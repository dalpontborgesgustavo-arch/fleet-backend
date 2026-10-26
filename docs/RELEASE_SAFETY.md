# Publicação segura do backend JR

O repositório, o banco e o código **efetivamente executado** são estados distintos.
`git status` limpo e `nest build` bem-sucedido não demonstram, por si só, que um
novo deploy preserva o comportamento atual. Nunca copiar um checkout sujo para
o servidor nem reiniciar o serviço antes dos gates abaixo.

## Estado encontrado em 06/10/2026

- O servidor executa JavaScript compilado em `dist` que não pode ser reproduzido
  integralmente a partir do seu checkout de origem. O checkout tinha centenas
  de arquivos modificados/não rastreados; não é base de release.
- Em 06/10, leitura somente leitura pelo AWS Systems Manager confirmou no RDS
  196 migrações aplicadas, 9 historicamente revertidas e nenhuma falha
  pendente. O digest dos nomes e checksums das 196 aplicadas coincide com o
  manifesto Git. Nenhuma migração foi executada.
- A fonte de `checklist.service.js`,
  `totvs-employee-integration.service.js` e
  `usina-asphalt-teams.service.js` foi alinhada ao comportamento atual:
  os JS gerados ficaram idênticos aos arquivos em execução. As mudanças mais
  novas permanecem recuperáveis no histórico e não entraram no ar.
- Depois de excluir da base um serviço RNC sem importações (preservado no
  histórico/local original), a compilação limpa e o runtime têm exatamente
  238 arquivos JS com os mesmos caminhos. Em 06/10, nova comparação somente
  leitura com o artefato executado pelo PM2 confirmou **238/238 arquivos com
  conteúdo idêntico após normalizar CRLF/LF** na branch de paridade
  `codex/backend-tracking-runtime-parity`. Treze diferenças de hash bruto eram
  apenas finais de linha do build Windows. Essa confirmação é um retrato do
  runtime atual, não autoriza publicar uma branch diferente sem nova comparação.
  O controller já expunha `/fleet` e `/video` sem implementação correspondente
  no runtime; mantê-lo intacto preserva o comportamento atual, não declara
  essas rotas funcionais. A correção delas requer release próprio, com testes
  de contrato.
- A branch isolada `codex/backend-test-gates-20261006` contém a API ambiental,
  três restaurações de comportamento solicitadas (Aethos tributário, acesso
  administrativo a processos jurídicos e proteção de frota duplicada) e mocks
  de teste atualizados. O build e a suíte Jest completa passaram localmente:
  26 suítes, 179 testes. O workflow de CI agora executa a suíte completa.
  Essas mudanças **ainda não estão em produção**; por alterarem o runtime,
  requerem revisão, comparação de artefatos com allowlist exata e readback.
- A API de medições atmosféricas e a tela correspondente estão apenas em
  branches/preview. Não fazem parte da produção.

## Sequência obrigatória para cada release

1. Reconciliar a fonte do backend em Git e revisar cada diferença em relação
   ao runtime. O commit publicado deve ser imutável e identificado por SHA.
2. A CI Linux executa `npm ci`, `prisma generate`, build e testes para o SHA
   exato de `main`. Aguardar sucesso do workflow inteiro, inclusive o ensaio
   de migrações. Em um **checkout limpo separado** do serviço, instalar as
   dependências pelo lock e depois copiar do payload CI somente `dist` e
   `node_modules/.prisma/client`, para essas raízes ignoradas do checkout.
   Manter schema, package e lock vindos do Git; o gate confere que coincidem
   com o artefato. Não regenerar Prisma nem recompilar depois dessa cópia.
3. Executar `node scripts/verify-backend-release.mjs <dist-em-produção>
   [--allow=src/caminho-exato.js]`. Cada exceção é um arquivo de saída JS
   revisado que faz parte da mudança intencional. A ferramenta recusa exceções
   obsoletas, alterações não autorizadas, Git sujo, SHA diferente de
   `origin/main`, migrações divergentes e build falho. Esse comando sem opções
   de artefato conserva a recompilação local. O caminho recomendado para EC2
   é o modo de artefato CI descrito abaixo, que verifica a compilação já
   aprovada na CI. A comparação é apenas leitura sobre produção.
4. Se houver migração nova, revisá-la e executá-la em procedimento separado,
   com backup e plano de reversão; não usar `db push` nem alterar migrações já
   aplicadas. Rodar o gate do banco novamente após a migração.
5. Publicar o artefato exato testado, preservar o anterior para rollback,
   reiniciar o serviço e fazer readback independente de saúde, rotas, SHA,
   logs e migrações. Se o readback falhar, não declarar concluído.
6. Para a web, mesclar a PR após CI e publicar **via integração Git** da
   Vercel. Conferir que o domínio de produção está `READY`, `source: git` e
   aponta para o mesmo SHA de `origin/main`. Uma prévia não é produção.

## Preflight com o artefato Linux da CI

Na EC2 de 1 GB, a compilação TypeScript pode passar longos períodos usando
swap. Gerar novamente um build não é necessário quando o payload exato da CI
é autenticado e conferido. O modo abaixo mantém os gates de Git, banco e
diferenças do runtime; não é uma opção genérica para pular o build.

```sh
node scripts/verify-backend-release.mjs /home/ubuntu/fleet-backend/dist \
  --ci-artifact=/caminho/fora-do-checkout/artifact.zip \
  --artifact-id=ID_DO_ARTEFATO \
  --allow=src/contracts/contracts.service.js \
  --allow=src/aethos-integration/aethos-integration.service.js
```

Os dois `--allow` acima são específicos da correção de contratos; cada release
deve fornecer somente suas diferenças revisadas. Exceções obsoletas continuam
sendo recusadas. O candidato é o checkout que contém o script: suas raízes
`dist` e `node_modules/.prisma/client`, além de `prisma/schema.prisma`,
`package.json` e `package-lock.json`, devem reproduzir exatamente o artefato.
Dependências adicionais fora dessas raízes não fazem parte dessa comparação.

O gate consulta a API HTTPS pública do GitHub, sem credenciais, usando o
repositório de `origin` e o ID informado. Exige artefato não expirado com nome
`backend-release-SHA`, ligado ao mesmo SHA de `HEAD` e `origin/main`; o run
deve pertencer ao repositório, ser `push` de `main`, usar
`.github/workflows/backend-verify.yml` e estar concluído com sucesso.
O SHA-256 do ZIP precisa coincidir com o digest oficial retornado pelo GitHub.

Em uma cópia temporária, o gate confere também o checksum interno do tgz,
rejeita caminhos inseguros, links e entradas inesperadas e compara o inventário
e os hashes de todos os arquivos do payload com o candidato. Os três arquivos
de fonte/configuração também estão protegidos pelo Git limpo do checkout.
O manifesto de migrações é conferido contra o banco e a comparação JS com a
produção conserva a allowlist exata. Erro de API, origem, checksum ou conteúdo
bloqueia a publicação; não há fallback automático para aceitar o artefato.
Ao preparar a pasta isolada que será ativada, conferir novamente o mesmo
inventário controlado entre ela e o checkout aprovado. Não ativar conteúdo
que tenha sido alterado depois dessa conferência.

Requisitos desse modo: Node e Python 3 disponíveis, acesso HTTPS à API pública
do GitHub, checkout em `main` e payload do mesmo commit. O ZIP pode ficar fora
do checkout ou em um caminho já ignorado; não adicionar arquivos soltos que
façam o gate de Git limpo falhar. Após aprovação, ativar exatamente esse
payload e executar o readback do item 5, preservando a versão anterior.

O estado-alvo é **correspondência de revisões e contratos** por componente:
Git do backend ↔ artefato do servidor ↔ migrações aplicadas; Git da web ↔
deploy Vercel ↔ domínio servido. Web e backend são projetos diferentes, portanto
não compartilham literalmente o mesmo commit. Guardas impedem regressões
acidentais, mas não substituem testes funcionais e readback após o deploy.
