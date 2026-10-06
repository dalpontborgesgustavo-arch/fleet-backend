export type UserRole =
  | 'motorista'
  | 'manutencao'
  | 'manutentor'
  | 'supervisor'
  | 'supervisor_apoio'
  | 'gestor'
  | 'ceo'
  | 'compras'
  | 'engenharia'
  | 'topografia'
  | 'prumare'
  | 'prumare_admin'
  | 'corretor'
  | 'orcamento'
  | 'administrativo'
  | 'financeiro'
  | 'contabilidade'
  | 'juridico'
  | 'consultor'
  | 'rh'
  | 'qualidade'
  | 'almoxarifado'
  | 'licitacao'
  | 'usina_icara'
  | 'admin';

export type TipoFrota = 'Terraplanagem' | 'Caminhões' | 'Asfalto' | 'Veiculos';

export type User = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tipoFrota?: TipoFrota;
};

export type SeedUser = User & {
  password: string;
};

type SeedUserDefinition = User & {
  passwordEnv: string;
};

const USER_DEFINITIONS: readonly SeedUserDefinition[] = [
  {
    id: 'seed-admin',
    email: 'gustavo@jr.com.br',
    name: 'Gustavo',
    role: 'admin',
    passwordEnv: 'SEED_ADMIN_PASSWORD',
  },
  {
    id: 'seed-gestor',
    email: 'everton@jr.com.br',
    name: 'Everton',
    role: 'gestor',
    passwordEnv: 'SEED_GESTOR_PASSWORD',
  },
  {
    id: 'seed-manutencao',
    email: 'marcelo@jr.com.br',
    name: 'Marcelo',
    role: 'manutencao',
    passwordEnv: 'SEED_MANUTENCAO_PASSWORD',
  },
  {
    id: 'seed-manutentor',
    email: 'frederico@jr.com.br',
    name: 'Frederico',
    role: 'manutentor',
    passwordEnv: 'SEED_MANUTENTOR_PASSWORD',
  },
  {
    id: 'seed-supervisor',
    email: 'valdinei@jr.com.br',
    name: 'Valdinei',
    role: 'supervisor',
    tipoFrota: 'Terraplanagem',
    passwordEnv: 'SEED_SUPERVISOR_TERRAPLANAGEM_PASSWORD',
  },
  {
    id: 'seed-supervisor2',
    email: 'dioclesio@jr.com.br',
    name: 'Dioclesio',
    role: 'supervisor',
    tipoFrota: 'Asfalto',
    passwordEnv: 'SEED_SUPERVISOR_ASFALTO_PASSWORD',
  },
  {
    id: 'seed-supervisor3',
    email: 'claudinei@jr.com.br',
    name: 'Claudinei',
    role: 'supervisor',
    tipoFrota: 'Caminhões',
    passwordEnv: 'SEED_SUPERVISOR_CAMINHOES_PASSWORD',
  },
  {
    id: 'seed-motorista',
    email: 'motorista@jr.com.br',
    name: 'Motorista',
    role: 'motorista',
    passwordEnv: 'SEED_MOTORISTA_PASSWORD',
  },
] as const;

export const USERS: SeedUser[] = USER_DEFINITIONS.flatMap(
  ({ passwordEnv, ...user }): SeedUser[] => {
    const password = process.env[passwordEnv];

    if (!password) {
      return [];
    }

    return [{ ...user, password }];
  },
);
