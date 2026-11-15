import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import CallOutcomeTimeline from './CallOutcomeTimeline';
test('shows separate evidence states without actions or unsafe HTML',()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;const container=document.createElement('div'),root=createRoot(container);
 try{act(()=>root.render(<CallOutcomeTimeline call={{id:1,status:'COMPLETED',notificationEvidence:{available:true,owner:{state:'accepted',accepted:true},customer:{state:'failed'}}}}/>));
 expect(container.querySelectorAll('li').length).toBe(5);expect(container.textContent).toContain('delivery is not confirmed');expect(container.textContent).toContain('Messaging failure recorded');expect(container.querySelectorAll('button,a,input').length).toBe(0);expect(container.querySelector('time')).toBeNull();
 }finally{act(()=>root.unmount());}
});
