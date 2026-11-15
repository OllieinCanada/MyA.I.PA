import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import RouteBoundary from './RouteBoundary';
test('chunk failure offers explicit recovery without clearing state and resets on route change',()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;const container=document.createElement('div'),root=createRoot(container);
 const log=jest.spyOn(console,'error').mockImplementation(()=>{}),clear=jest.spyOn(Storage.prototype,'clear');
 function Broken(){throw Error('Synthetic chunk failure');}
 try{act(()=>root.render(<RouteBoundary route="admin"><Broken/></RouteBoundary>));expect(container.querySelector('[role=alert]')).not.toBeNull();expect(container.textContent).toContain('Unsaved edits may be lost');expect(clear).not.toHaveBeenCalled();act(()=>root.render(<RouteBoundary route="home"><h1>Home works</h1></RouteBoundary>));expect(container.textContent).toBe('Home works');}
 finally{act(()=>root.unmount());log.mockRestore();clear.mockRestore();}
});
