# Complete Beginner's Guide to the Pronunciation Assessment System

## Table of Contents
1. [What is a WebSocket?](#what-is-a-websocket)
2. [Why We Need WebSockets for Audio](#why-websockets-for-audio)
3. [Understanding the Architecture](#understanding-the-architecture)
4. [Step-by-Step: What Happens When You Call](#step-by-step-what-happens)
5. [Understanding Audio Formats](#understanding-audio-formats)
6. [Code Walkthrough: Each File Explained](#code-walkthrough)
7. [How Everything Connects](#how-everything-connects)

---

## What is a WebSocket?

### Traditional HTTP (Request-Response)
Think of HTTP like **mailing a letter**:
- You send a letter (request)
- You wait
- You get a response letter back
- Connection closes
- If you want to send another letter, you start over

**Example:**
```
You: "Hey server, give me a webpage"
Server: *sends webpage*
Connection: *closes*
```

### WebSocket (Persistent Connection)
Think of WebSocket like a **phone call**:
- You call someone
- The line stays open
- You can talk back and forth continuously
- Both sides can send messages anytime
- Connection stays open until someone hangs up

**Example:**
```
You: "Hey server, let's keep this connection open"
Server: "OK, connection open!"
You: "Here's some data"
Server: "Got it, here's a response"
You: "More data..."
Server: "More response..."
... continues until someone closes ...
```

### Why WebSockets for Audio?
Audio is **continuous** - it's a stream of data that flows over time, like water from a faucet. You can't use HTTP (which is like sending letters) because:
- Audio needs to flow in real-time
- You'd have to send thousands of HTTP requests (one per audio chunk)
- There would be delays and gaps
- It's inefficient

WebSocket is perfect because:
- Connection stays open
- Audio chunks can flow continuously
- Low latency (real-time)
- Efficient

---

## Why We Need WebSockets for Audio

### The Problem We're Solving
When someone calls your Twilio number and speaks, we need to:
1. Capture their voice in real-time
2. Send it to Azure for analysis
3. Get pronunciation scores back

This is like **live streaming** - you can't wait for the entire speech to finish before sending it. You need to process it as it happens.

### The Solution: WebSocket Stream
```
Caller speaks: "Hello how are you"
     │
     │ Audio flows continuously...
     ▼
Twilio captures audio → Sends chunks via WebSocket → Your server → Azure
     │
     │ (happens in real-time, as they speak)
     ▼
Azure analyzes → Returns scores → Saved to file
```

---

## Understanding the Architecture

### The Big Picture
```
┌─────────────────────────────────────────────────────────────┐
│                    YOUR COMPUTER (LOCAL)                    │
│                                                              │
│  ┌──────────────┐      ┌──────────────┐                    │
│  │  Next.js     │      │  WebSocket   │                    │
│  │  Server      │◄────►│  Server      │                    │
│  │  (HTTP)      │      │  (WS)        │                    │
│  └──────┬───────┘      └──────┬───────┘                    │
│         │                     │                             │
│         │ Port 3000           │ Port 3000                   │
└─────────┼─────────────────────┼─────────────────────────────┘
          │                     │
          │                     │
          ▼                     ▼
    ┌──────────┐          ┌──────────┐
    │  ngrok   │          │  ngrok   │
    │  Tunnel  │          │  Tunnel  │
    └────┬─────┘          └────┬─────┘
         │                     │
         │ HTTPS               │ WSS (WebSocket Secure)
         │                     │
         ▼                     ▼
    ┌──────────────────────────────────┐
    │         THE INTERNET             │
    └──────────────────────────────────┘
         │                     │
         ▼                     ▼
    ┌──────────┐          ┌──────────┐
    │  Twilio  │          │  Azure   │
    │  Cloud   │          │  Speech  │
    └──────────┘          └──────────┘
```

### Components Explained

#### 1. **Your Local Server** (Port 3000)
- Runs on your computer
- Handles two things:
  - **HTTP requests** (for the webhook)
  - **WebSocket connections** (for audio streaming)

#### 2. **ngrok** (Tunnel)
- Your computer is behind a router/firewall
- Twilio can't directly reach `localhost:3000`
- ngrok creates a **tunnel**:
  - Public URL: `https://abc123.ngrok-free.app`
  - Forwards to: `http://localhost:3000`
- Like a **mail forwarding service** - mail comes to a public address, gets forwarded to your private address

#### 3. **Twilio**
- Phone service provider
- When someone calls your number:
  - Twilio receives the call
  - Sends HTTP request to your webhook
  - Opens WebSocket to stream audio

#### 4. **Azure Speech**
- Microsoft's speech recognition service
- Analyzes pronunciation
- Returns scores

---

## Step-by-Step: What Happens When You Call

### Step 1: The Phone Call
```
You call: +1-555-123-4567
     │
     ▼
Twilio receives call
```

### Step 2: Twilio Calls Your Webhook
Twilio thinks: "Someone called! I need to know what to do. Let me ask the webhook."

```
Twilio → HTTP POST → https://your-ngrok-url/api/incoming-call
```

**What Twilio sends:**
```javascript
{
  CallSid: "CA123...",
  From: "+15551234567",
  To: "+15557654321",
  // ... other call info
}
```

### Step 3: Your Server Responds with TwiML
Your server (`incoming-call/route.ts`) responds with **TwiML** (Twilio Markup Language) - instructions for Twilio:

```xml
<Response>
  <Start>
    <Stream url="wss://your-ngrok-url/api/media-stream" track="inbound" />
  </Start>
  <Say>Please speak now...</Say>
  <Pause length="300"/>
</Response>
```

**What this means:**
- `<Start><Stream>` = "Start streaming audio to this WebSocket URL"
- `track="inbound"` = "Only send the caller's voice (not Twilio's voice)"
- `<Say>` = "Play this message to the caller"
- `<Pause>` = "Wait 30 seconds (300 = 30.0 seconds)"

### Step 4: Twilio Opens WebSocket Connection
Twilio sees the `<Stream>` instruction and opens a WebSocket:

```
Twilio → WebSocket → wss://your-ngrok-url/api/media-stream
```

**What happens:**
1. Twilio sends HTTP request with `Upgrade: websocket` header
2. Your server upgrades the connection to WebSocket
3. Connection is now **persistent** - stays open

### Step 5: WebSocket Handshake
```
Twilio: "I want to upgrade to WebSocket"
Server: "OK, upgrading..."
Connection: *upgrades from HTTP to WebSocket*
Twilio: "Connected!"
Server: "Connected! Here's a confirmation: {event: 'connected'}"
```

### Step 6: Stream Starts
Twilio sends a `start` event:

```json
{
  "event": "start",
  "streamSid": "MZabc123...",
  "start": {
    "accountSid": "AC...",
    "mediaFormat": {
      "encoding": "audio/x-mulaw",
      "sampleRate": 8000
    }
  }
}
```

**What this tells you:**
- Stream is starting
- Audio format: μ-law, 8000 Hz (8kHz)
- Stream ID for tracking

### Step 7: Your Server Initializes Azure
When `start` event arrives, your server:
1. Creates Azure Speech recognizer
2. Sets up pronunciation assessment
3. Starts listening for audio

### Step 8: Audio Chunks Arrive
Twilio sends audio continuously as the caller speaks:

```json
{
  "event": "media",
  "media": {
    "payload": "base64-encoded-audio-data-here..."
  }
}
```

**What's happening:**
- Caller says: "Hello"
- Twilio captures audio in small chunks (every 20ms)
- Each chunk is encoded as μ-law
- μ-law is base64-encoded
- Sent via WebSocket

**Timeline:**
```
Time 0ms:   Caller starts saying "Hello"
Time 20ms:  First audio chunk sent → {event: "media", payload: "..."}
Time 40ms:  Second chunk sent → {event: "media", payload: "..."}
Time 60ms:  Third chunk sent → {event: "media", payload: "..."}
... continues until they stop speaking ...
```

### Step 9: Audio Conversion
Your server receives each chunk and converts it:

```
Base64 μ-law → Decode base64 → μ-law bytes → Decode μ-law → PCM → Azure
```

**Why convert?**
- Twilio sends: μ-law (compressed, 8-bit)
- Azure needs: PCM (uncompressed, 16-bit)
- Like converting MP3 to WAV

### Step 10: Azure Processes Audio
Azure receives PCM audio chunks and:
1. Recognizes speech: "Hello how are you"
2. Compares to reference: "Hello how are you!"
3. Calculates scores:
   - Accuracy: 96%
   - Pronunciation: 92.7%
   - etc.

### Step 11: Results Returned
Azure sends results back via callback:

```javascript
onResult({
  accuracyScore: 96,
  pronunciationScore: 92.7,
  // ... other scores
  words: [
    {word: "hello", accuracyScore: 97, errorType: "None"},
    // ... more words
  ]
})
```

### Step 12: Results Saved
Your server saves results to file:

```
results/pronunciation_1234567890.txt
```

### Step 13: Stream Ends
When call ends:
- Twilio sends `{event: "stop"}`
- WebSocket closes
- Azure recognizer stops
- Resources cleaned up

---

## Understanding Audio Formats

### What is Audio?
Audio is **sound waves** - vibrations in the air. To store it digitally, we need to:
1. **Sample** the sound (take snapshots)
2. **Quantize** it (convert to numbers)
3. **Encode** it (compress/format)

### Sampling Rate
How many times per second we capture the sound:
- **8 kHz** = 8,000 samples per second (telephone quality)
- **16 kHz** = 16,000 samples per second (better quality)
- **44.1 kHz** = 44,100 samples per second (CD quality)

**Analogy:** Like frames in a video - more frames = smoother motion

### Bit Depth
How many bits per sample:
- **8-bit** = 256 possible values (0-255)
- **16-bit** = 65,536 possible values (-32,768 to 32,767)

**Analogy:** Like color depth - 8-bit = 256 colors, 16-bit = 65,536 colors

### Audio Formats

#### μ-law (mu-law, G.711)
- **Compressed** format (like JPEG for images)
- Used in telephony
- 8-bit samples
- 8 kHz sample rate
- Smaller file size
- Lower quality

**Why Twilio uses it:**
- Standard for phone calls
- Efficient (less bandwidth)
- Good enough for speech

#### PCM (Pulse Code Modulation)
- **Uncompressed** format (like BMP for images)
- Raw audio data
- 16-bit samples
- Can be any sample rate
- Larger file size
- Higher quality

**Why Azure needs it:**
- Better for analysis
- More accurate
- Standard format for speech recognition

### Conversion Process

**μ-law to PCM:**
```
μ-law byte: 0x7F (8 bits)
     │
     ▼
Decode using μ-law algorithm
     │
     ▼
PCM value: -1 (16 bits, signed integer)
     │
     ▼
Write as little-endian 16-bit: [0xFF, 0xFF]
```

**Example:**
```javascript
// μ-law byte
const mulawByte = 0x7F

// Decode to PCM
const pcmValue = mulaw.decodeSample(mulawByte)  // Returns: -1

// Convert to 16-bit little-endian bytes
// -1 in 16-bit signed = 0xFFFF
// Little-endian = [0xFF, 0xFF]
buffer.writeInt16LE(pcmValue, 0)
```

---

## Code Walkthrough: Each File Explained

### File 1: `server.ts` - The Main Server

This is the **heart** of your application. It combines:
- Next.js HTTP server (for web pages and API routes)
- WebSocket server (for audio streaming)

#### Part 1: Setup
```typescript
const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()
```
- Creates Next.js app
- `handle` is a function that processes HTTP requests

```typescript
const server = createServer()
```
- Creates a basic HTTP server
- This will handle BOTH HTTP and WebSocket

#### Part 2: WebSocket Server Creation
```typescript
const wss = new WebSocketServer({ 
  noServer: true,  // Don't attach to HTTP server yet
  path: '/api/media-stream',
})
```

**What `noServer: true` means:**
- Normally, WebSocketServer attaches to an HTTP server automatically
- We set `noServer: true` because we want **manual control**
- We need to handle WebSocket upgrades **before** Next.js processes them
- This ensures WebSocket requests don't get treated as regular HTTP requests

#### Part 3: Handling WebSocket Upgrades
```typescript
server.on('upgrade', (request, socket, head) => {
  const pathname = parse(request.url || '', true).pathname
  
  if (pathname === '/api/media-stream') {
    // This is a WebSocket upgrade request
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request)
    })
  } else {
    // Not a WebSocket, destroy the connection
    socket.destroy()
  }
})
```

**What's happening:**
1. Client (Twilio) sends HTTP request with `Upgrade: websocket` header
2. Server receives `upgrade` event
3. Checks if path is `/api/media-stream`
4. If yes: Upgrade to WebSocket
5. If no: Close connection (not a WebSocket request)

**Why this matters:**
- WebSocket starts as HTTP request
- Then "upgrades" to WebSocket protocol
- We intercept this upgrade before Next.js sees it

#### Part 4: Handling HTTP Requests
```typescript
server.on('request', async (req, res) => {
  const parsedUrl = parse(req.url!, true)
  await handle(req, res, parsedUrl)  // Let Next.js handle it
})
```

**What's happening:**
- Regular HTTP requests (not WebSocket)
- Pass to Next.js to handle
- This includes your `/api/incoming-call` route

#### Part 5: WebSocket Connection Handler
```typescript
wss.on('connection', (ws, req) => {
  // ws = WebSocket connection
  // req = Original HTTP request
  
  let recognizer: AzureSpeechRecognizer | null = null
  
  // Send acknowledgment to Twilio
  ws.send(JSON.stringify({ event: 'connected' }))
})
```

**What's happening:**
- New WebSocket connection established
- `ws` is the WebSocket object (used to send/receive)
- `req` is the original HTTP request (contains headers, URL, etc.)
- Send `{event: 'connected'}` to tell Twilio we're ready

#### Part 6: Handling Messages
```typescript
ws.on('message', (data: Buffer) => {
  const message = JSON.parse(data.toString())
  
  if (message.event === 'start') {
    // Initialize Azure
  } else if (message.event === 'media') {
    // Process audio
  } else if (message.event === 'stop') {
    // Cleanup
  }
})
```

**What's happening:**
- Twilio sends messages as JSON strings
- We parse them
- Handle different event types

#### Part 7: Processing Audio
```typescript
else if (message.event === 'media') {
  const pcmBuffer = convertTwilioAudioToPcm(message.media.payload)
  recognizer.writeAudioChunk(pcmBuffer)
}
```

**What's happening:**
1. Receive base64 μ-law audio
2. Convert to PCM
3. Send to Azure

#### Part 8: Cleanup
```typescript
ws.on('close', () => {
  if (recognizer) {
    recognizer.stop()
    recognizer.close()
  }
})
```

**What's happening:**
- When WebSocket closes, clean up Azure resources

---

### File 2: `src/app/api/incoming-call/route.ts` - Twilio Webhook

This handles the **initial HTTP request** from Twilio when someone calls.

#### The Function
```typescript
export async function POST(request: NextRequest) {
  // This runs when Twilio sends POST request
}
```

**Why POST?**
- Twilio sends call data in the request body
- POST allows sending data (GET doesn't)

#### Getting the Base URL
```typescript
const host = request.headers.get('host')
const protocol = request.headers.get('x-forwarded-proto') || 'https'
const baseUrl = `${protocol}://${host}`
```

**What's happening:**
- When behind ngrok, headers tell us the public URL
- `host`: `abc123.ngrok-free.app`
- `x-forwarded-proto`: `https`
- Build: `https://abc123.ngrok-free.app`

#### Converting to WebSocket URL
```typescript
const wsUrl = baseUrl
  .replace('http://', 'ws://')
  .replace('https://', 'wss://')
const mediaStreamUrl = `${wsUrl}/api/media-stream`
```

**What's happening:**
- HTTP: `https://...`
- WebSocket Secure: `wss://...`
- WebSocket: `ws://...`
- Build WebSocket URL for Media Stream

#### Returning TwiML
```typescript
const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="${mediaStreamUrl}" track="inbound" />
  </Start>
  <Say>Please speak now...</Say>
</Response>`

return new NextResponse(twiml, {
  headers: { 'Content-Type': 'text/xml' }
})
```

**What's happening:**
- Generate XML instructions for Twilio
- Tell Twilio to start streaming
- Tell Twilio to play a message
- Return as XML response

---

### File 3: `src/lib/utils/audioConversion.ts` - Audio Format Converter

This converts Twilio's audio format to Azure's format.

#### Function 1: Base64 to PCM
```typescript
export function convertTwilioAudioToPcm(base64Mulaw: string): Buffer {
  const mulawBuffer = Buffer.from(base64Mulaw, 'base64')
  return convertMulawToPcm(mulawBuffer)
}
```

**What's happening:**
1. Input: `"SGVsbG8="` (base64 string)
2. Decode base64 → `Buffer([0x48, 0x65, 0x6C, 0x6C, 0x6F])`
3. Convert μ-law to PCM
4. Return PCM buffer

#### Function 2: μ-law to PCM
```typescript
export function convertMulawToPcm(mulawBuffer: Buffer): Buffer {
  const pcmBuffer = Buffer.allocUnsafe(mulawBuffer.length * 2)
  
  for (let i = 0; i < mulawBuffer.length; i++) {
    const pcmValue = mulaw.decodeSample(mulawBuffer[i])
    pcmBuffer.writeInt16LE(pcmValue, i * 2)
  }
  
  return pcmBuffer
}
```

**What's happening:**
1. Create PCM buffer (2x size - 8-bit → 16-bit)
2. For each μ-law byte:
   - Decode to PCM value (-32768 to 32767)
   - Write as 16-bit little-endian integer
3. Return PCM buffer

**Why `i * 2`?**
- Each PCM sample is 2 bytes (16-bit)
- If we're at position `i` in μ-law buffer
- We write at position `i * 2` in PCM buffer

**Example:**
```
μ-law: [0x7F, 0x80, 0x81]
         │     │     │
         ▼     ▼     ▼
PCM:   [0xFF,0xFF, 0x00,0x00, 0x01,0x00]
       └─┬─┘ └─┬─┘ └─┬─┘
        -1     0     1
```

---

### File 4: `src/lib/external/azureSpeech.ts` - Azure Speech Wrapper

This wraps the Azure Speech SDK to make it easier to use.

#### Constructor: Setup
```typescript
constructor(config: AzureSpeechRecognizerConfig) {
  // Get credentials from environment
  const subscriptionKey = process.env.AZURE_SPEECH_KEY
  const region = process.env.AZURE_SPEECH_REGION
  
  // Create speech config
  this.speechConfig = sdk.SpeechConfig.fromSubscription(key, region)
  this.speechConfig.speechRecognitionLanguage = 'en-US'
}
```

**What's happening:**
- Get Azure API key and region from environment variables
- Create configuration object
- Set language to English (US)

#### Creating Audio Stream
```typescript
const audioFormat = sdk.AudioStreamFormat.getWaveFormatPCM(8000, 16, 1)
this.pushStream = sdk.AudioInputStream.createPushStream(audioFormat)
this.audioConfig = sdk.AudioConfig.fromStreamInput(this.pushStream)
```

**What's happening:**
- `8000` = 8 kHz sample rate
- `16` = 16-bit samples
- `1` = mono (1 channel)
- Create a "push stream" - we push data into it
- Azure pulls data from it

**Push Stream Analogy:**
- Like a **water pipe**
- We push water (audio) into one end
- Azure pulls water from the other end
- Continuous flow

#### Pronunciation Assessment Config
```typescript
this.pronunciationConfig = new sdk.PronunciationAssessmentConfig(
  config.referenceText,  // "Hello how are you!"
  sdk.PronunciationAssessmentGradingSystem.HundredMark,  // 0-100 scale
  sdk.PronunciationAssessmentGranularity.Word,  // Word-level analysis
  true  // Enable miscue detection
)
this.pronunciationConfig.enableProsodyAssessment = true
```

**What's happening:**
- Set reference text (what they should say)
- Use 0-100 scoring
- Analyze at word level
- Detect errors (omissions, insertions, etc.)
- Enable prosody (stress, intonation)

#### Event Handlers
```typescript
this.recognizer.recognizing = (s, e) => {
  // Partial results (as they speak)
  console.log(`Recognizing: "${e.result.text}"`)
}

this.recognizer.recognized = (s, e) => {
  // Final results (complete sentence)
  const pronunciationResult = sdk.PronunciationAssessmentResult.fromResult(e.result)
  // Extract scores and call callback
  this.config.onResult(result, e.result.text)
}
```

**What's happening:**
- `recognizing`: Fires multiple times as speech is recognized (partial)
- `recognized`: Fires once per complete sentence (final)
- Extract pronunciation scores
- Call the callback function (which saves to file)

#### Writing Audio
```typescript
public writeAudioChunk(audioChunk: Buffer): void {
  const arrayBuffer = audioChunk.buffer.slice(
    audioChunk.byteOffset,
    audioChunk.byteOffset + audioChunk.byteLength
  ) as ArrayBuffer
  this.pushStream.write(arrayBuffer)
}
```

**What's happening:**
1. Receive PCM buffer (Node.js Buffer)
2. Convert to ArrayBuffer (what Azure SDK needs)
3. Write to push stream
4. Azure processes it

**Why convert Buffer to ArrayBuffer?**
- Node.js uses `Buffer` (extends Uint8Array)
- Azure SDK uses `ArrayBuffer`
- Need to extract the underlying ArrayBuffer

---

## How Everything Connects

### The Complete Flow with Code

#### 1. Call Comes In
```
Phone → Twilio → HTTP POST → /api/incoming-call
```

**Code:** `incoming-call/route.ts`
```typescript
export async function POST(request: NextRequest) {
  // Build WebSocket URL
  const mediaStreamUrl = "wss://abc123.ngrok-free.app/api/media-stream"
  
  // Return TwiML
  return `<Response><Start><Stream url="${mediaStreamUrl}" /></Start></Response>`
}
```

#### 2. Twilio Opens WebSocket
```
Twilio → WebSocket → wss://abc123.ngrok-free.app/api/media-stream
```

**Code:** `server.ts`
```typescript
server.on('upgrade', (request, socket, head) => {
  if (pathname === '/api/media-stream') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request)
    })
  }
})
```

#### 3. Connection Established
```
WebSocket connected
```

**Code:** `server.ts`
```typescript
wss.on('connection', (ws, req) => {
  ws.send(JSON.stringify({ event: 'connected' }))
  
  let recognizer = null
})
```

#### 4. Stream Starts
```
Twilio sends: {event: "start", streamSid: "MZ123..."}
```

**Code:** `server.ts`
```typescript
ws.on('message', (data) => {
  const message = JSON.parse(data.toString())
  
  if (message.event === 'start') {
    recognizer = new AzureSpeechRecognizer({
      referenceText: "Hello how are you!",
      onResult: (result, text) => {
        // Save to file
      }
    })
    recognizer.start()
  }
})
```

#### 5. Audio Chunks Arrive
```
Twilio sends: {event: "media", media: {payload: "base64..."}}
```

**Code:** `server.ts`
```typescript
else if (message.event === 'media') {
  // Convert audio
  const pcmBuffer = convertTwilioAudioToPcm(message.media.payload)
  
  // Send to Azure
  recognizer.writeAudioChunk(pcmBuffer)
}
```

**Code:** `audioConversion.ts`
```typescript
function convertTwilioAudioToPcm(base64Mulaw: string): Buffer {
  const mulawBuffer = Buffer.from(base64Mulaw, 'base64')
  return convertMulawToPcm(mulawBuffer)
}

function convertMulawToPcm(mulawBuffer: Buffer): Buffer {
  const pcmBuffer = Buffer.allocUnsafe(mulawBuffer.length * 2)
  for (let i = 0; i < mulawBuffer.length; i++) {
    const pcmValue = mulaw.decodeSample(mulawBuffer[i])
    pcmBuffer.writeInt16LE(pcmValue, i * 2)
  }
  return pcmBuffer
}
```

**Code:** `azureSpeech.ts`
```typescript
public writeAudioChunk(audioChunk: Buffer): void {
  const arrayBuffer = audioChunk.buffer.slice(...)
  this.pushStream.write(arrayBuffer)
}
```

#### 6. Azure Processes
```
Azure analyzes audio → Returns results
```

**Code:** `azureSpeech.ts`
```typescript
this.recognizer.recognized = (s, e) => {
  const pronunciationResult = sdk.PronunciationAssessmentResult.fromResult(e.result)
  
  const result = {
    accuracyScore: pronunciationResult.accuracyScore,
    // ... other scores
    words: [...]
  }
  
  this.config.onResult(result, e.result.text)
}
```

#### 7. Results Saved
```
Callback fires → Save to file
```

**Code:** `server.ts`
```typescript
onResult: async (result, text) => {
  const content = `Pronunciation Assessment Result\n...`
  await writeFile(`results/pronunciation_${Date.now()}.txt`, content)
}
```

---

## Key Concepts Summary

### WebSocket vs HTTP
- **HTTP**: Request → Response → Close (like letters)
- **WebSocket**: Open → Continuous messages → Close (like phone call)

### Why WebSocket for Audio
- Audio is continuous (stream)
- Needs real-time processing
- HTTP would be too slow/inefficient

### Audio Formats
- **μ-law**: Compressed, 8-bit, telephony format (Twilio)
- **PCM**: Uncompressed, 16-bit, raw audio (Azure)
- **Conversion**: Decode μ-law → PCM

### Architecture
- **Local server**: Runs on your computer
- **ngrok**: Tunnels public URL to localhost
- **Twilio**: Phone service, streams audio
- **Azure**: Speech recognition, pronunciation assessment

### Data Flow
```
Call → Twilio → Webhook (HTTP) → TwiML Response
     → WebSocket → Audio Stream → Convert Format
     → Azure → Analyze → Results → Save File
```

---

## Common Questions

### Q: Why do we need ngrok?
**A:** Your computer is behind a router/firewall. Twilio (on the internet) can't directly reach `localhost:3000`. ngrok creates a public URL that forwards to your local server.

### Q: Why convert audio formats?
**A:** Twilio uses μ-law (compressed, telephony format). Azure needs PCM (uncompressed, standard format). They're incompatible, so we convert.

### Q: What's the difference between HTTP and WebSocket?
**A:** HTTP is request-response (like asking questions). WebSocket is persistent connection (like a phone call that stays open).

### Q: Why handle WebSocket upgrades manually?
**A:** We need to intercept WebSocket upgrades before Next.js processes them. Otherwise, Next.js would try to handle them as HTTP requests and fail.

### Q: What is a push stream?
**A:** A stream where we "push" data into it (write), and Azure "pulls" data from it (reads). Like a pipe - we push water in, Azure pulls water out.

---

## Next Steps

Now that you understand how it works:
1. Try modifying the reference text
2. Add more logging to see what's happening
3. Experiment with different audio formats
4. Add error handling
5. Build a UI to display results

Happy coding! 🚀

