// Display catalog only; never derive identity or routing from this choice.
const TRADES = Object.freeze({
 electrician:{label:'Electrician',path:'M13 2 4 14h6l-1 8 9-12h-6l1-8Z'},
 plumber:{label:'Plumber',path:'M12 2S5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13Z'},
 hvac:{label:'HVAC',path:'M12 2v20M3 12h18M5 5l14 14M5 19 19 5'},
 contractor:{label:'Contractor',path:'m14 5 5 5-3 3-5-5 3-3ZM11 8l-7 7 5 5 7-7M16 3l5 5'},
 roofer:{label:'Roofer',path:'m3 12 9-8 9 8M6 11v9h12v-9'},
 painter:{label:'Painter',path:'M4 4h12v5H4ZM16 6h4v6H9v3M7 15h4v6H7Z'},
});
const tradeDisplay=id=>typeof id==='string'&&Object.hasOwn(TRADES,id)?TRADES[id]:null;
module.exports={TRADES,tradeDisplay};
