const socket = io('/');
const videoGrid = document.getElementById('video-grid');
const myVideo = document.createElement('video');
myVideo.muted = true;
const peers = {}; // { socketId: { peer, videoElement } }

const urlParams = new URLSearchParams(window.location.search);
const roomId = window.location.pathname.split('/')[2];
const userName = urlParams.get('name') || 'Anonymous';

let myStream;
let screenStream;

// Controls
const muteBtn = document.getElementById('mute-btn');
const videoBtn = document.getElementById('video-btn');
const screenShareBtn = document.getElementById('screen-share-btn');
const leaveBtn = document.getElementById('leave-btn');
const chatBtn = document.getElementById('chat-btn');
const chatContainer = document.getElementById('chat-container');
const closeChatBtn = document.getElementById('close-chat');
const chatInput = document.getElementById('chat-input');
const sendMsgBtn = document.getElementById('send-msg');
const chatMessages = document.getElementById('chat-messages');

// Whiteboard
const whiteboardBtn = document.getElementById('whiteboard-btn');
const whiteboardContainer = document.getElementById('whiteboard-container');
const closeBoardBtn = document.getElementById('close-board');
const clearBoardBtn = document.getElementById('clear-board');
const canvas = document.getElementById('whiteboard');
const ctx = canvas.getContext('2d');

// Initialize
navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true
}).then(stream => {
    myStream = stream;
    addVideoStream(myVideo, stream, 'You');

    socket.emit('join-room', roomId, socket.id, userName);

    socket.on('all-users', users => {
        users.forEach(user => {
            const peer = createPeer(user.socketId, socket.id, stream);
            peers[user.socketId] = { peer };
        });
    });

    socket.on('user-joined', payload => {
        const peer = addPeer(payload.signal, payload.callerID, stream);
        peers[payload.callerID] = { peer };
        // We will add the video element when the stream arrives
    });

    socket.on('receiving-returned-signal', payload => {
        const item = peers[payload.id];
        item.peer.signal(payload.signal);
    });

    socket.on('user-disconnected', userId => {
        if (peers[userId]) {
            if (peers[userId].videoElement) peers[userId].videoElement.parentElement.remove();
            if (peers[userId].peer) peers[userId].peer.destroy();
            delete peers[userId];
        }
    });
});

function createPeer(userToSignal, callerID, stream) {
    const peer = new SimplePeer({
        initiator: true,
        trickle: false,
        stream: stream
    });

    peer.on('signal', signal => {
        socket.emit('sending-signal', { userToSignal, callerID, signal, callerName: userName });
    });

    peer.on('stream', userStream => {
        if (!peers[userToSignal].videoElement) {
            const video = document.createElement('video');
            peers[userToSignal].videoElement = video;
            addVideoStream(video, userStream, userToSignal); // Ideally pass name
        }
    });

    return peer;
}

function addPeer(incomingSignal, callerID, stream) {
    const peer = new SimplePeer({
        initiator: false,
        trickle: false,
        stream: stream
    });

    peer.on('signal', signal => {
        socket.emit('returning-signal', { signal, callerID });
    });

    peer.on('stream', userStream => {
        if (!peers[callerID].videoElement) {
            const video = document.createElement('video');
            peers[callerID].videoElement = video;
            addVideoStream(video, userStream, callerID);
        }
    });

    peer.signal(incomingSignal);

    return peer;
}

function addVideoStream(video, stream, name) {
    const wrapper = document.createElement('div');
    wrapper.classList.add('video-wrapper');

    video.srcObject = stream;
    video.addEventListener('loadedmetadata', () => {
        video.play();
    });

    const nameTag = document.createElement('div');
    nameTag.classList.add('user-name-tag');
    nameTag.innerText = name === 'You' ? 'You' : (name.length > 15 ? name.substring(0, 15) + '...' : name); // Simple name handling

    wrapper.append(video);
    wrapper.append(nameTag);
    videoGrid.append(wrapper);
}

// Controls Logic
muteBtn.addEventListener('click', () => {
    const enabled = myStream.getAudioTracks()[0].enabled;
    if (enabled) {
        myStream.getAudioTracks()[0].enabled = false;
        muteBtn.classList.remove('active');
        muteBtn.classList.add('danger');
        muteBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
    } else {
        myStream.getAudioTracks()[0].enabled = true;
        muteBtn.classList.add('active');
        muteBtn.classList.remove('danger');
        muteBtn.innerHTML = '<i class="fas fa-microphone"></i>';
    }
});

