import { ProductionControlService } from './production-control.service';
import { ProductionControlController } from './production-control.controller';

describe('remoção da obra no mês', () => {
  const counts = () => ({ daily: 3, weeks: 1, revisions: 5, asphaltDays: 0 });
  function setup() {
    const records = [{id:'a', _count:counts()}, {id:'b', _count:counts()}];
    const tx = { productionControlLine:{
      findFirst:jest.fn().mockResolvedValue({workCode:'542', workName:'Içara'}),
      findMany:jest.fn().mockResolvedValue(records),
    }, productionControlRevision:{createMany:jest.fn()} };
    const service = new ProductionControlService({$transaction: (fn: (t:typeof tx)=>unknown)=>fn(tx)} as never);
    return {service,tx,records};
  }
  it('requires admin even for preview', () => {
    const {service}=setup();
    expect(()=>new ProductionControlController(service).previewArchive({user:{sub:'u',role:'administrativo_producao'}},'2026-11','a')).toThrow();
  });
  it('checks snapshot and archives only the scoped lines without deleting data', async () => {
    const {service,tx,records}=setup();
    const preview=await service.archiveMonthWork('a','2026-11','u');
    expect(preview.daily).toBe(6);
    expect(tx.productionControlLine.findMany.mock.calls[0][0].where).toMatchObject({competence:'2026-11',workCode:'542'});
    expect(tx.productionControlRevision.createMany).not.toHaveBeenCalled();
    records[0]._count.revisions++;
    await expect(service.archiveMonthWork('a','2026-11','u',preview.signature)).rejects.toThrow('mudaram');
    const fresh=await service.archiveMonthWork('a','2026-11','u');
    await service.archiveMonthWork('a','2026-11','u',fresh.signature);
    expect(tx.productionControlRevision.createMany.mock.calls[0][0].data.map((r:{lineId:string})=>r.lineId)).toEqual(['a','b']);
  });
  it('preserves linked asphalt records', async () => {
    const {service,records,tx}=setup(); records[0]._count.asphaltDays=1;
    await expect(service.archiveMonthWork('a','2026-11','u')).rejects.toThrow('asfalto');
    expect(tx.productionControlRevision.createMany).not.toHaveBeenCalled();
  });
});
