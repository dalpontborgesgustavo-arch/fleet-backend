import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { AsphaltDayController, laboratoryValues, plantValues } from './asphalt-day.controller';
import { assertProductionAccess } from './production-control.access';
describe('Qualidade do Asfalto',()=>{
  const req={user:{sub:'qa',role:'qualidade'}};
  it('allows laboratory writes, not production writes or general module access', async()=>{
    const updateMany=jest.fn().mockResolvedValue({count:1});
    const controller=new AsphaltDayController({asphaltProductionDay:{updateMany}} as any);
    await expect(controller.lab(req,'day',{granulometria:' OK '})).resolves.toEqual({saved:true});
    expect(updateMany.mock.calls[0][0].data).toMatchObject({laboratory:{granulometria:'OK'},laboratoryBy:'qa'});
    await expect(controller.plan(req,{})).rejects.toThrow(ForbiddenException);
    expect(()=>assertProductionAccess(req.user)).toThrow(ForbiddenException);
  });
  it('rejects production fields in laboratory payload',()=>{
    expect(()=>laboratoryValues({plannedTon:'10'})).toThrow(BadRequestException);
  });
  it('saves external production by manual work without creating an official work or changing weighings',async()=>{
    const upsert=jest.fn().mockResolvedValue({id:'day'});
    const c=new AsphaltDayController({usinaAsphaltTeamVersion:{count:async()=>1},asphaltProductionDay:{upsert}} as any);
    const actor={user:{sub:'admin',role:'admin'}}, plan={date:'2026-11-18',teamId:'team',origin:'EXTERNA',plantName:'Britagem Gaspar',manualWorkName:' Rua  A ',plannedTon:'300',externalTon:'263.99'};
    await c.plan(actor,plan);
    expect(upsert.mock.calls[0][0]).toMatchObject({where:{workKey_teamId_date_plantKey:{workKey:'MANUAL:RUA A',plantKey:'EXT:BRITAGEM GASPAR'}},create:{lineId:null,manualWorkName:'Rua A',externalTon:'263.99'}});
    await expect(c.plan(actor,{...plan,externalTon:'0'})).rejects.toThrow('Justifique');
    await c.plan(actor,{...plan,externalTon:'0',reason:'Chuva',details:'Frente alagada'});
    expect(upsert.mock.calls[1][0].where).toEqual(upsert.mock.calls[0][0].where);
    await expect(c.destination(req,'day',{factId:'1'})).rejects.toThrow(ForbiddenException);
  });
  it('distinguishes unreported external weight from zero and forbids manual Içara',()=>{
    const gaspar={origin:'EXTERNA',plantName:' Britagem   Gaspar '};
    expect(plantValues(gaspar)).toMatchObject({plantKey:'EXT:BRITAGEM GASPAR',externalTon:null});
    expect(plantValues({...gaspar,externalTon:'0'}).externalTon).toBe('0');
    expect(()=>plantValues({origin:'ICARA',externalTon:'1'})).toThrow();
    expect(()=>plantValues({...gaspar,plantName:'Usina de Içara'})).toThrow();
  });
});
