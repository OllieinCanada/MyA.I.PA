// Trusted CI network plumbing, not an application/delivery worker.
const net=require('node:net');
const {parentPort}=require('node:worker_threads');
if(!parentPort)throw Error('SYNTHETIC_BACKUP_RELAY_THREAD_ONLY');
const sockets=new Set();
const server=net.createServer(socket=>{
  const upstream=net.connect({host:'postgres',port:5432});sockets.add(socket);sockets.add(upstream);
  const close=()=>{socket.destroy();upstream.destroy();};
  socket.on('error',close);upstream.on('error',close);
  socket.on('close',()=>sockets.delete(socket));upstream.on('close',()=>sockets.delete(upstream));
  socket.pipe(upstream);upstream.pipe(socket);
});
server.listen(0,'127.0.0.1',()=>parentPort.postMessage({port:server.address().port}));
parentPort.on('message',message=>{if(message!=='stop')return;for(const socket of sockets)socket.destroy();server.close(()=>parentPort.close());});
