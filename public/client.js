const socket=io('/');
let localAudioStream=null,screenStream=null,peerConnections={},roomId='',userName='',isMuted=false,isSharingScreen=false;
const iceServers={iceServers:[{urls:'stun:stun.l.google.com:19302'}]};

window.onload=async function(){
userName=localStorage.getItem('userName');
roomId=location.pathname.split('/sala/')[1];
if(!userName){userName=prompt('Ingresa tu nombre:');if(!userName){location.href='/';return;}}
document.getElementById('room-name').textContent='Sala: '+roomId;
await iniciarAudio();
socket.emit('join-room',roomId,userName);
};

async function iniciarAudio(){
try{
localAudioStream=await navigator.mediaDevices.getUserMedia({video:false,audio:true});
console.log('Audio OK');
}catch(e){alert('Error micrófono');}
}

function crearPeerConnection(userId){
if(peerConnections[userId])return peerConnections[userId];
const pc=new RTCPeerConnection(iceServers);
if(localAudioStream)localAudioStream.getTracks().forEach(t=>pc.addTrack(t,localAudioStream));
if(screenStream)screenStream.getTracks().forEach(t=>pc.addTrack(t,screenStream));
pc.ontrack=(e)=>{
if(e.track.kind==='audio'){
let a=document.getElementById('audio-'+userId);
if(!a){a=document.createElement('audio');a.id='audio-'+userId;a.autoplay=true;a.srcObject=e.streams[0];document.body.appendChild(a);}
}else{
document.getElementById('shared-screen').srcObject=e.streams[0];
document.getElementById('shared-screen').style.display='block';
document.getElementById('no-screen-msg').style.display='none';
}
};
pc.onicecandidate=(e)=>{if(e.candidate)socket.emit('ice-candidate',{candidate:e.candidate,to:userId});};
peerConnections[userId]=pc;
return pc;
}

socket.on('user-connected',async (d)=>{
agregarParticipante(d.userId,d.userName);
document.getElementById('participant-count').textContent=d.totalParticipantes;
if(d.userId!==socket.id){
const pc=crearPeerConnection(d.userId);
const o=await pc.createOffer();
await pc.setLocalDescription(o);
socket.emit('offer',{offer:o,to:d.userId});
}
});

socket.on('current-participants',(p)=>{
p.forEach(x=>{if(x.id!==socket.id)agregarParticipante(x.id,x.nombre);});
});

socket.on('offer',async (d)=>{
const pc=crearPeerConnection(d.from);
await pc.setRemoteDescription(new RTCSessionDescription(d.offer));
const a=await pc.createAnswer();
await pc.setLocalDescription(a);
socket.emit('answer',{answer:a,to:d.from});
});

socket.on('answer',async (d)=>{
const pc=peerConnections[d.from];
if(pc)await pc.setRemoteDescription(new RTCSessionDescription(d.answer));
});

socket.on('ice-candidate',async (d)=>{
const pc=peerConnections[d.from];
if(pc)await pc.addIceCandidate(new RTCIceCandidate(d.candidate));
});

socket.on('user-disconnected',(d)=>{
removerParticipante(d.userId);
document.getElementById('participant-count').textContent=d.totalParticipantes;
if(peerConnections[d.userId]){peerConnections[d.userId].close();delete peerConnections[d.userId];}
const a=document.getElementById('audio-'+d.userId);
if(a)a.remove();
});

document.getElementById('btn-mute').onclick=function(){
if(localAudioStream){
const t=localAudioStream.getAudioTracks()[0];
t.enabled=!t.enabled;
isMuted=!t.enabled;
const b=document.getElementById('btn-mute');
if(isMuted){b.classList.add('muted');document.getElementById('mute-icon').textContent='🔇';document.getElementById('mute-text').textContent='Desmutear';}
else{b.classList.remove('muted');document.getElementById('mute-icon').textContent='🎤';document.getElementById('mute-text').textContent='Mutear';}
}
};

document.getElementById('btn-screen').onclick=async function(){
if(!isSharingScreen){
try{
screenStream=await navigator.mediaDevices.getDisplayMedia({video:true});
document.getElementById('shared-screen').srcObject=screenStream;
document.getElementById('shared-screen').style.display='block';
document.getElementById('no-screen-msg').style.display='none';
document.getElementById('btn-screen').classList.add('active');
document.getElementById('screen-icon').textContent='⏹️';
document.getElementById('screen-text').textContent='Detener';
isSharingScreen=true;
socket.emit('start-screen-share',roomId);
Object.values(peerConnections).forEach(pc=>screenStream.getTracks().forEach(t=>pc.addTrack(t,screenStream)));
screenStream.getVideoTracks()[0].onended=()=>detenerCompartirPantalla();
}catch(e){alert('Error compartir pantalla');}
}else{detenerCompartirPantalla();}
};

function detenerCompartirPantalla(){
if(screenStream){
screenStream.getTracks().forEach(t=>t.stop());
screenStream=null;
document.getElementById('shared-screen').style.display='none';
document.getElementById('no-screen-msg').style.display='block';
document.getElementById('btn-screen').classList.remove('active');
document.getElementById('screen-icon').textContent='🖥️';
document.getElementById('screen-text').textContent='Compartir';
isSharingScreen=false;
socket.emit('stop-screen-share',roomId);
}
}

document.getElementById('btn-leave').onclick=function(){
if(confirm('Salir?')){
if(localAudioStream)localAudioStream.getTracks().forEach(t=>t.stop());
if(screenStream)screenStream.getTracks().forEach(t=>t.stop());
socket.disconnect();
location.href='/';
}
};

function agregarParticipante(id,nombre){
if(document.getElementById('participant-'+id))return;
const d=document.createElement('div');
d.className='participant';
d.id='participant-'+id;
d.innerHTML='<strong>'+nombre+'</strong>'+(id===socket.id?' (TU)':'');
document.getElementById('participants-list').appendChild(d);
}

function removerParticipante(id){
const d=document.getElementById('participant-'+id);
if(d)d.remove();
}