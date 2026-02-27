export type UserRole = 'motorista' | 'manutencao' | 'manutentor' | 'supervisor' | 'gestor' | 'admin';

export type TipoFrota = 'Terraplanagem' | 'Caminhões' | 'Asfalto';

export type User = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tipoFrota?: TipoFrota;
};

export const USERS = [
  { id: 'seed-admin', email: 'gustavo@jr.com.br', name: 'Gustavo', password: 'Gustavo123!', role: 'admin' },
  { id: 'seed-gestor', email: 'everton@jr.com.br', name: 'Everton', password: 'Everton123!', role: 'gestor' },
  { id: 'seed-manutencao', email: 'marcelo@jr.com.br', name: 'Marcelo', password: 'Marcelo123!', role: 'manutencao' },
  { id: 'seed-manutentor', email: 'frederico@jr.com.br', name: 'Frederico', password: 'Frederico123!', role: 'manutentor' },
  { id: 'seed-supervisor', email: 'valdinei@jr.com.br', name: 'Valdinei', password: 'Valdinei123!', role: 'supervisor', tipoFrota: 'Terraplanagem' },
  { id: 'seed-supervisor2', email: 'dioclesio@jr.com.br', name: 'Dioclesio', password: 'Dioclesio123!', role: 'supervisor', tipoFrota: 'Asfalto' },
  { id: 'seed-supervisor3', email: 'claudinei@jr.com.br', name: 'Claudinei', password: 'Claudinei123!', role: 'supervisor', tipoFrota: 'Caminhões' },
  { id: 'seed-motorista', email: 'motorista@jr.com.br', name: 'Motorista', password: 'Motorista123!', role: 'motorista' }
] as const;
