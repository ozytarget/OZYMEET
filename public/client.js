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
let isScreenSharing = false;

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

// Check for Mobile
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

// Check for Secure Context (Required for Camera/Mic on Mobile)
if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1' && location.protocol !== 'https:') {
    alert('⚠️ WARNING: Camera and Microphone require HTTPS or Localhost. If you are on a mobile device connecting via IP, this will NOT work unless you set up HTTPS.');
}

// Hide Screen Share on Mobile (Not fully supported in browser web apps)
if (isMobile || !navigator.mediaDevices.getDisplayMedia) {
    screenShareBtn.style.display = 'none';
}

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
}).catch(err => {
    console.error("Error accessing media devices:", err);
    if (err.name === 'NotReadableError') {
        alert("Could not access camera/microphone. It might be in use by another application (like Zoom or another browser tab). Please close other apps and reload.");
    } else if (err.name === 'NotAllowedError') {
        alert("Permissions denied. Please allow camera and microphone access in your browser settings.");
    } else if (err.name === 'NotFoundError') {
        alert("No camera or microphone found on this device.");
    } else {
        alert("Error accessing media devices: " + err.message + ". Ensure you are using HTTPS.");
    }
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
    if (!myStream) {
        alert("No audio stream available. Check your microphone permissions.");
        return;
    }
    const audioTrack = myStream.getAudioTracks()[0];
    if (audioTrack.enabled) {
        audioTrack.enabled = false;
        muteBtn.classList.remove('active');
        muteBtn.classList.add('danger');
        muteBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
    } else {
        audioTrack.enabled = true;
        muteBtn.classList.add('active');
        muteBtn.classList.remove('danger');
        muteBtn.innerHTML = '<i class="fas fa-microphone"></i>';
    }
});

videoBtn.addEventListener('click', () => {
    if (!myStream) {
        alert("No video stream available. Check your camera permissions or if another app is using it.");
        return;
    }
    const videoTrack = myStream.getVideoTracks()[0];
    if (videoTrack.enabled) {
        videoTrack.enabled = false;
        videoBtn.classList.remove('active');
        videoBtn.classList.add('danger');
        videoBtn.innerHTML = '<i class="fas fa-video-slash"></i>';
    } else {
        videoTrack.enabled = true;
        videoBtn.classList.add('active');
        videoBtn.classList.remove('danger');
        videoBtn.innerHTML = '<i class="fas fa-video"></i>';
    }
});

screenShareBtn.addEventListener('click', () => {
    if (!isScreenSharing) {
        navigator.mediaDevices.getDisplayMedia({ video: true }).then(stream => {
            screenStream = stream;
            const screenTrack = screenStream.getVideoTracks()[0];

            // Replace track for all peers
            for (let peerId in peers) {
                const peer = peers[peerId].peer;
                // Safe replacement for SimplePeer
                const sender = peer._pc.getSenders().find(s => s.track.kind === 'video');
                if (sender) {
                    sender.replaceTrack(screenTrack).catch(err => console.error("Track replacement failed", err));
                }
            }

            screenTrack.onended = () => {
                stopScreenShare();
            };

            isScreenSharing = true;
            screenShareBtn.classList.add('active');

            // Optional: Show my screen in my view
            myVideo.srcObject = screenStream;
        }).catch(err => {
            console.error("Failed to get display media", err);
        });
    } else {
        stopScreenShare();
    }
});

function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
        isScreenSharing = false;

        const videoTrack = myStream.getVideoTracks()[0];
        for (let peerId in peers) {
            const peer = peers[peerId].peer;
            const sender = peer._pc.getSenders().find(s => s.track.kind === 'video');
            if (sender) {
                sender.replaceTrack(videoTrack).catch(err => console.error("Track replacement failed", err));
            }
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

// Touch support for mobile whiteboard
canvas.addEventListener('mousedown', onMouseDown, false);
canvas.addEventListener('mouseup', onMouseUp, false);
canvas.addEventListener('mouseout', onMouseUp, false);
canvas.addEventListener('mousemove', throttle(onMouseMove, 10), false);

canvas.addEventListener('touchstart', onTouchStart, false);
canvas.addEventListener('touchend', onMouseUp, false);
canvas.addEventListener('touchcancel', onMouseUp, false);
canvas.addEventListener('touchmove', throttle(onTouchMove, 10), false);

function onMouseDown(e) {
    drawing = true;
    current.x = e.clientX;
    current.y = e.clientY;
}

function onTouchStart(e) {
    drawing = true;
    const touch = e.touches[0];
    current.x = touch.clientX;
    current.y = touch.clientY;
}

function onMouseUp(e) {
    if (!drawing) return;
    drawing = false;
    // For mouse up, we don't necessarily draw a final line segment unless we want to close a gap
}

function onMouseMove(e) {
    if (!drawing) return;
    drawLine(current.x, current.y, e.clientX, e.clientY, '#ffffff', true);
    current.x = e.clientX;
    current.y = e.clientY;
}

function onTouchMove(e) {
    if (!drawing) return;
    e.preventDefault();
    const touch = e.touches[0];
    drawLine(current.x, current.y, touch.clientX, touch.clientY, '#ffffff', true);
    current.x = touch.clientX;
    current.y = touch.clientY;
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
