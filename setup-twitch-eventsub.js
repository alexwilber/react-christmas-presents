/**
 * Twitch EventSub Registration Script
 * 
 * This script registers a webhook with Twitch to receive channel point redemption events.
 * 
 * Before running:
 * 1. Set your environment variables (or edit the values below)
 * 2. Make sure your Netlify site is deployed with the webhook function
 * 3. Run: node setup-twitch-eventsub.js
 */

// ============ CONFIGURATION ============
// You can set these as environment variables or edit directly here

const CLIENT_ID = process.env.TWITCH_clientId;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const WEBHOOK_SECRET = process.env.TWITCH_WEBHOOK_SECRET;
const BROADCASTER_LOGIN = process.env.TWITCH_channelName;

// Your Netlify site URL (update this after deploying)
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://YOUR-SITE.netlify.app/api/twitch-webhook';

// ========================================

async function getAppAccessToken() {
  console.log('Getting App Access Token...');
  
  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'client_credentials'
    })
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(`Failed to get token: ${JSON.stringify(data)}`);
  }
  
  console.log('✓ Got App Access Token');
  return data.access_token;
}

async function getBroadcasterId(accessToken) {
  console.log(`Getting broadcaster ID for ${BROADCASTER_LOGIN}...`);
  
  const response = await fetch(`https://api.twitch.tv/helix/users?login=${BROADCASTER_LOGIN}`, {
    headers: {
      'Client-ID': CLIENT_ID,
      'Authorization': `Bearer ${accessToken}`
    }
  });
  
  const data = await response.json();
  
  if (!data.data || data.data.length === 0) {
    throw new Error(`User not found: ${BROADCASTER_LOGIN}`);
  }
  
  const broadcasterId = data.data[0].id;
  console.log(`✓ Broadcaster ID: ${broadcasterId}`);
  return broadcasterId;
}

async function listExistingSubscriptions(accessToken) {
  console.log('\nChecking existing subscriptions...');
  
  const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
    headers: {
      'Client-ID': CLIENT_ID,
      'Authorization': `Bearer ${accessToken}`
    }
  });
  
  const data = await response.json();
  
  if (data.data && data.data.length > 0) {
    console.log(`Found ${data.data.length} existing subscription(s):`);
    for (const sub of data.data) {
      console.log(`  - ${sub.type} (${sub.status}) - ID: ${sub.id}`);
    }
  } else {
    console.log('No existing subscriptions found.');
  }
  
  return data.data || [];
}

async function deleteSubscription(accessToken, subscriptionId) {
  console.log(`Deleting subscription ${subscriptionId}...`);
  
  const response = await fetch(`https://api.twitch.tv/helix/eventsub/subscriptions?id=${subscriptionId}`, {
    method: 'DELETE',
    headers: {
      'Client-ID': CLIENT_ID,
      'Authorization': `Bearer ${accessToken}`
    }
  });
  
  if (response.status === 204) {
    console.log('✓ Subscription deleted');
  } else {
    console.log(`Failed to delete: ${response.status}`);
  }
}

async function createSubscription(accessToken, broadcasterId) {
  console.log('\nCreating EventSub subscription...');
  console.log(`  Webhook URL: ${WEBHOOK_URL}`);
  
  const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
    method: 'POST',
    headers: {
      'Client-ID': CLIENT_ID,
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: 'channel.channel_points_custom_reward_redemption.add',
      version: '1',
      condition: {
        broadcaster_user_id: broadcasterId
      },
      transport: {
        method: 'webhook',
        callback: WEBHOOK_URL,
        secret: WEBHOOK_SECRET
      }
    })
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    console.error('Failed to create subscription:', JSON.stringify(data, null, 2));
    throw new Error(`Failed to create subscription: ${data.message}`);
  }
  
  console.log('✓ Subscription created successfully!');
  console.log(`  Status: ${data.data[0].status}`);
  console.log(`  ID: ${data.data[0].id}`);
  
  if (data.data[0].status === 'webhook_callback_verification_pending') {
    console.log('\n⏳ Waiting for Twitch to verify your webhook...');
    console.log('   Make sure your Netlify function is deployed and accessible!');
  }
  
  return data;
}

async function main() {
  console.log('=== Twitch EventSub Setup ===\n');
  
  // Validate configuration
  if (CLIENT_SECRET === 'YOUR_CLIENT_SECRET_HERE') {
    console.error('❌ Please set your TWITCH_CLIENT_SECRET');
    console.log('\nGet it from: https://dev.twitch.tv/console/apps');
    process.exit(1);
  }
  
  if (WEBHOOK_URL.includes('YOUR-SITE')) {
    console.error('❌ Please set your WEBHOOK_URL to your Netlify site');
    console.log('\nExample: https://wilbos-free-games.netlify.app/api/twitch-webhook');
    process.exit(1);
  }
  
  if (WEBHOOK_SECRET === 'your-webhook-secret-here') {
    console.error('❌ Please set a TWITCH_WEBHOOK_SECRET');
    console.log('\nThis should be a random string. Use the same value in Netlify env vars.');
    process.exit(1);
  }
  
  try {
    const accessToken = await getAppAccessToken();
    const broadcasterId = await getBroadcasterId(accessToken);
    
    // List existing subscriptions
    const existing = await listExistingSubscriptions(accessToken);
    
    // Optional: Delete existing subscriptions for the same type
    const existingRedemptionSubs = existing.filter(
      sub => sub.type === 'channel.channel_points_custom_reward_redemption.add'
    );
    
    if (existingRedemptionSubs.length > 0) {
      console.log('\nFound existing redemption subscription(s). Deleting...');
      for (const sub of existingRedemptionSubs) {
        await deleteSubscription(accessToken, sub.id);
      }
    }
    
    // Create new subscription
    await createSubscription(accessToken, broadcasterId);
    
    console.log('\n=== Setup Complete ===');
    console.log('\nNext steps:');
    console.log('1. Make sure TWITCH_WEBHOOK_SECRET is set in Netlify environment variables');
    console.log('2. The webhook will now receive channel point redemption events');
    console.log('3. When someone redeems "Redeem a Free Game!", they\'ll get a ticket!');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();

