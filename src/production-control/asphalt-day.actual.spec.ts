import { actualForDay } from './asphalt-day.actual';
const day={teamId:'a',date:'2026-11-18',workCode:'A'};
const tickets=[{...day,key:'1',quantityTon:'60.123456'},{...day,workCode:'B',key:'2',quantityTon:'40'}];
it('uses the official work on each ticket without splitting or duplicating weight',()=>{
  expect(actualForDay(day,tickets,true).tons).toBe('60.123456');
  expect(actualForDay({...day,workCode:'B'},tickets,true).tons).toBe('40.000000');
});
it('keeps manually assigned Içara weights separate even when both works lack codes',()=>{
  const weights=tickets.map((t,i)=>({...t,lineId:String(i),workCode:null}));
  expect(actualForDay({...day,lineId:'0',workCode:null},weights,true).tons).toBe('60.123456');
  expect(actualForDay({...day,lineId:'1',workCode:null},weights,true).tons).toBe('40.000000');
});
it('does not turn missing coverage or an unresolved load into zero',()=>{
  expect(actualForDay(day,[],false).tons).toBeNull();
  expect(actualForDay(day,[],true).tons).toBe('0.000000');
  expect(actualForDay(day,[{...tickets[0],workCode:null}],true).tons).toBeNull();
  expect(actualForDay(day,[tickets[0],tickets[0]],true).tons).toBeNull();
});
