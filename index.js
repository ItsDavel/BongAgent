// Corrected index.js code

// Required imports
const express = require('express');
const app = express();

// Middleware
app.use(express.json());

// Updated function for group chat handling
app.post('/groupChat', (req, res) => {
    const { users, message } = req.body;

    // Check for case sensitivity and handle users
    const uniqueUsers = [...new Set(users.map(user => user.toLowerCase()))];

    if (uniqueUsers.length === 0) return res.status(400).send('No users provided.');

    // Simulate message sending
    try {
        // Function to send message
        sendMessageToGroup(uniqueUsers, message);
        return res.status(200).send('Message sent successfully.');
    } catch (error) {
        return res.status(500).send('Error sending message: ' + error.message);
    }
});

// Text extraction function
function sendMessageToGroup(users, message) {
    users.forEach(user => {
        // Logic to send a message to each user
        console.log(`Sending message to ${user}: ${message}`);
    });
}

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
