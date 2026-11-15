'use strict';
const ENGINES=['chromium','firefox','webkit'],WIDTHS=[320,390,1440];
function complete(report){
 if(report?.scope!=='local-built-UI-with-inert-fixtures'||report.buildUnchanged!==true||report.shippingReady!==false||report.realDeliveryProven!==false)return false;
 if(!Array.isArray(report.failures)||report.failures.length||!Array.isArray(report.unexpectedWrites)||report.unexpectedWrites.length)return false;
 if(!Array.isArray(report.cases)||report.cases.length!==9)return false;
 const pairs=new Set(report.cases.map(c=>c.engine+':'+c.width));
 return pairs.size===9&&ENGINES.every(e=>WIDTHS.every(w=>pairs.has(e+':'+w)))
  &&report.cases.every(c=>c.passed===true&&c.routeChunkLoaded===true&&c.adminTimelinePassed===true);
}
// Measure usable content, not border-box minus an assumed padding constant.
function roomyCard(cardWidth,contentWidth){
 return Number.isFinite(cardWidth)&&Number.isFinite(contentWidth)&&contentWidth>0
  &&cardWidth>=Math.min(200,contentWidth)-1;
}
module.exports={complete,ENGINES,WIDTHS,roomyCard};
