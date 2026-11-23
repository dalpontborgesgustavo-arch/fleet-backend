import { Prisma } from '@prisma/client';
import type { AsphaltTicket } from './asphalt-day.actual';

export function monday(day: string) {
  const date=new Date(day+'T00:00:00Z');
  date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
  return date.toISOString().slice(0,10);
}
/** Aggregate tickets independently of manual plans: one weighing item, one contribution. */
export function teamWeeks(tickets: AsphaltTicket[],plans:{date:string;teamId:string;plannedTon:string;externalMissing:boolean}[] = []) {
  type DayWork={date:string;workCode:string|null;workName:string|null;plantName:string;tons:Prisma.Decimal};
  const weeks = new Map<string,{start:string;teamId:string|null;tons:Prisma.Decimal;rows:Map<string,DayWork>}>();
  const seen=new Set<string>();
  for(const t of tickets) {
    const key=JSON.stringify([!!t.external,t.key]);
    if(seen.has(key)) continue;
    seen.add(key);
    const plantName=t.plantName??'Içara';
    const start=monday(t.date), wk=JSON.stringify([t.teamId,start]), dk=JSON.stringify([t.date,t.workCode,t.lineId,plantName]);
    const w=weeks.get(wk)??{start,teamId:t.teamId,tons:new Prisma.Decimal(0),rows:new Map<string,DayWork>()};
    const d=w.rows.get(dk)??{date:t.date,workCode:t.workCode,workName:t.workName??null,plantName,tons:new Prisma.Decimal(0)};
    d.tons=d.tons.plus(t.quantityTon);w.tons=w.tons.plus(t.quantityTon);
    w.rows.set(dk,d);weeks.set(wk,w);
  }
  const planned=new Map<string,{tons:Prisma.Decimal;externalMissing:number}>();
  for(const p of plans){
    const start=monday(p.date),wk=JSON.stringify([p.teamId,start]);
    const previous=planned.get(wk);
    planned.set(wk,{tons:(previous?.tons??new Prisma.Decimal(0)).plus(p.plannedTon),externalMissing:(previous?.externalMissing??0)+Number(p.externalMissing)});
    if(!weeks.has(wk)) weeks.set(wk,{start,teamId:p.teamId,tons:new Prisma.Decimal(0),rows:new Map()});
  }
  return [...weeks.values()].sort((a,b)=>a.start.localeCompare(b.start)).map(w=>({
    start:w.start,teamId:w.teamId,tons:w.rows.size?w.tons.toFixed(6):null,
    plannedTon:planned.get(JSON.stringify([w.teamId,w.start]))?.tons.toFixed(3)??null,
    externalMissing:planned.get(JSON.stringify([w.teamId,w.start]))?.externalMissing??0,
    rows:[...w.rows.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(d=>({...d,tons:d.tons.toFixed(6)}))
  }));
}