videoBtn.addEventListener('click', () => {
    const enabled = myStream.getVideoTracks()[0].enabled;
    if (enabled) {
        myStream.getVideoTracks()[0].enabled = false;
        videoBtn.classList.remove('active');
        videoBtn.classList.add('danger');
        videoBtn.innerHTML = '<i class="fas fa-video-slash"></i>';
    } else {
        myStream.getVideoTracks()[0].enabled = true;
        videoBtn.classList.add('active');
        videoBtn.classList.remove('danger');
        videoBtn.innerHTML = '<i class="fas fa-video"></i>';
    }
});

screenShareBtn.addEventListener('click', () => {
    if (!screenStream) {
        navigator.mediaDevices.getDisplayMedia({ video: true }).then(stream => {
            screenStream = stream;
            const screenTrack = screenStream.getVideoTracks()[0];

            // Replace track for all peers
            for (let peerId in peers) {
                const peer = peers[peerId].peer;
                const sender = peer._pc.getSenders().find(s => s.track.kind === 'video');
                sender.replaceTrack(screenTrack);
            }

            screenTrack.onended = () => {
                stopScreenShare();
            };

            screenShareBtn.classList.add('active');
            myVideo.srcObject = screenStream; // Show my screen locally
        });
    } else {
        stopScreenShare();
    }
});

function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;

        const videoTrack = myStream.getVideoTracks()[0];
        for (let peerId in peers) {
            const peer = peers[peerId].peer;
            const sender = peer._pc.getSenders().find(s => s.track.kind === 'video');
            sender.replaceTrack(videoTrack);
        }

        screenShareBtn.classList.remove('active');
        myVideo.srcObject = myStream;
    }
}

leaveBtn.addEventListener('click', () => {
    window.location.href = '/';
});

// Chat Logic
chatBtn.addEventListener('click', () => {
    chatContainer.classList.toggle('open');
});

closeChatBtn.addEventListener('click', () => {
    chatContainer.classList.remove('open');
});

sendMsgBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

function sendMessage() {
    const msg = chatInput.value;
    if (msg) {
        socket.emit('send-chat-message', roomId, msg, userName);
        appendMessage('You', msg, true);
        chatInput.value = '';
    }
}

socket.on('chat-message', data => {
    appendMessage(data.userName, data.message, false);
    if (!chatContainer.classList.contains('open')) {
        chatBtn.classList.add('active'); // Notify
        setTimeout(() => chatBtn.classList.remove('active'), 1000);
    }
});

function appendMessage(user, text, isMine) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message');
    if (isMine) msgDiv.classList.add('my-message');

    const author = document.createElement('span');
    author.classList.add('message-author');
    author.innerText = user;

    const content = document.createElement('span');
    content.innerText = text;

    msgDiv.append(author);
    msgDiv.append(content);
    chatMessages.append(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Whiteboard Logic
whiteboardBtn.addEventListener('click', () => {
    whiteboardContainer.classList.add('active');
    resizeCanvas();
});

closeBoardBtn.addEventListener('click', () => {
    whiteboardContainer.classList.remove('active');
});

clearBoardBtn.addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    socket.emit('clear-canvas', roomId);
});

socket.on('clear-canvas', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

let drawing = false;
let current = { x: 0, y: 0 };

canvas.addEventListener('mousedown', onMouseDown, false);
canvas.addEventListener('mouseup', onMouseUp, false);
canvas.addEventListener('mouseout', onMouseUp, false);
canvas.addEventListener('mousemove', throttle(onMouseMove, 10), false);

function onMouseDown(e) {
    drawing = true;
    current.x = e.clientX;
    current.y = e.clientY;
}

function onMouseUp(e) {
    if (!drawing) return;
    drawing = false;
    drawLine(current.x, current.y, e.clientX, e.clientY, '#ffffff', true);
}

function onMouseMove(e) {
    if (!drawing) return;
    drawLine(current.x, current.y, e.clientX, e.clientY, '#ffffff', true);
    current.x = e.clientX;
    current.y = e.clientY;
}

function drawLine(x0, y0, x1, y1, color, emit) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.closePath();

    if (!emit) return;
    const w = canvas.width;
    const h = canvas.height;

    socket.emit('draw-line', roomId, {
        x0: x0 / w,
        y0: y0 / h,
        x1: x1 / w,
        y1: y1 / h,
        color
    });
}

socket.on('draw-line', (data) => {
    const w = canvas.width;
    const h = canvas.height;
    drawLine(data.x0 * w, data.y0 * h, data.x1 * w, data.y1 * h, data.color, false);
});

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

window.addEventListener('resize', resizeCanvas);

function throttle(callback, delay) {
    let previousCall = new Date().getTime();
    return function () {
        const time = new Date().getTime();
        if ((time - previousCall) >= delay) {
            previousCall = time;
            callback.apply(null, arguments);
        }
    };
}
