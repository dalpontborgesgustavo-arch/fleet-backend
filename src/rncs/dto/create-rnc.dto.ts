export class CreateRncItemDto {
  code?: string | null;
  description!: string;
  quantity!: number | string;
  unit!: string;
  unitValue!: number | string;
}

export class CreateRncDto {
  type?: 'EXTERNAL' | 'WORK' | 'INTERNAL';
  cliente!: string;
  obra!: string;
  obraDescricao?: string;
  responsavel?: string | null;
  dataEntrada!: string;
  dataLimiteRetorno?: string;
  etapaObra!: string;
  enquadramentoMotivo!: string;
  valorRetidoInicial!: number | string;
  justificativasObservacoes?: string | null;
  internalMotivo?: string;
  internalCausador?: string;
  internalNomeColaborador?: string;
  valorNc?: number | string;
  colocarItemSistema?: boolean;
  internalCodigoItem?: string | null;
  internalDescricao?: string;
  internalQuantidade?: number | string;
  internalUnidadeMedida?: string;
  internalValorUnitario?: number | string;
  internalItems?: CreateRncItemDto[];
  ncArea?:
    | 'Qualidade'
    | 'Meio Ambiente'
    | 'Saude e seguranca'
    | 'Saúde e segurança';
  issuer?: string;
  destinationSector?: string;
  responsibleUserId?: string;
  nonConformityDescription?: string;
  immediateReaction?: string;
  immediateResponsible?: string;
  immediateDate?: string | null;
  photoUrl?: string | null;
}
