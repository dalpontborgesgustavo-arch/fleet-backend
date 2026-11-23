import { Prisma } from '@prisma/client';

export type AsphaltTicket = {
  date: string; teamId: string | null; workCode: string | null; quantityTon: string; key: string;
  lineId?: string|null; workName?: string|null; plantName?: string; external?: boolean;
};
// The caller must confirm full-day source coverage before treating absence as zero.
export function actualForDay(day: { date:string; teamId:string; workCode:string|null; lineId?:string }, tickets: AsphaltTicket[], covered:boolean) {
  if (!covered) return {status:'AGUARDANDO_USINA' as const, tons:null};
  if (!day.workCode && !day.lineId) return {status:'REVISAR_OBRA' as const, tons:null};
  let total=new Prisma.Decimal(0);
  const seen=new Set<string>();
  for(const t of tickets) {
    if(t.external || t.date!==day.date || (t.teamId && t.teamId!==day.teamId)) continue;
    if(t.lineId ? t.lineId!==day.lineId : t.workCode && day.workCode && t.workCode!==day.workCode) continue;
    if(!t.teamId || (!t.lineId && (!t.workCode || !day.workCode)) || seen.has(t.key)) return {status:'REVISAR_VINCULO' as const,tons:null};
    seen.add(t.key);
    total=total.plus(t.quantityTon);
  }
  return {status:'CONFIRMADO' as const,tons:total.toFixed(6)};
}
