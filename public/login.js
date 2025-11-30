document.getElementById('join-btn').addEventListener('click', () => {
    const username = document.getElementById('username').value;
    const roomId = document.getElementById('room-id').value;

    if (username && roomId) {
        window.location.href = `/room/${roomId}?name=${encodeURIComponent(username)}`;
    } else {
        alert('Please enter both name and room ID');
    }
});

document.getElementById('new-meeting-btn').addEventListener('click', async () => {
    const username = document.getElementById('username').value;
    if (!username) {
        alert('Please enter your name first');
        return;
    }

    try {
        const response = await fetch('/api/new-room');
        const data = await response.json();
        window.location.href = `/room/${data.roomId}?name=${encodeURIComponent(username)}`;
    } catch (error) {
        console.error('Error creating room:', error);
        alert('Failed to create new meeting');
    }
});
