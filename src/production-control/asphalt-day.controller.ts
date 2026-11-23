import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { PrismaService } from '../prisma/prisma.service';
import { USINA_ASPHALT_TEAM_CONTEXT as plant } from '../usina-asphalt-teams/usina-asphalt-teams.rules';
import { parseCompetence, parseDateInMonth, parseQuantity, requiredText, optionalText } from './production-control.rules';
import type { ProductionActor } from './production-control.access';
import { actualForDay } from './asphalt-day.actual';
import { monday, teamWeeks } from './asphalt-team-week';
import { containsDate, dateKey } from '../usina-asphalt-teams/usina-asphalt-teams.rules';

const works = { activity: { equals: 'Asfalto', mode: 'insensitive' as const }, unit: 't' };
const lineFields = { id: true, workName: true, workCode: true, engineer: true, municipality: true };
const labFields = ['cap','teorProjeto','teorRealizado','granulometria','espessuraProjeto','sondagem','espessuraExecutada','compactacao','vazios','observacoes'];
type Request = {user: ProductionActor};
const reasons=['Chuva','Quebra de equipamento','Baixa da equipe','Fresagem','Outro'];
export function plantValues(body: Record<string,unknown>) {
  if(body.origin!=='EXTERNA' && body.origin!=='ICARA') throw new BadRequestException('Selecione a origem.');
  if(body.origin==='ICARA'){
    if(body.externalTon!=null && body.externalTon!=='') throw new BadRequestException('A tonelagem de Içara vem da balança.');
    return {plantKey:'ICARA',plantName:'Içara',externalTon:null};
  }
  const plantName=requiredText(body.plantName,'Usina externa',80).replace(/\s+/g,' ');
  const key=plantName.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
  if(!key || /\bICARA\b/.test(key)) throw new BadRequestException('Para Içara use a origem automática.');
  return {plantKey:'EXT:'+key,plantName,externalTon:parseQuantity(body.externalTon??null,'Executado externo',true)};
}
export function laboratoryValues(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !labFields.includes(k)))
    throw new BadRequestException('Campos de laboratório inválidos.');
  const result: Record<string,string> = {};
  for (const [key,v] of Object.entries(value)) {
    if (typeof v !== 'string' || v.length > 500) throw new BadRequestException('Valor de ensaio inválido.');
    if (v.trim()) result[key] = v.trim();
  }
  return result;
}
@Controller('production-control/asphalt')
@UseGuards(JwtGuard)
export class AsphaltDayController {
  constructor(private readonly db: PrismaService) {}
  private async access(req: Request, write?: 'production'|'laboratory') {
    if (!req.user?.sub) throw new ForbiddenException();
    const permissions = req.user.role === 'admin' ? {production:true,laboratory:true} :
      req.user.role === 'qualidade' ? {production:false,laboratory:true} :
      await this.db.asphaltProductionAccess.findUnique({where:{userId:req.user.sub},select:{production:true,laboratory:true}});
    if (!permissions || (!permissions.production && !permissions.laboratory) || (write && !permissions[write])) throw new ForbiddenException();
    return permissions;
  }
  @Get()
  async list(@Req() req: Request, @Query('competence') month: string) {
    const permissions = await this.access(req);
    const from = new Date(parseCompetence(month)+'-01T00:00:00Z');
    const next = new Date(from); next.setUTCMonth(next.getUTCMonth()+1);
    const weekFrom=new Date(monday(dateKey(from))+'T00:00:00Z');
    const weekEnd=new Date(monday(dateKey(new Date(next.getTime()-86400000)))+'T00:00:00Z'); weekEnd.setUTCDate(weekEnd.getUTCDate()+7);
    const [registered,teams,records] = await Promise.all([
      this.db.productionControlLine.findMany({where:{competence:month,...works},select:lineFields,orderBy:{workName:'asc'}}),
      this.db.usinaAsphaltTeamVersion.findMany({where:{companyId:plant.companyId,unitId:plant.unitId,deletedAt:null,team:{deletedAt:null},validFrom:{lt:weekEnd},OR:[{validTo:null},{validTo:{gte:weekFrom}}]},select:{teamId:true,displayName:true,validFrom:true,validTo:true}}),
      this.db.asphaltProductionDay.findMany({where:{date:{gte:weekFrom,lt:weekEnd}},include:{line:{select:lineFields}},orderBy:[{date:'asc'},{id:'asc'}]}),
    ]);
    const days=records.map(d=>({...d,line:d.line??{id:d.workKey,workName:d.manualWorkName!,workCode:null,engineer:d.manualEngineer??'',municipality:d.manualMunicipality}}));
    const manual=new Map(days.filter(d=>!d.lineId&&d.date>=from&&d.date<next).map(d=>[d.workKey,d.line]));
    const lines=[...registered,...manual.values()];
    const scope={companyId:plant.companyId,unitId:plant.unitId};
    const [facts,items,runs]=await Promise.all([
      this.db.usinaProductionFact.findMany({where:{...scope,source:'AETHOS',active:true,occurredDate:{gte:weekFrom,lt:weekEnd}},
        select:{id:true,weighingId:true,occurredDate:true,quantityTon:true,aethosProductId:true,sourceRecordId:true,asphaltDestination:{select:{dayId:true}}}}),
      this.db.usinaAsphaltTeamItemAssignment.findMany({where:{...scope,deletedAt:null,validFrom:{lt:weekEnd},OR:[{validTo:null},{validTo:{gte:weekFrom}}],team:{deletedAt:null}},
        select:{aethosProductId:true,teamId:true,validFrom:true,validTo:true,team:{select:{validFrom:true,validTo:true}}}}),
      this.db.usinaSyncRun.findMany({where:{dataset:'PRODUCTION',syncMode:'full',status:'COMPLETED',rejectedCount:0,scopeCompanyId:scope.companyId,scopeUnitId:scope.unitId,scopeDateFrom:{lt:next},scopeDateTo:{gte:from}},
        select:{scopeDateFrom:true,scopeDateTo:true,generatedAt:true}}),
    ]);
    const tickets=facts.map(f=>{
      const date=dateKey(f.occurredDate), match=items.filter(i=>i.aethosProductId===f.aethosProductId&&containsDate(i,date)&&containsDate(i.team,date));
      const teamId=match.length===1 && teams.filter(t=>t.teamId===match[0].teamId&&containsDate(t,date)).length===1?match[0].teamId:null;
      const target=f.asphaltDestination && days.find(d=>d.id===f.asphaltDestination!.dayId && dateKey(d.date)===date && d.teamId===teamId && d.plantKey==='ICARA');
      return {date,teamId,workCode:target?.line.workCode??null,lineId:target?.line.id,workName:target?.line.workName,
        factId:f.id,weighing:f.weighingId,quantityTon:f.quantityTon.toString(),key:f.sourceRecordId};
    });
    const external=days.filter(d=>d.plantKey!=='ICARA' && d.externalTon!==null).map(d=>({date:dateKey(d.date),teamId:d.teamId,lineId:d.line.id,
      workCode:d.line.workCode,workName:d.line.workName,external:true,plantName:d.plantName,quantityTon:d.externalTon!.toString(),key:d.id}));
    const plans=days.map(d=>({date:dateKey(d.date),teamId:d.teamId,plannedTon:d.plannedTon.toString(),externalMissing:d.plantKey!=='ICARA'&&d.externalTon===null}));
    return {permissions,lines,teams,teamWeeks:teamWeeks([...tickets,...external],plans),weighings:permissions.production?tickets.filter(t=>t.teamId && t.date.startsWith(month)).map(({factId,weighing,date,teamId,quantityTon,lineId,workCode})=>({factId,weighing,date,teamId,quantityTon,lineId,workCode})):[],days:days.filter(d=>d.date>=from && d.date<next).map(d=>{
      const date=dateKey(d.date);
      const covered=runs.some(r=>dateKey(r.scopeDateFrom)<=date&&dateKey(r.scopeDateTo)>=date&&
        new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(r.generatedAt)>date);
      const unique=days.filter(x=>x.plantKey==='ICARA'&&dateKey(x.date)===date&&x.line.workCode===d.line.workCode&&x.teamId===d.teamId).length===1;
      return {...d,actual:d.plantKey==='ICARA'?actualForDay({date,teamId:d.teamId,lineId:d.line.id,workCode:unique?d.line.workCode:null},tickets,covered):
        {status:d.externalTon===null?'AGUARDANDO_LANCAMENTO':'MANUAL',tons:d.externalTon?.toString()??null}};
    })};
  }
  @Put('plan')
  async plan(@Req() req: Request,@Body() body: Record<string,unknown>) {
    await this.access(req,'production');
    const teamId=requiredText(body?.teamId,'Equipe'),month=parseCompetence(String(body.date).slice(0,7));
    const manualWorkName=optionalText(body.manualWorkName,160)?.replace(/\s+/g,' ')??null;
    const lineId=optionalText(body.lineId),manualEngineer=optionalText(body.manualEngineer),manualMunicipality=optionalText(body.manualMunicipality);
    if(!!lineId===!!manualWorkName) throw new BadRequestException('Escolha a obra cadastrada ou informe o nome curto.');
    if(lineId && !await this.db.productionControlLine.findFirst({where:{id:lineId,competence:month,...works},select:{id:true}}))
      throw new NotFoundException('Serviço de asfalto não encontrado nesta competência.');
    const workKey=lineId??('MANUAL:'+manualWorkName!.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase());
    const date=parseDateInMonth(body.date,month), plannedTon=parseQuantity(body.plannedTon,'Programado')!;
    const valid={deletedAt:null,validFrom:{lte:date},OR:[{validTo:null},{validTo:{gte:date}}]};
    if(await this.db.usinaAsphaltTeamVersion.count({where:{teamId,companyId:plant.companyId,unitId:plant.unitId,...valid,team:valid}})!==1)
      throw new BadRequestException('Equipe sem cadastro único vigente na data.');
    const source=plantValues(body), reason=optionalText(body.reason),details=optionalText(body.details,500);
    if(reason && !reasons.includes(reason)) throw new BadRequestException('Motivo inválido.');
    if(source.externalTon!==null && Number(source.externalTon)===0 && (!reason || !details)) throw new BadRequestException('Justifique o executado zero com motivo e descrição.');
    const changes={plannedTon,...source,manualWorkName,manualMunicipality,manualEngineer,reason,details,productionBy:req.user.sub!,productionAt:new Date()};
    return this.db.asphaltProductionDay.upsert({where:{workKey_teamId_date_plantKey:{workKey,teamId,date,plantKey:source.plantKey}},create:{lineId,workKey,teamId,date,...changes},update:changes});
  }
  @Put(':id/destination')
  async destination(@Req() req:Request,@Param('id') dayId:string,@Body() body:Record<string,unknown>){
    await this.access(req,'production');
    const factId=requiredText(body?.factId,'Pesagem');
    const day=await this.db.asphaltProductionDay.findUnique({where:{id:dayId}});
    if(!day || day.plantKey!=='ICARA') throw new BadRequestException('Selecione uma programação de Içara.');
    const fact=await this.db.usinaProductionFact.findFirst({where:{id:factId,source:'AETHOS',active:true,companyId:plant.companyId,unitId:plant.unitId,occurredDate:day.date}});
    if(!fact) throw new BadRequestException('Pesagem fora da data ou da usina.');
    const active={deletedAt:null,validFrom:{lte:day.date},OR:[{validTo:null},{validTo:{gte:day.date}}]};
    const scope={companyId:plant.companyId,unitId:plant.unitId};
    const items=await this.db.usinaAsphaltTeamItemAssignment.findMany({where:{...scope,...active,team:active,aethosProductId:fact.aethosProductId},select:{teamId:true}});
    if(items.length!==1 || items[0].teamId!==day.teamId || await this.db.usinaAsphaltTeamVersion.count({where:{...scope,...active,teamId:day.teamId}})!==1) throw new BadRequestException('Pesagem de outra equipe ou sem vínculo único.');
    const values={dayId,updatedBy:req.user.sub!,updatedAt:new Date()};
    await this.db.asphaltDestination.upsert({where:{factId},create:{factId,...values},update:values});
    return {saved:true};
  }
  @Put(':id/lab')
  async lab(@Req() req: Request,@Param('id') id:string,@Body() body:unknown) {
    await this.access(req,'laboratory');
    const laboratory=laboratoryValues(body);
    const updated=await this.db.asphaltProductionDay.updateMany({where:{id},data:{laboratory,laboratoryBy:req.user.sub!,laboratoryAt:new Date()}});
    if(!updated.count) throw new NotFoundException('Lançamento não encontrado.');
    return {saved:true};
  }
}
