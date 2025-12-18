# How to Run ngrok and Connect Twilio

## Step 1: Start Your Server
```bash
npm run dev
```
Your server should be running on `http://localhost:3000`

## Step 2: Start ngrok (in a NEW terminal)
```bash
ngrok http 3000
```

You'll see output like:
```
Forwarding   https://abc123.ngrok-free.app -> http://localhost:3000
```

## Step 3: Copy the ngrok URL
Copy the HTTPS URL (e.g., `https://abc123.ngrok-free.app`)

## Step 4: Update Twilio Webhook
1. Go to [Twilio Console](https://console.twilio.com/)
2. Navigate to **Phone Numbers** → **Manage** → **Active Numbers**
3. Click on your Twilio phone number
4. Under **Voice & Fax**, find **A CALL COMES IN**
5. Set it to: `https://YOUR-NGROK-URL.ngrok-free.app/api/incoming-call`
   - Example: `https://abc123.ngrok-free.app/api/incoming-call`
6. Make sure it's set to **HTTP POST**
7. Click **Save**

## Step 5: Test It
Call your Twilio number! You should see logs in your server terminal.

## Quick Commands
```bash
# Terminal 1: Start server
npm run dev

# Terminal 2: Start ngrok
ngrok http 3000
```

## Troubleshooting
- **Server not running?** Check `npm run dev` is running in Terminal 1
- **ngrok not working?** Make sure you're using the HTTPS URL (not HTTP)
- **Webhook not receiving calls?** Double-check the URL ends with `/api/incoming-call`
- **Connection issues?** Make sure both terminal windows are running

