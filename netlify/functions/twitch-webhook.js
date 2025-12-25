import crypto from 'crypto';

// Firebase Database URL from environment
const FIREBASE_DATABASE_URL = process.env.VITE_FIREBASE_DATABASE_URL || process.env.FIREBASE_DATABASE_URL;

// Twitch message types
const MESSAGE_TYPE_VERIFICATION = 'webhook_callback_verification';
const MESSAGE_TYPE_NOTIFICATION = 'notification';
const MESSAGE_TYPE_REVOCATION = 'revocation';

// Twitch headers
const TWITCH_MESSAGE_ID = 'twitch-eventsub-message-id';
const TWITCH_MESSAGE_TIMESTAMP = 'twitch-eventsub-message-timestamp';
const TWITCH_MESSAGE_SIGNATURE = 'twitch-eventsub-message-signature';
const TWITCH_MESSAGE_TYPE = 'twitch-eventsub-message-type';

// The name of your channel point reward
const REWARD_TITLE = 'Redeem a Free Game!';

// Verify Twitch signature
function verifySignature(messageId, timestamp, body, signature, secret) {
  const message = messageId + timestamp + body;
  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature),
    Buffer.from(signature)
  );
}

// Get or create user in Firebase
async function getOrCreateUser(username) {
  const normalizedUsername = username.toLowerCase();
  
  // Fetch all users
  const response = await fetch(`${FIREBASE_DATABASE_URL}/users.json`);
  const users = await response.json();
  
  if (users) {
    // Find existing user (case-insensitive)
    for (const [key, user] of Object.entries(users)) {
      if (user && user.username && user.username.toLowerCase() === normalizedUsername) {
        return { key, user };
      }
    }
  }
  
  // User doesn't exist, create new one
  const newUser = {
    username: normalizedUsername,
    ticketsAvailable: 0,
    gamesClaimed: [],
    lastRedemptionYear: null
  };
  
  // Find next available key
  const existingKeys = users ? Object.keys(users).map(k => parseInt(k)).filter(k => !isNaN(k)) : [];
  const nextKey = existingKeys.length > 0 ? Math.max(...existingKeys) + 1 : 1;
  
  // Create user in Firebase
  await fetch(`${FIREBASE_DATABASE_URL}/users/${nextKey}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newUser)
  });
  
  return { key: nextKey.toString(), user: newUser };
}

// Add ticket to user
async function addTicketToUser(username) {
  const { key, user } = await getOrCreateUser(username);
  const currentYear = new Date().getFullYear();
  
  // Check if user already redeemed this year
  if (user.lastRedemptionYear === currentYear) {
    console.log(`User ${username} already redeemed this year`);
    return { success: false, reason: 'already_redeemed_this_year' };
  }
  
  // Update user with new ticket and redemption year
  const updatedUser = {
    ...user,
    ticketsAvailable: (user.ticketsAvailable || 0) + 1,
    lastRedemptionYear: currentYear
  };
  
  await fetch(`${FIREBASE_DATABASE_URL}/users/${key}.json`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ticketsAvailable: updatedUser.ticketsAvailable,
      lastRedemptionYear: currentYear
    })
  });
  
  console.log(`Added ticket to user ${username}. New balance: ${updatedUser.ticketsAvailable}`);
  return { success: true, ticketsAvailable: updatedUser.ticketsAvailable };
}

export async function handler(event) {
  const headers = event.headers;
  const body = event.body;
  
  // Get Twitch headers
  const messageId = headers[TWITCH_MESSAGE_ID];
  const timestamp = headers[TWITCH_MESSAGE_TIMESTAMP];
  const signature = headers[TWITCH_MESSAGE_SIGNATURE];
  const messageType = headers[TWITCH_MESSAGE_TYPE];
  
  // Get webhook secret from environment
  const secret = process.env.TWITCH_WEBHOOK_SECRET;
  
  if (!secret) {
    console.error('TWITCH_WEBHOOK_SECRET not configured');
    return {
      statusCode: 500,
      body: 'Server configuration error'
    };
  }
  
  if (!FIREBASE_DATABASE_URL) {
    console.error('FIREBASE_DATABASE_URL not configured');
    return {
      statusCode: 500,
      body: 'Server configuration error'
    };
  }
  
  // Verify the signature
  if (signature && !verifySignature(messageId, timestamp, body, signature, secret)) {
    console.error('Invalid signature');
    return {
      statusCode: 403,
      body: 'Invalid signature'
    };
  }
  
  const payload = JSON.parse(body);
  
  // Handle verification challenge
  if (messageType === MESSAGE_TYPE_VERIFICATION) {
    console.log('Responding to Twitch verification challenge');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain' },
      body: payload.challenge
    };
  }
  
  // Handle revocation
  if (messageType === MESSAGE_TYPE_REVOCATION) {
    console.log('Subscription revoked:', payload.subscription.type);
    return {
      statusCode: 204,
      body: ''
    };
  }
  
  // Handle notification
  if (messageType === MESSAGE_TYPE_NOTIFICATION) {
    const eventType = payload.subscription.type;
    
    // Check if this is a channel point redemption
    if (eventType === 'channel.channel_points_custom_reward_redemption.add') {
      const redemption = payload.event;
      const rewardTitle = redemption.reward.title;
      const username = redemption.user_login;
      const userDisplayName = redemption.user_name;
      
      console.log(`Redemption received: "${rewardTitle}" by ${userDisplayName}`);
      
      // Check if it's the correct reward
      if (rewardTitle === REWARD_TITLE) {
        console.log(`Processing ticket for user: ${username}`);
        
        try {
          const result = await addTicketToUser(username);
          
          if (result.success) {
            console.log(`Successfully added ticket for ${username}`);
          } else {
            console.log(`Could not add ticket for ${username}: ${result.reason}`);
          }
        } catch (error) {
          console.error('Error adding ticket:', error);
        }
      }
    }
    
    return {
      statusCode: 204,
      body: ''
    };
  }
  
  return {
    statusCode: 200,
    body: 'OK'
  };
}

