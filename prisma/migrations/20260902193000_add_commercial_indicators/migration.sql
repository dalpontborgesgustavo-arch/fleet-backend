-- Indicadores Comerciais e de Orçamento: substituição auditável das planilhas manuais.
CREATE TABLE "CommercialOpportunity" (
  "id" TEXT PRIMARY KEY,
  "entryDate" DATE NOT NULL,
  "client" TEXT NOT NULL,
  "project" TEXT,
  "city" TEXT,
  "state" TEXT,
  "commercialResponsible" TEXT,
  "segment" TEXT,
  "contractType" TEXT,
  "opportunitySource" TEXT,
  "hadCompetition" BOOLEAN,
  "disputedValue" DECIMAL(18,2),
  "closedValue" DECIMAL(18,2),
  "status" TEXT,
  "lossReason" TEXT,
  "notes" TEXT,
  "sourceType" TEXT NOT NULL DEFAULT 'JR_MANUAL',
  "sourceFile" TEXT,
  "sourceSheet" TEXT,
  "sourceRow" INTEGER,
  "sourceFingerprint" TEXT UNIQUE,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "CommercialOpportunity_entryDate_idx" ON "CommercialOpportunity"("entryDate");
CREATE INDEX "CommercialOpportunity_status_idx" ON "CommercialOpportunity"("status");
CREATE INDEX "CommercialOpportunity_active_entryDate_idx" ON "CommercialOpportunity"("active", "entryDate");

CREATE TABLE "CommercialProcessRecord" (
  "id" TEXT PRIMARY KEY,
  "route" TEXT NOT NULL,
  "competition" TEXT,
  "contractNumber" TEXT,
  "contractingParty" TEXT,
  "launchType" TEXT,
  "requester" TEXT,
  "objectSummary" TEXT,
  "client" TEXT,
  "complexity" TEXT,
  "filledAt" DATE,
  "contractSignedSentAt" DATE,
  "launchEmailSentAt" DATE,
  "workOpenedAt" DATE,
  "registrationConsultSentAt" DATE,
  "registrationReturnedAt" DATE,
  "documentsSentAt" DATE,
  "startDate" DATE,
  "plannedBusinessDays" INTEGER,
  "dueDate" DATE,
  "completedDate" DATE,
  "elapsedCalendarDays" INTEGER,
  "elapsedBusinessDays" INTEGER,
  "responsible" TEXT,
  "notes" TEXT,
  "sourceType" TEXT NOT NULL DEFAULT 'JR_MANUAL',
  "sourceFile" TEXT,
  "sourceSheet" TEXT,
  "sourceRow" INTEGER,
  "sourceFingerprint" TEXT UNIQUE,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "CommercialProcessRecord_route_startDate_idx" ON "CommercialProcessRecord"("route", "startDate");
CREATE INDEX "CommercialProcessRecord_active_route_idx" ON "CommercialProcessRecord"("active", "route");
CREATE INDEX "CommercialProcessRecord_dueDate_idx" ON "CommercialProcessRecord"("dueDate");

CREATE TABLE "CommercialIndicatorAudit" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorId" TEXT,
  "beforeData" JSONB,
  "afterData" JSONB,
  "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "opportunityId" TEXT REFERENCES "CommercialOpportunity"("id") ON DELETE CASCADE,
  "processId" TEXT REFERENCES "CommercialProcessRecord"("id") ON DELETE CASCADE
);
CREATE INDEX "CommercialIndicatorAudit_entityType_entityId_changedAt_idx" ON "CommercialIndicatorAudit"("entityType", "entityId", "changedAt");
CREATE INDEX "CommercialIndicatorAudit_actorId_changedAt_idx" ON "CommercialIndicatorAudit"("actorId", "changedAt");

INSERT INTO "CommercialOpportunity" ("id","entryDate","client","project","city","state","commercialResponsible","segment","contractType","opportunitySource","hadCompetition","disputedValue","closedValue","status","lossReason","sourceType","sourceFile","sourceSheet","sourceRow","sourceFingerprint","active","createdAt","updatedAt") VALUES
('legacy-commercial-opportunity-0002', '2026-01-06'::date, 'Urussanga', NULL, 'Urussanga', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 2376043.32, 2040000.00, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 2, '3853fd315f64ae078c2e3799ba5c8f0d8436f6e60d32d875777a4a0140f77f6f', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0003', '2026-01-06'::date, 'Içara', NULL, 'Içara', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 219078.52, 219078.50, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 3, 'dedf5d43278dc0a58d0599fc1f9727a768bc4e635c5cfcdcbe532b49abeeb953', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0004', '2026-01-06'::date, 'Sombrio', NULL, 'Sombrio', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 8480019.44, 4590000.00, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 4, '3b439835df9287e2aa5086f80801e32691940e1c6b383e84925bb75b747015ae', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0005', '2026-01-07'::date, 'Morro da Fumaça', NULL, 'Morro da Fumaça', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1502376.76, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 5, '88444f04394d0c66d3a09538ea266e5394d9235002d5036bc228c43320b4e769', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0006', '2026-01-07'::date, 'Urussanga', NULL, 'Urussanga', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 5164035.60, 4350000.00, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 6, '5334e08f324e5686a0093bb8784fb69bbd67048f60ded41eaad5cd4208fd25c5', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0007', '2026-01-08'::date, 'Paulo Lopes', NULL, 'Paulo Lopes', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1061079.44, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 7, '209730a9ad9ebf5f521081ae59e998c723e0f0613cd34e711d9828710a7728b4', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0008', '2026-01-09'::date, 'Nova Veneza', NULL, 'Nova Veneza', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 386516.08, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 8, 'a1b895017ca1bbdb87e02d8c2c8ccdc3598e1cb0aa5746688b1b8c71c58dde10', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0009', '2026-01-13'::date, 'Içara', NULL, 'Içara', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1832236.09, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 9, '7ec18b4a56c2e13ac2d8bfda7e0c5da3a7c58f97ede725b07ff3aa7e9679f2cb', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0010', '2026-01-14'::date, 'Macred', NULL, 'Criciúma', 'SC', NULL, 'Pavimentação', 'Privado', 'Indicação', TRUE, 117741.73, 117741.73, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 10, '1c41c78f5d8003af2110dc934b3f3e7b5611a98eaa6d7ecdf30d7eaf71df8f8a', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0011', '2026-01-16'::date, 'Turvo', NULL, 'Turvo', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1427957.68, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 11, '25895736bb7bb478e3aad662de95eb93209924d31b51351ca5cef19cf4046e54', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0012', '2026-01-19'::date, 'Resicolor', NULL, 'Siderópolis', 'SC', NULL, 'Pavimentação', 'Privado', 'Indicação', FALSE, 1667758.66, NULL, 'Em andamento', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 12, '4914543149c230569e4ec07488d85d3d1b39dea8135c7c66435dc27940544e86', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0013', '2026-01-19'::date, 'Meleiro', NULL, 'Meleiro', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1555684.20, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 13, '15464ee4ff18f6b1fc0d6ec96cdc15b300bbb37fe27eed100e8c594d4b3ec391', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0014', '2026-01-19'::date, 'Içara', NULL, 'Içara', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 600410.70, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 14, '445ae94fd20fbccb39e9bd6da5506ad390965fb0c1e0258aa92e4f2aa9c6e170', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0015', '2026-01-19'::date, 'Tubarão - estava suspenso', NULL, 'Tubarão - estava suspenso', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 5854238.78, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 15, '8f3330fa27e7e700dfccf6f3e1b3295c87771c8056b0bcd56364fa5b8f3b74af', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0016', '2026-01-20'::date, 'Igreja Vida Para Nações', NULL, 'Criciúma', 'SC', NULL, 'Pavimentação', 'Privado', 'Indicação', FALSE, 544371.75, NULL, 'Em andamento', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 16, '224c9688b51214df3d0fae3fd48dfc71e236a000ca27b85b2959ecd66d73e240', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0017', '2026-01-20'::date, 'Penha', NULL, 'Penha', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1454904.24, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 17, 'e66cd11d44a9c700346c3c4da14c9558178726c4dda5e61357795e8009f4a501', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0018', '2026-01-21'::date, 'Araranguá', NULL, 'Araranguá', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 9862375.56, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 18, '54c24ce42e46877ac523ce9103e61cc2ef088956e8c9485175c3aa0d40370b54', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0019', '2026-01-21'::date, 'EPR', NULL, 'São José dos Pinhais', 'PR', NULL, 'Pavimentação', 'Privado', 'Indicação', TRUE, 5870303.42, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 19, '0df81084a6f3d486b8d9ee12302b8f62b3c7ced3c797a23f4c35d24839597de6', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0020', '2026-01-21'::date, 'EPR', NULL, 'São José dos Pinhais', 'PR', NULL, 'Pavimentação', 'Privado', 'Indicação', TRUE, 5695809.40, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 20, '9b1152e736494aa715789d231a614b6abd50e7755bc64937d9a7566d97c7a884', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0021', '2026-01-23'::date, 'Schroeder', NULL, 'Schroeder', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 523813.48, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 21, 'd845f00e34d5c3126d8f9e8d083b65d073f00e6288dedd74916ecda6b8d94b4d', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0022', '2026-01-26'::date, 'Apiúna', NULL, 'Apiúna', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 5828023.90, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 22, '204613732ae0ca752b955b3096c3e2ae1ad1cb73e54983caeebcc85ebd6dc495', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0023', '2026-01-27'::date, 'Itapema', NULL, 'Itapema', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 5348571.36, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 23, '23341d1d4978277a0d8a7cbe8c6224ea5764311e1d623183d9c24e5720cd34a5', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0024', '2026-01-29'::date, 'Itajaí', NULL, 'Itajaí', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 5059191.86, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 24, '21cfe2668cfff2b5822b507232e6b48bbfaea60a8ac96908f151994eff9ae31c', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0025', '2026-01-30'::date, 'Morro Grande', NULL, 'Morro Grande', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 2391122.59, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 25, '15d199f48689a90b3b28b1b02581e5134f6608e515d0cb85584ed39aa2229034', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0026', '2026-02-03'::date, 'Barra Velha', NULL, 'Barra Velha', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 294333.15, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 26, '07973cd3c17fca85da8f80e5d86088dd507385f707c851a339858dcacea8e2e1', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0027', '2026-02-05'::date, 'Luiz alves', NULL, 'Luiz alves', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 416856.58, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 27, '01de5a65fb05d7a9d84d49cebfc996b8a1ec109d30fd904db429851be9561749', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0028', '2026-02-06'::date, 'Maracajá', NULL, 'Maracajá', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 231285.80, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 28, '6fcc9c518e2a0e17c22341f0b3b565197c5d45a35adff4871c672401dcbd1828', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0029', '2026-02-06'::date, 'Itapema', NULL, 'Itapema', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 32350073.27, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 29, '6d053d3b05fe1dad5a5ead0d3259758d7ef8dc2a39520dcb34de75bae151d17a', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0030', '2026-02-11'::date, 'Moniari Supermercado', NULL, 'Içara', 'SC', NULL, 'Pavimentação', 'Público', 'Indicação', TRUE, 760626.06, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 30, 'b35d30af6a4bf7271471a81abe01108fb604775a057f36a26396e84727f284c9', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0031', '2026-02-11'::date, 'Ricardo Guidi', NULL, 'Criciúma', 'SC', NULL, 'Pavimentação', 'Privado', 'Indicação', TRUE, 5616149.10, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 31, '9d765f97cdbb3ae2fc70d8bb092e68a8b0a6d71df4bee44a6c93a532372f4b91', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0032', '2026-02-11'::date, 'Bal. Rincão - FORNECIMENTO', NULL, 'Bal. Rincão - FORNECIMENTO', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 564480.00, 507000.00, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 32, '58b5a20121d4d79c6d995339f17d695e2d76d9f87c06fa59b2e4be85da1a66cb', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0033', '2026-02-11'::date, 'Itajaí', NULL, 'Itajaí', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 31434980.08, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 33, '56e5433a62efa4ed8f4ecfcc31374064ccc4119d343c50926d92dd66c8185dd9', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0034', '2026-02-11'::date, 'Torres', NULL, 'Torres', 'RS', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 8446700.00, 4922343.60, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 34, '206f6c4f2a03e5b07ada0a9e1c47ebb9e78028b4df3394db289b50e039848055', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0035', '2026-02-12'::date, 'Shopping Itaguaçu', NULL, 'São José', 'SC', NULL, 'Pavimentação', 'Privado', 'Indicação', TRUE, 858428.06, 858428.06, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 35, 'fed8e7a3c6eaea416a20dccc9143c7a00c10f0b2b90dda8ef17c234da56567b6', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0036', '2026-02-12'::date, 'Baln. Barra do Sul', NULL, 'Baln. Barra do Sul', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1184463.52, 1066017.16, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 36, '889992ed1acd5da24f2c8735399f63591a954dee48887303fc0f71dfc2272638', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0037', '2026-02-18'::date, 'Timbé do Sul', NULL, 'Timbé do Sul', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 464824.78, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 37, '4ab957aa7adef282d71c35aba88547c6d438121ae71436f70c61b2466b3d767b', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0038', '2026-02-19'::date, 'Morro Grande', NULL, 'Morro Grande', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 2514516.74, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 38, '7d030432a717abdb6d94592959ef59ac673dc3af8e9f0f0c969bdcc9e26d5b90', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0039', '2026-02-19'::date, 'Criciúma', NULL, 'Criciúma', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 8644375.93, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 39, '691e6b3201e2ff220284520ac34ccc4563ad51374c38b05d1c12fa71355bc02f', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0040', '2026-02-19'::date, 'Ilhota', NULL, 'Ilhota', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 11424585.90, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 40, 'bcbb0328ab4ef8d325129369ea3ec5402685f0ccbaff89930a4f0966f8f4f812', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0041', '2026-02-24'::date, 'Massaranduba', NULL, 'Massaranduba', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1506286.33, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 41, '26d912be86adbb7f8462c440e1af0fbf8d69ddda216af6569eb6605152244305', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0042', '2026-02-27'::date, 'Forquilhinha', NULL, 'Forquilhinha', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 2380813.66, 2380813.65, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 42, '215d284dbce76877475f57c034fee4a004776b197b8def69041ac0a3c366d2bc', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0043', '2026-03-02'::date, 'Morro da Fumaça', NULL, 'Morro da Fumaça', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 3183323.56, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 43, '24cbeb25ee5fa5184efeb2bfe80a84c9e8659e5f14a6d679000612ecad859bed', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0044', '2026-03-03'::date, 'Ermo', NULL, 'Ermo', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 2037821.01, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 44, '485c84ad90703ed896e87c5926697b92428adf2c6f2fa1cb81c1cf57ea2cd4b4', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0045', '2026-03-04'::date, 'Sombrio', NULL, 'Sombrio', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 7815728.48, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 45, '347ceaccc6db37d2cbeb359f6cd8c31f92de46a465ada052548267da65c3b881', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0046', '2026-03-04'::date, 'SIE - MORRO DA FUMAÇA', NULL, 'SIE - MORRO DA FUMAÇA', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 9673440.19, 7252406.88, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 46, '8ef87a44eae1a68e480ba5f1a631753d1861b76607bcbdc11444cd0369737ba1', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0047', '2026-03-05'::date, 'Penha', NULL, 'Penha', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 12412428.00, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 47, '61601bb9f8a3196debdaf767c106b220e2257ed61ed9324655e1c44167739184', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0048', '2026-03-06'::date, 'São Ludgero', NULL, 'São Ludgero', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 879053.57, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 48, 'fca515d8acac2c46f674574f11cec634015a6b8280a7edf6bc751affc2dd68ff', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0049', '2026-03-06'::date, 'Pedras Grandes', NULL, 'Pedras Grandes', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1110283.52, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 49, '2fe53c5b5024dc63fb4b2889d8587abbe88664eec1953f7d5a52fb45dcc47fdd', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0050', '2026-03-10'::date, 'Itapoá', NULL, 'Itapoá', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1831919.80, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 50, '3c247623089f15e24df5ce8cdd105e93ab17f8d93121207443bbb3cf6c21a2ee', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0051', '2026-03-10'::date, 'Itapoá', NULL, 'Itapoá', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1153873.16, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 51, '48c3b573ffb612749dc524c24cc0fd8fbce08f6ce75776c346e026f27e590c94', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0052', '2026-03-11'::date, 'Artéris Litoral Sul', NULL, NULL, 'SC', NULL, 'Pavimentação', 'Privado', 'Indicação', TRUE, 49799893.46, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 52, 'ff4e528ff0fae3c4e6c7b80fdded33e6cc4498fa7a83c04a138c640adbbd25cb', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0053', '2026-03-11'::date, 'Artéris Planalto Sul', NULL, NULL, 'SC', NULL, 'Pavimentação', 'Privado', 'Indicação', TRUE, 107192034.86, 107192034.86, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 53, '6be301526d5f8d143f27da0fd7d4207e6d1ed3c057c9bb27236fc5e69f344fed', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0054', '2026-03-12'::date, 'Morro da Fumaça', NULL, 'Morro da Fumaça', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 3906715.44, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 54, '82817fecde2e7983051d0344a5b70fda60c90b37885dc8253de8a7a1305cb552', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0055', '2026-03-13'::date, 'Luiz alves', NULL, 'Luiz alves', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1230743.18, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 55, '46a8680f3e13ddbed5c3f04ab65f8741002217feb81344bb2fdd206ee22739a4', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0056', '2026-03-16'::date, 'Lauro Muller', NULL, 'Lauro Muller', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 9399734.77, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 56, '4ad5ad3ccb66e6f7316cd497f2581b87508986347c1a8fb21669dc8979a2850d', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0057', '2026-03-17'::date, 'Ibirama', NULL, 'Ibirama', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 4483106.73, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 57, '111a29ac3c18ab97de4940c42dc5ed63526e5b8570569108745e858bc6c7865a', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0058', '2026-03-17'::date, 'Morro da Fumaça', NULL, 'Morro da Fumaça', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 9765766.71, 7324136.70, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 58, 'b1ef7e64b0101ba1d740971d2663e5b00eaede0e54544ab3c70f1b0661f1ad12', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0059', '2026-03-17'::date, 'Gov. Celso Ramos', NULL, 'Gov. Celso Ramos', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 12844149.89, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 59, 'b9050375254fe63433d4111256425aed08aa741358b9e4bde91e3e70326c3f39', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0060', '2026-03-18'::date, 'Morro da Fumaça', NULL, 'Morro da Fumaça', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1213783.90, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 60, '72c6044bd61769ab2213812b45a541a735c2ef0965b2cd45b619f833a36168d8', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0061', '2026-03-18'::date, 'Guaramirim', NULL, 'Guaramirim', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 11327149.51, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 61, 'e78c01ad73b8054cf69c911f8bda811193c4a56cbe839d7165e04e29c4b85fc3', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0062', '2026-03-18'::date, 'Rio Negrinho', NULL, 'Rio Negrinho', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 6252000.50, 4251360.34, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 62, '32fce34a86b8b62663c87d6040832f54a6026c29f7903c139845eac7c7857609', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0063', '2026-03-19'::date, 'Morro da Fumaça', NULL, 'Morro da Fumaça', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 5539488.86, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 63, 'a2528668563718f494433f0039c148500b99759d23c5cf62fc4e8a6e3f217407', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0064', '2026-03-19'::date, 'Maracajá', NULL, 'Maracajá', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 5206439.94, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 64, '66f4a9f040bb6ba0b587487d5cac82727b5f12324189db0a68906d8f0751f1eb', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0065', '2026-03-19'::date, 'Turvo', NULL, 'Turvo', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 6100364.51, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 65, '9770611ffd5cf6fee61d3af84d932dd3d39f58e439bce8f5e83a488460700ad6', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0066', '2026-03-23'::date, 'Jaraguá do Sul', NULL, 'Jaraguá do Sul', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 533353.40, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 66, 'bfb36c5ec63c3ec6c9a8ae7bdf72fcf3d7e16514f57a2bbe20bf9608bed4d580', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0067', '2026-03-23'::date, 'Jaraguá do Sul', NULL, 'Jaraguá do Sul', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 867421.94, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 67, '540007cd10f1d52e1d650d69f5012e299a8229e7a3058830ad00b1c65271c3ae', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0068', '2026-03-23'::date, 'Jaraguá do Sul', NULL, 'Jaraguá do Sul', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 2309838.87, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 68, '640ac89ad943e4100b17c47dda388f6eb5cd4874ee96776f12d2beb68a190e77', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0069', '2026-03-23'::date, 'Biguaçu', NULL, 'Biguaçu', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 3020932.69, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 69, '6a86add23c79c1d0a707c51025d9d7433a65c5cb9e5817cbe264ff0ed7afae0d', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0070', '2026-03-24'::date, 'Jaraguá do Sul', NULL, 'Jaraguá do Sul', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 2145575.39, 1475301.02, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 70, '13b3889ade27f5457627ece5847e35a50328ad4198598e39a03f3fcd43b532b6', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0071', '2026-03-24'::date, 'São Ludgero', NULL, 'São Ludgero', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 4490559.78, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 71, '5f8edbfcda1a0b9a85aa2a5d8ee374d7ad0466de721f19a48e1a549dff4187cd', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0072', '2026-03-24'::date, 'Rio Fortuna', NULL, 'Rio Fortuna', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 3543739.67, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 72, 'f0522508569bfb303b400a1b5896e08720c685f5967147cb529e2f89c89c9ee3', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0073', '2026-03-24'::date, 'CIMVI', NULL, 'CIMVI', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 73502990.35, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 73, '9140c2921d855c8c582b71dd618bf292d5c0b61d445cd302019e9020ff8cb8aa', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0074', '2026-03-24'::date, 'Nova Veneza', NULL, 'Nova Veneza', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 808368.30, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 74, 'a5d57b866e303b144d65956a3ea4d5e20bd216644b9d0e73eaf1caf52dd41269', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0075', '2026-03-25'::date, 'Forquilhinha', NULL, 'Forquilhinha', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 5736240.52, 4300000.00, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 75, '2881ae35e24737de86a642fa545b022bd01db3c94a658ae134f7354a94e97ca5', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0076', '2026-03-25'::date, 'Bal. Arroio do Silva', NULL, 'Bal. Arroio do Silva', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 452389.58, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 76, 'e60781306eb70f7baa4b5e19bf32e509f0e4f1d1a2b79102112259ed965a8dc6', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0077', '2026-03-26'::date, 'Passo de Torres', NULL, 'Passo de Torres', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1336038.59, 999874.90, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 77, 'e83aac2e4189f141d079e5cbad0c2f9ce3b2568ac0a536b258f54282bee61f52', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0078', '2026-03-27'::date, 'Jaraguá do Sul', NULL, 'Jaraguá do Sul', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 592149.25, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 78, '2ff880ec207cfa2172dd15adf213c0babf26c8d822098f31906f96b1021ccbbc', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0079', '2026-03-27'::date, 'Jaraguá do Sul', NULL, 'Jaraguá do Sul', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1195704.74, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 79, '3105161f0bb091cbf24ce8af65d2f9acbf5d6167dc271400285a1622dae96753', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0080', '2026-03-31'::date, 'Santo Amaro da Imperatriz', NULL, 'Santo Amaro da Imperatriz', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1824931.82, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 80, '8f67bea383551fa202d50bb2daba9cc0d92c52e84b2ffde8c7ef452dbe508011', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0081', '2026-04-02'::date, 'Canelinha', NULL, 'Canelinha', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1364991.56, 1026473.65, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 81, 'ca5fff1a24cc6f84ea5bf59c0b53e08d9fa8daae0f6b37bcb4917df14f035024', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0082', '2026-04-02'::date, 'Próaço', NULL, 'Garuva', 'SC', NULL, 'Pavimentação', 'Privado', 'Indicação', TRUE, 3162042.59, NULL, 'Perdida', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 82, '09a87a796196c5ede7397b04bdc7cca6323d17950dfe3f2e90108b097febcec5', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0083', '2026-04-06'::date, 'Biguaçu', NULL, 'Biguaçu', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1790752.95, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 83, '622b0552320f92e9a6ef81fd1b81cc5516ef49f40ea7f42d2446b37f75a5972f', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0084', '2026-04-06'::date, 'Capivari de Baixo', NULL, 'Capivari de Baixo', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 873035.80, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 84, 'c63573a225b40e371dccc68403658347035e33718c85cbbb16a420b86199f711', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0085', '2026-04-07'::date, 'Morro da Fumaça', NULL, 'Morro da Fumaça', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 3988977.72, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 85, '3ebc4cc1de5969e28b849568238cb1090e56692948bbde8e4c13a41666377328', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0086', '2026-04-07'::date, 'Indaial', NULL, 'Indaial', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 9466102.40, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 86, '3398e6ce8c8b119180d3df5c5b5bfa14804a935f55f7d5998b3fe332b3cb5e54', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0087', '2026-04-08'::date, 'Içara', NULL, 'Içara', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 5239424.54, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 87, '5495ba515a69b225a3847f177f69779725ff5afae2f03f9362e142b4ecf95f33', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0088', '2026-04-08'::date, 'Jaraguá do Sul', NULL, 'Jaraguá do Sul', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 3968172.22, 2836990.00, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 88, '593d7c5d754ac25b29c084b095ea03ad939b92ebeb0eba234460f57ee12ad6c7', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0089', '2026-04-10'::date, 'Camboriu', NULL, 'Camboriu', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 12812501.86, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 89, 'e5de5fe6e044e7bcecea1070a63fdb63dca17995a6751ea227293ad58cdaa82a', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0090', '2026-04-13'::date, 'Içara', NULL, 'Içara', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 2482664.53, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 90, '13c5a250b45e6cd409498cb119a8d072bab935b524f2ea95e79123d125242ae5', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0091', '2026-04-13'::date, 'Urussanga', NULL, 'Urussanga', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 6096059.20, 5260000.00, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 91, '175064c928cd1b6a190ba1525494f5915812127a17708241cd48f27168722939', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0092', '2026-04-15'::date, 'Xênia Carrer', NULL, 'Tijucas', 'SC', NULL, 'Pavimentação', 'Privado', 'Indicação', TRUE, 2772205.03, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 92, '9926fcc8c7f5e746a963bb0b66f26504d37796ac246b86516eb41002b93dc980', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0093', '2026-04-15'::date, 'Pedras Grandes', NULL, 'Pedras Grandes', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1285909.45, 955000.00, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 93, 'fa7b3fa5287a64b892351ef6c837790fcd9a3d6c45f579e7f3fffe32663450b9', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0094', '2026-04-15'::date, 'Pedras Grandes', NULL, 'Pedras Grandes', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 300017.03, 290000.00, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 94, 'c61e60d294c993ca75605e1805407bbd6306aa7b139a84c2ba5ded115d2b05f2', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0095', '2026-04-16'::date, 'Jaraguá do Sul', NULL, 'Jaraguá do Sul', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 552447.11, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 95, 'f3127b9d1c3c7fc3b945b29f90df10af56a8ce845a59138bb9a7f26b8710b3e9', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0096', '2026-04-16'::date, 'Penha', NULL, 'Penha', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1415449.09, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 96, '1bfd2cce8aea3938a6cda71375fe6588dd354d2c2fb34199818b1619228b8071', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0097', '2026-04-16'::date, 'Baln. Arroio do Silva', NULL, 'Baln. Arroio do Silva', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 5309591.59, 3630000.00, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 97, 'bc2bb5ea20150a47af9a9ad1987264947fc18fa8fbf50919ef0452db73cbe970', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0098', '2026-04-17'::date, 'Canoinhas', NULL, 'Canoinhas', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 2927773.63, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 98, '3ff5163af9cc677746bae969f9aedfcb26a494ba30de0044c796b9f12cbeb305', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0099', '2026-04-17'::date, 'Nova Veneza', NULL, 'Nova Veneza', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1529109.69, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 99, '83fd5aa187e95ccc930506769215d57e569cb24f9634836c8ae464c512fe2c69', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0100', '2026-04-22'::date, 'Balneário Piçarras', NULL, 'Balneário Piçarras', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 752814.72, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 100, '333a0b946104ff88fd9be2b3697e35d65f233daed904e7eadfd339840753c6b9', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0101', '2026-04-22'::date, 'Maracajá', NULL, 'Maracajá', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 2251071.16, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 101, '0f39a3f8427354e1966b31af7ab697903354a45f2b0ceca93869fb7231d66c5c', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0102', '2026-04-23'::date, 'RPN Engenharia', NULL, 'Schroeder', 'SC', NULL, 'Pavimentação', 'Privado', 'Indicação', TRUE, 317329.56, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 102, 'e91382b3dc68f82894c06a85cc9528b6bb14b018c2b7e4eea977ae855e5bda53', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0103', '2026-04-23'::date, 'Tijucas', NULL, 'Tijucas', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1689237.55, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 103, '977dea78f6b877d20bbce99929d8ee15507c920d74a3ff646ddd0ccec6fb500c', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0104', '2026-04-23'::date, 'Paulo Lopes', NULL, 'Paulo Lopes', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1765866.04, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 104, '3949b1cd77700717d5161ed7552d18d7241aba91cc453abcac9510ac7ddf7e5f', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0105', '2026-04-24'::date, 'PHF Participações', NULL, 'Criciúma', 'SC', NULL, 'Pavimentação', 'Privado', 'Indicação', TRUE, 485964.49, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 105, '26ab7d20d5ac3e6898c5dd657093ef5e81057cb044adfc2fd781c0effa02ce70', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0106', '2026-04-24'::date, 'Pavei Construções', NULL, 'Criciúma', 'SC', NULL, 'Pavimentação', 'Privado', 'Indicação', TRUE, 640009.96, 640009.96, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 106, '24f932661c01d20eabc8f60eb15432186aa8be66361736eadc797da1fc730de6', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0107', '2026-04-24'::date, 'Pavei Construções', NULL, 'Içara', 'SC', NULL, 'Pavimentação', 'Privado', 'Indicação', TRUE, 4184280.68, NULL, 'Em andamento', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 107, 'b8f2dc964dea2104444d16d8381f609310199974ae9749c000221338d1bbc236', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0108', '2026-04-29'::date, 'Jaraguá do Sul', NULL, 'Jaraguá do Sul', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 9002076.62, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 108, 'aae06fb5667fc5c83e7013b6ec04f1d6ef69563b4b80519f74497e0b0a2170c9', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0109', '2026-04-29'::date, 'Palhoça', NULL, 'Palhoça', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 2274070.66, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 109, '39dba2dab36435c1dace9b030cb811ce53133538ed853a1f1bc1c7c8ef1a66e2', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0110', '2026-04-30'::date, 'São Ludgero', NULL, 'São Ludgero', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1733410.10, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 110, '46092ee2c6633abbddc6686b72a5827c47dbf5454a386d0e08dc8dc734c946a4', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0111', '2026-04-30'::date, 'Joinville', NULL, 'Joinville', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 5129264.94, 3528000.00, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 111, '02fbbc8636a2a5cc0995872958c797cc4fb75b3b78f7937d3c9dbcb8dc938b87', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0112', '2026-05-04'::date, 'Biguaçu', NULL, 'Biguaçu', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 5049694.21, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 112, '130f56dbb9de0972351f709a42e70e434c11094611c7248722b5228e84dadefd', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0113', '2026-05-05'::date, 'Orleans', NULL, 'Orleans', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 12675378.93, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 113, '7e309e05ab538ee434f398b1ecd4261c4d5cbec9b25aec100b78d1780c0db132', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0114', '2026-05-05'::date, 'Biguaçu', NULL, 'Biguaçu', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1024550.97, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 114, '4ef482108ebbdec2919d8ed3a28cb5005165bedc0097a6424d9133ab74eff4c8', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0115', '2026-05-06'::date, 'Penha', NULL, 'Penha', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 878000.34, 692000.00, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 115, 'fbf4c0bb5ebe31b3c2cdf8b3b31705d217207b19df4ca2d9a4bb366ec4806b3d', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0116', '2026-05-07'::date, 'Turvo', NULL, 'Turvo', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 6877940.47, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 116, '199eb420fffd5b93d30b0db56a2815b1d1d91e8ec4026d2bda3eec4ae6f4de4f', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0117', '2026-05-07'::date, 'Balneário Gaivota', NULL, 'Balneário Gaivota', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 10834250.00, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 117, '06c598af2c38abb251f942e410b82d60cf1deb6900a0dfc368d6453e624584be', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0118', '2026-05-07'::date, 'Criciuma', NULL, 'Criciuma', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 9295778.77, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 118, '67cc6d9c223b84917f301b7c33bf9d5e9450b1fa1039778bd8cefc73d74465bc', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0119', '2026-05-08'::date, 'São João do Sul', NULL, 'São João do Sul', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1495610.92, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 119, 'e1c23555e4eb818323219b7a3e3ba32d5219f949edeccc021ef411fd5dd7e93a', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0120', '2026-05-08'::date, 'Cocal do Sul', NULL, 'Cocal do Sul', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 2686686.10, 1780000.00, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 120, '6cde1a730ec4aa8111231f5bdc529807cb7559f3032ade43bdaf3e134db8fa6b', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0121', '2026-05-08'::date, 'Criciuma', NULL, 'Criciuma', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 8471061.92, 7397000.00, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 121, '5d58f5d9b4e15aa371ca0654aa7952eb5257b8aa2832e1f9f6c950571c9198d2', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0122', '2026-05-08'::date, 'Mampituba', NULL, 'Mampituba', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1100000.00, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 122, '3a5dcd3d577cabbb191b2905f8b8160e736029cd9ae1455963d7650d7315f820', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0123', '2026-05-08'::date, 'Balneário Arroio do Silva', NULL, 'Balneário Arroio do Silva', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1353592.41, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 123, '519f0d2bee0a3e7fe68101009dbfb2a4b3b18bc590530e19ae00a3cf7f8d45a9', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0124', '2026-05-12'::date, 'Araquari', NULL, 'Araquari', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 2277395.27, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 124, '14c9f71ca527adac25ed3855f63fc2f6681e2df6793bdf8384094f4d4c33381d', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0125', '2026-05-12'::date, 'Rio dos Cedros', NULL, 'Rio dos Cedros', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 6434877.43, 5450000.00, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 125, 'ff8298e96fe1faa24f288de4f740da5917ed191f6ddf124ea0395651721e2198', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0126', '2026-05-13'::date, 'Nova Veneza', NULL, 'Nova Veneza', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 634090.67, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 126, '8874df0ee21827a837146a8ea2a1f40781cc07591088ac2d81fcc21103104507', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0127', '2026-05-13'::date, 'Araquari', NULL, 'Araquari', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1121501.09, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 127, '6a2f85c79a2cce3a8d711e0749bc5c9ccdde4fdce99e6b84c756e7dbcfcd8651', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0128', '2026-05-13'::date, 'Nova Veneza', NULL, 'Nova Veneza', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 668883.52, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 128, 'c30be26036edeb1371746a19bbad6aaed82fcb4834cf6c39bd785f3798942e48', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0129', '2026-05-13'::date, 'Araquari', NULL, 'Araquari', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1705675.09, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 129, 'f1c7cb4c7feb562f5a98422752ba03e1b34c5ef380b49fb8c05e8dd52bbca080', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0130', '2026-05-14'::date, 'Araquari', NULL, 'Araquari', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 862840.22, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 130, '4334fcaccbd6c3725a640da51a46c5d214798aef020ce8ff99abee0a0df6b020', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0131', '2026-05-15'::date, 'Forquilhinha', NULL, 'Forquilhinha', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 5076780.03, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 131, '1064b821a1ceae19a740f67d6f56db0a36adee97cf3d291292a62d0f3c7644ce', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0132', '2026-05-15'::date, 'Balneário Rincão', NULL, 'Balneário Rincão', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1592489.34, 1193000.00, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 132, 'eac0eab72320cc307868527e310eef60d491d8da9c0eefab4c80a91c741b1e20', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0133', '2026-05-18'::date, 'Criciuma', NULL, 'Criciuma', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 9295778.77, 8352000.00, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 133, '702e1dd769924301513bc12655daf34b842187eb2f5bc68a7bfc124f61655405', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0134', '2026-05-19'::date, 'Rio dos Cedros', NULL, 'Rio dos Cedros', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 283330.44, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 134, 'cd93118e824ed55be4bcbccd2de2584a78dfe3768e35e8567934cc6db3354765', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0135', '2026-05-19'::date, 'Lauro Muller', NULL, 'Lauro Muller', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 73210387.00, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 135, 'a686eac09483079d2c91f458333eaa7d9eaa701bbc7f3f4ce6fcadd2c1383d95', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0136', '2026-05-19'::date, 'Morro Grande', NULL, 'Morro Grande', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 5647737.95, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 136, '979a315cdb764cc84d1b446a96bf71a488446465ad648b19f3bc31be8bac1a4a', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0137', '2026-05-19'::date, 'Lauro Muller', NULL, 'Lauro Muller', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 3413509.19, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 137, '0314b31a41055f1bcc809048083b0e53bc1e620f1fd3f9d5c6707bcfdf0ada3c', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0138', '2026-05-19'::date, 'SIE', NULL, 'SIE', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 4454975.28, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 138, '7ca495e99155c4678187ad8232d3d6c5fafb7698b10754004b1524c7c99f3d32', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0139', '2026-05-20'::date, 'ES Engenaria', NULL, 'Criciuma', 'SC', NULL, 'Pavimentação', 'Privado', 'Indicação', NULL, 3375801.47, NULL, NULL, NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 139, '0280e01be979d8e2df52db3ec47ce5604ad9146617ce39951f2cbd281af77b20', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0140', '2026-05-20'::date, 'Araranguá', NULL, 'Araranguá', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 861041.50, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 140, '30ddecd7dcd58ad1d39a2d27e5110a79dc781dc05d9faded38517f76bb0ca15d', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0141', '2026-05-21'::date, 'Navegantes', NULL, 'Navegantes', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1893641.44, 1420420.44, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 141, '72433046b1ecca12c1c849fd09a3ad0a0329da8e4a7c90fdecbf14770926ebb5', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0142', '2026-05-21'::date, 'Treze de Maio', NULL, 'Treze de Maio', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 4087411.41, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 142, '8a672105881ce97a952176cf22da10e1412d2563e5a6d78ee773c55679f328dd', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0143', '2026-05-21'::date, 'Passo de Torres', NULL, 'Passo de Torres', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1762639.57, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 143, 'e6732fcfcf4a700fc3cb49dffa7b3a9750788bcb33e56ca2ffde7b98944ee5a9', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0144', '2026-05-22'::date, 'Ibirama', NULL, 'Ibirama', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 4575363.09, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 144, '10213e99bb48cb231b69787d06a04e662d4b1aedd95779794d37aa3436e50e58', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0145', '2026-05-22'::date, 'Forquilhinha', NULL, 'Forquilhinha', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1990498.78, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 145, '8316daed1edb06ea2a0aaa069aab0ef9e71e53d56c9daf6783036dd85d8b50e6', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0146', '2026-05-22'::date, 'Urussanga', NULL, 'Urussanga', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 37831716.78, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 146, '4fe5ccd4587c59b95eb3e2f4cf9a87396632924de2aa25fe6cd3cd2378d447e7', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0147', '2026-05-22'::date, 'Treviso', NULL, 'Treviso', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 5796740.32, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 147, '44924efc0c9c14f4d63141fcb030cda782e3d1962cb5e64bef6b79abf10d734f', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0148', '2026-05-22'::date, 'Jaguaruna', NULL, 'Jaguaruna', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 2102726.14, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 148, 'e25925b374ef3cce9ab8ff931f4906a3b6ad9b6395f63a20917aa32bd083b86c', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0149', '2026-05-22'::date, 'Içara', NULL, 'Içara', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 1340688.21, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 149, '4281863e71bfc7faf87912bffab79540be8a819eb5092659f90195ae06c3f21b', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0150', '2026-05-25'::date, 'Guabiruba', NULL, 'Guabiruba', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 4522485.63, 3391864.22, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 150, 'f51308850e15bc5fa4a315be1d061eac207a7771fd33921aa13339598d6b7167', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0151', '2026-05-26'::date, 'Maracajá', NULL, 'Maracajá', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 644356.80, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 151, 'cf146609c80aa15c6b064aa57b04984a94e8916c1c40be84010a55895936fe93', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0152', '2026-05-26'::date, 'Maracajá', NULL, 'Maracajá', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 423630.14, 423508.62, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 152, '413a8628914cf7e26dc4921b27025e500d87413384fc9335d6572e5acb74730d', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0153', '2026-05-27'::date, 'Laurentino', NULL, 'Laurentino', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 5508302.17, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 153, 'd8be7a6e7757de58b796be16d296d38b86fa4db5883eb286d8efa7b97449846e', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0154', '2026-05-27'::date, 'Rio dos Cedros', NULL, 'Rio dos Cedros', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 909015.47, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 154, '0668cf20b6e6f0885dda1773bf4b01e23549a5899b4122d6bc9d6bb23f944aa4', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0155', '2026-05-27'::date, 'Porto Belo', NULL, 'Porto Belo', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 12913128.15, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 155, 'a56af307f95728fbcbbcdacf31f0c4f2188d2ce9cb37fbe22025f49037a5a673', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0156', '2026-05-27'::date, 'Garopaba', NULL, 'Garopaba', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 12121742.73, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 156, '9db9d83a1ee5fd0c2a87ab97db3a55579c18cb533301ba2f03455102d4ff8813', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0157', '2026-05-29'::date, 'Imbituba', NULL, 'Imbituba', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 5598333.66, NULL, 'Perdida', 'Preço', 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 157, '26fc1f4a09af9597213dd7f0741fc5424982b586fabb47257b2e5317b9aad232', TRUE, NOW(), NOW()),
('legacy-commercial-opportunity-0158', '2026-05-29'::date, 'Tubarão', NULL, 'Tubarão', 'SC', NULL, 'Pavimentação', 'Público', 'Licitação', TRUE, 3115116.99, 2117500.00, 'Ganha', NULL, 'LEGACY_IMPORT', 'CONVERSÕES COMERCIAL.xlsm', 'BASE DE DADOS', 158, 'e41abde9571d4b680d70cf7aed9b0ea08ee31f9f0ffba06139dd74e56e7e6630', TRUE, NOW(), NOW())
ON CONFLICT ("sourceFingerprint") DO NOTHING;

INSERT INTO "CommercialProcessRecord" ("id","route","competition","contractNumber","contractingParty","launchType","requester","objectSummary","client","complexity","filledAt","contractSignedSentAt","launchEmailSentAt","workOpenedAt","registrationConsultSentAt","registrationReturnedAt","documentsSentAt","startDate","plannedBusinessDays","dueDate","completedDate","elapsedCalendarDays","elapsedBusinessDays","responsible","notes","sourceType","sourceFile","sourceSheet","sourceRow","sourceFingerprint","active","createdAt","updatedAt") VALUES
('legacy-commercial-process-old-0007', 'RETORNO_ORCAMENTO_PARTICULAR', '1', NULL, NULL, NULL, NULL, 'Loteamento ES', NULL, 'Pequena', '2025-12-15'::date, NULL, NULL, NULL, NULL, NULL, NULL, '2026-05-20'::date, NULL, NULL, '2026-05-20'::date, 0, 0, 'Lucas', NULL, 'LEGACY_IMPORT', 'Base_Indicadores_Tempos_PBI.xlsm', 'Base', 7, '9a8b95b8289d25498778ab0f8180c11f3dba3874c5f64338d398dbf6c3d8d451', TRUE, NOW(), NOW()),
('legacy-commercial-process-art-0003', 'EMISSAO_ART', 'CC 01-2026', '001/2026', 'Município de Içara', NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-13'::date, NULL, NULL, NULL, NULL, NULL, '2026-08-13'::date, 5, '2026-08-20'::date, '2026-08-19'::date, NULL, 4, NULL, NULL, 'LEGACY_IMPORT', 'Gustavo BI.xlsx', 'Emissão de ART´s', 3, 'e5b9b12e9c86b1bfc6984a7631d2f7df1d7814a0c7a5f200e25b922224ac64c4', TRUE, NOW(), NOW()),
('legacy-commercial-process-work-0006', 'INSERCAO_OBRA_SISTEMA', 'CC 01-2026', '001/2026', 'Município de Içara', 'LANÇAMENTO INICIAL', NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-13'::date, '2026-08-14'::date, NULL, NULL, NULL, '2026-08-14'::date, 5, '2026-08-21'::date, '2026-08-19'::date, NULL, 3, NULL, NULL, 'LEGACY_IMPORT', 'Gustavo BI.xlsx', 'Inserção de obras no sistema', 6, 'd25e11716489f30d6fefe1a7af41e1c9ac0c8e0509381220b5fa010c833ef38d', TRUE, NOW(), NOW()),
('legacy-commercial-process-work-0007', 'INSERCAO_OBRA_SISTEMA', 'CC 03-2025', '15/2025', 'Município de Criciúma', 'ADITIVO 01', NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-20'::date, '2026-08-22'::date, NULL, NULL, NULL, '2026-08-22'::date, 5, '2026-08-28'::date, '2026-08-29'::date, NULL, 6, NULL, NULL, 'LEGACY_IMPORT', 'Gustavo BI.xlsx', 'Inserção de obras no sistema', 7, 'f327138013139a4121fe5f31764293042f8dc74b365a0147d04371ce1339e37b', TRUE, NOW(), NOW()),
('legacy-commercial-process-budget-0006', 'RETORNO_ORCAMENTO_PARTICULAR', NULL, NULL, NULL, NULL, 'Júlio Remor', 'Implantação Condomínio xxx', 'xxxxxx', 'ALTA', NULL, NULL, NULL, NULL, '2026-08-13'::date, '2026-08-13'::date, '2026-08-13'::date, '2026-08-13'::date, 15, '2026-09-03'::date, '2026-09-02'::date, NULL, 14, NULL, NULL, 'LEGACY_IMPORT', 'Gustavo BI.xlsx', 'Retorno orçamento particulares', 6, 'cc96bc00c3f3372d66d7246a321a548ef32c4f1836252bb439783acf6783d477', TRUE, NOW(), NOW()),
('legacy-commercial-process-budget-0007', 'RETORNO_ORCAMENTO_PARTICULAR', NULL, NULL, NULL, NULL, 'Eder', 'Capa asfáltica pátio yyyy', 'yyyyyyy', 'BAIXA', NULL, NULL, NULL, NULL, '2026-08-13'::date, '2026-08-13'::date, '2026-08-13'::date, '2026-08-13'::date, 5, '2026-08-20'::date, '2026-08-21'::date, NULL, 6, NULL, NULL, 'LEGACY_IMPORT', 'Gustavo BI.xlsx', 'Retorno orçamento particulares', 7, 'f918f237429844427221ef564f15cd7c71de3ca79eb8ac4cb8263a04415108be', TRUE, NOW(), NOW())
ON CONFLICT ("sourceFingerprint") DO NOTHING;

INSERT INTO "CommercialIndicatorAudit" ("id","entityType","entityId","action","afterData","opportunityId","changedAt")
SELECT 'legacy-commercial-opportunity-audit-' || LPAD("sourceRow"::text, 4, '0'), 'OPPORTUNITY', "id", 'IMPORT', to_jsonb(o), "id", NOW()
FROM "CommercialOpportunity" o WHERE "sourceType" = 'LEGACY_IMPORT'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "CommercialIndicatorAudit" ("id","entityType","entityId","action","afterData","processId","changedAt")
SELECT 'legacy-commercial-process-audit-' || LPAD(ROW_NUMBER() OVER (ORDER BY "sourceFile", "sourceSheet", "sourceRow")::text, 4, '0'), 'PROCESS', "id", 'IMPORT', to_jsonb(p), "id", NOW()
FROM "CommercialProcessRecord" p WHERE "sourceType" = 'LEGACY_IMPORT'
ON CONFLICT ("id") DO NOTHING;

CREATE SCHEMA IF NOT EXISTS "bi";
CREATE OR REPLACE VIEW "bi"."comercial_oportunidades" AS
SELECT
  o."id" AS "ID_REGISTRO",
  o."entryDate" AS "DATA_ENTRADA",
  o."client" AS "CLIENTE",
  o."project" AS "OBRA_PROJETO",
  o."city" AS "CIDADE",
  o."state" AS "UF",
  o."commercialResponsible" AS "RESPONSAVEL_COMERCIAL",
  o."segment" AS "SEGMENTO",
  o."contractType" AS "TIPO_CONTRATO",
  o."opportunitySource" AS "ORIGEM_OPORTUNIDADE",
  CASE WHEN o."hadCompetition" IS TRUE THEN 'Sim' WHEN o."hadCompetition" IS FALSE THEN 'Não' END AS "HOUVE_CONCORRENCIA",
  o."disputedValue" AS "VALOR_DISPUTADO",
  o."closedValue" AS "VALOR_FECHADO",
  o."status" AS "STATUS_OPORTUNIDADE",
  o."lossReason" AS "MOTIVO_PERDA",
  o."sourceType" AS "ORIGEM_DADO",
  o."createdAt" AS "CRIADO_EM",
  o."updatedAt" AS "ATUALIZADO_EM"
FROM "CommercialOpportunity" o WHERE o."active" = TRUE;

CREATE OR REPLACE VIEW "bi"."comercial_oportunidades_pbi" AS
SELECT
  o."id" AS "ID_OPORTUNIDADE",
  o."entryDate" AS "DATA_ENTRADA",
  o."client" AS "CLIENTE",
  o."project" AS "OBRA / PROJETO",
  o."city" AS "CIDADE",
  o."state" AS "UF",
  o."commercialResponsible" AS "RESPONSAVEL_COMERCIAL",
  o."segment" AS "SEGMENTO",
  o."contractType" AS "TIPO_CONTRATO",
  o."opportunitySource" AS "ORIGEM_OPORTUNIDADE",
  CASE WHEN o."hadCompetition" IS TRUE THEN 'Sim' WHEN o."hadCompetition" IS FALSE THEN 'Não' END AS "HOUVE_CONCORRENCIA?",
  o."disputedValue" AS "VALOR_DISPUTADO",
  o."closedValue" AS "VALOR_FECHADO",
  o."status" AS "STATUS_OPORTUNIDADE",
  o."lossReason" AS "MOTIVO_PERDA"
FROM "CommercialOpportunity" o WHERE o."active" = TRUE;

CREATE OR REPLACE VIEW "bi"."comercial_prazos" AS
SELECT
  p."id" AS "ID_REGISTRO", p."route" AS "ROTA", p."competition" AS "CONCORRENCIA",
  p."contractNumber" AS "CONTRATO", p."contractingParty" AS "CONTRATANTE",
  p."launchType" AS "TIPO_LANCAMENTO", p."requester" AS "SOLICITANTE",
  p."objectSummary" AS "RESUMO_OBJETO", p."client" AS "CLIENTE",
  p."complexity" AS "COMPLEXIDADE", p."filledAt" AS "DATA_PREENCHIMENTO",
  p."contractSignedSentAt" AS "DATA_ENVIO_CONTRATO_ASSINADO",
  p."launchEmailSentAt" AS "DATA_ENVIO_EMAIL_LANCAMENTO",
  p."workOpenedAt" AS "DATA_ABERTURA_OBRA",
  p."registrationConsultSentAt" AS "DATA_CONSULTA_CADASTRO",
  p."registrationReturnedAt" AS "DATA_RETORNO_CADASTRO",
  p."documentsSentAt" AS "DATA_ENVIO_DOCUMENTOS", p."startDate" AS "DATA_INICIO",
  p."plannedBusinessDays" AS "PRAZO_DIAS_UTEIS", p."dueDate" AS "DATA_LIMITE",
  p."completedDate" AS "DATA_CONCLUSAO", p."elapsedCalendarDays" AS "DIAS_CORRIDOS",
  p."elapsedBusinessDays" AS "PRAZO_REALIZADO_DIAS_UTEIS",
  CASE WHEN p."startDate" IS NULL THEN 'Não iniciado' WHEN p."completedDate" IS NULL THEN 'Em andamento' WHEN p."completedDate" < p."startDate" THEN 'Inconsistente' ELSE 'Concluído' END AS "STATUS_CALCULADO",
  CASE WHEN p."completedDate" IS NULL OR p."dueDate" IS NULL THEN NULL ELSE p."completedDate" <= p."dueDate" END AS "DENTRO_PRAZO",
  p."responsible" AS "RESPONSAVEL", p."notes" AS "OBSERVACOES", p."sourceType" AS "ORIGEM_DADO",
  p."createdAt" AS "CRIADO_EM", p."updatedAt" AS "ATUALIZADO_EM"
FROM "CommercialProcessRecord" p WHERE p."active" = TRUE;

CREATE OR REPLACE VIEW "bi"."comercial_indicadores_tempos_pbi" AS
SELECT
  p."id" AS "ID_Registro",
  p."route" AS "Rota",
  p."competition" AS "Concorrencia",
  p."contractNumber" AS "Contrato",
  COALESCE(p."contractingParty", p."client") AS "Cliente_Contratante",
  p."objectSummary" AS "Obra_Nome",
  CASE p."route"
    WHEN 'EMISSAO_ART' THEN 'Emissão de ART'
    WHEN 'INSERCAO_OBRA_SISTEMA' THEN 'Inserção de obra/aditivo no sistema'
    WHEN 'RETORNO_ORCAMENTO_PARTICULAR' THEN 'Retorno de orçamento particular'
  END AS "Tema_Indicador",
  p."launchType" AS "Tipo_Lancamento",
  p."complexity" AS "Porte_Obra",
  p."filledAt" AS "Data_Preenchimento",
  p."startDate" AS "Data_Inicio",
  p."dueDate" AS "Data_Limite",
  p."completedDate" AS "Data_Fim",
  p."plannedBusinessDays" AS "Prazo_Dias_Uteis",
  CASE WHEN p."completedDate" < p."startDate" THEN NULL ELSE p."elapsedCalendarDays" END AS "Tempo_Dias_Corridos",
  CASE WHEN p."completedDate" < p."startDate" THEN NULL ELSE p."elapsedBusinessDays" END AS "Tempo_Dias_Uteis",
  p."responsible" AS "Responsavel",
  p."notes" AS "Observacoes",
  TO_CHAR(p."startDate", 'YYYY-MM') AS "Mes_Ano_Inicio",
  EXTRACT(YEAR FROM p."startDate")::integer AS "Ano_Inicio",
  CASE WHEN p."startDate" IS NULL THEN 'Não iniciado' WHEN p."completedDate" IS NULL THEN 'Em andamento' WHEN p."completedDate" < p."startDate" THEN 'Inconsistente' ELSE 'Concluído' END AS "Status_Calculado",
  CASE WHEN p."route" IS NOT NULL AND p."startDate" IS NOT NULL AND p."completedDate" IS NOT NULL AND p."completedDate" >= p."startDate" THEN 1 ELSE 0 END AS "Registro_Valido",
  CASE WHEN p."route" IS NULL THEN 'Informar rota' WHEN p."startDate" IS NULL THEN 'Preencher início' WHEN p."completedDate" IS NULL THEN 'Preencher fim' WHEN p."completedDate" < p."startDate" THEN 'Fim antes do início' ELSE 'OK' END AS "Alerta_Preenchimento",
  p."contractSignedSentAt" AS "Data_Envio_Contrato_Assinado",
  p."launchEmailSentAt" AS "Data_Envio_Email_Lancamento",
  p."workOpenedAt" AS "Data_Abertura_Obra",
  p."registrationConsultSentAt" AS "Data_Consulta_Cadastro",
  p."registrationReturnedAt" AS "Data_Retorno_Cadastro",
  p."documentsSentAt" AS "Data_Envio_Documentos",
  p."requester" AS "Solicitante",
  p."sourceType" AS "Origem_Dado",
  p."updatedAt" AS "Atualizado_Em"
FROM "CommercialProcessRecord" p WHERE p."active" = TRUE;

CREATE OR REPLACE VIEW "bi"."comercial_indicadores_config_pbi" AS
SELECT * FROM (VALUES
  ('EMISSAO_ART', 'Emissão de ART', 1, 'contractSignedSentAt', 'completedDate', 'contractSignedSentAt', NULL::integer, TRUE, DATE '2026-01-01', NULL::date),
  ('INSERCAO_OBRA_SISTEMA', 'Inserção de obras no sistema', 2, 'workOpenedAt', 'completedDate', 'workOpenedAt', NULL::integer, TRUE, DATE '2026-01-01', NULL::date),
  ('RETORNO_ORCAMENTO_PARTICULAR', 'Retorno de orçamento particular', 3, 'documentsSentAt', 'completedDate', 'documentsSentAt', NULL::integer, TRUE, DATE '2026-01-01', NULL::date)
) AS cfg("ROTA", "ROTULO", "ORDEM", "CAMPO_INICIO", "CAMPO_FIM", "CAMPO_GERADOR_LIMITE", "PRAZO_PADRAO_DIAS_UTEIS", "ATIVA", "VIGENCIA_INICIO", "VIGENCIA_FIM");

CREATE OR REPLACE VIEW "bi"."comercial_indicadores_mensais" AS
SELECT DATE_TRUNC('month', "DATA_INICIO")::date AS "COMPETENCIA", "ROTA",
       COUNT(*) AS "TOTAL_REGISTROS",
       COUNT(*) FILTER (WHERE "STATUS_CALCULADO" = 'Concluído') AS "CONCLUIDOS",
       AVG("PRAZO_REALIZADO_DIAS_UTEIS") FILTER (WHERE "PRAZO_REALIZADO_DIAS_UTEIS" IS NOT NULL) AS "MEDIA_DIAS_UTEIS",
       AVG(CASE WHEN "DENTRO_PRAZO" IS TRUE THEN 1.0 WHEN "DENTRO_PRAZO" IS FALSE THEN 0.0 END) * 100 AS "PERCENTUAL_NO_PRAZO"
FROM "bi"."comercial_prazos"
GROUP BY DATE_TRUNC('month', "DATA_INICIO")::date, "ROTA";

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    GRANT USAGE ON SCHEMA "bi" TO powerbi_reader;
    GRANT SELECT ON "bi"."comercial_oportunidades", "bi"."comercial_prazos", "bi"."comercial_indicadores_mensais", "bi"."comercial_oportunidades_pbi", "bi"."comercial_indicadores_tempos_pbi", "bi"."comercial_indicadores_config_pbi" TO powerbi_reader;
  END IF;
END $$;
