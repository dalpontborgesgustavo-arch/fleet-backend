import { teamWeeks } from './asphalt-team-week';
it('counts each ticket once including unknown works, crossing month boundaries within the week',()=>{
  const t={key:'x',date:'2026-10-31',teamId:'A',workCode:'524',quantityTon:'19.440000'};
  const weeks=teamWeeks([t,t,{...t,key:'y',workCode:null,date:'2026-11-01',quantityTon:'21.080001'},
    {...t,key:'z',teamId:null},{...t,key:'a',date:'2026-11-02'}]);
  expect(weeks).toHaveLength(3);
  expect(weeks.find(w=>w.teamId==='A'&&w.start==='2026-10-26')).toMatchObject({tons:'40.520001',rows:[{date:'2026-10-31',workCode:'524'},{date:'2026-11-01',workCode:null}]});
});
it('combines plants once, retaining separate works and origin, including equal identifiers',()=>{
  const base={date:'2026-11-20',teamId:'A',workCode:null,key:'same',quantityTon:'12.125001'};
  const manual={...base,external:true,workName:'Rua A',plantName:'Britagem Gaspar',quantityTon:'10.500'};
  const week=teamWeeks([base,manual,manual,{...manual,key:'B',workName:'Rua B',lineId:'b',quantityTon:'0'}])[0];
  expect(week.tons).toBe('22.625001');
  expect(week.rows).toHaveLength(3);
  expect(week.rows[1]).toMatchObject({plantName:'Britagem Gaspar',workName:'Rua A',tons:'10.500000'});
});
it('shows unreported external production as pending, not zero, including a week with only a plan',()=>{
  const w=teamWeeks([],[{teamId:'A',date:'2026-11-16',plannedTon:'300',externalMissing:true}])[0];
  expect(w).toMatchObject({start:'2026-11-16',plannedTon:'300.000',tons:null,externalMissing:1});
});
