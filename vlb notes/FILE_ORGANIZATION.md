# File Organization Guide

## `src/lib/external/twilio.ts` - External API Module

**Rule: ONE file per external service**

**What belongs here:**
- ✅ All Twilio API calls (calls, messages, webhooks, etc.)
- ✅ Twilio client initialization
- ✅ Twilio-specific types/interfaces
- ✅ Twilio error handling
- ✅ Any Twilio SDK usage

**What does NOT belong here:**
- ❌ Database operations
- ❌ Business logic
- ❌ Other external services (Stripe, OpenAI, etc.)

**Examples of what else goes in `twilio.ts`:**

```ts
// ✅ All Twilio operations belong here:

// 1. Make phone calls
export async function makeCall(params) { ... }

// 2. Send SMS messages
export async function sendSMS(params) { ... }

// 3. Get call status
export async function getCallStatus(callSid) { ... }

// 4. List calls
export async function listCalls(filters) { ... }

// 5. Handle webhooks
export async function validateWebhook(signature, url, params) { ... }

// 6. Create phone numbers
export async function purchasePhoneNumber(areaCode) { ... }

// 7. Update call (redirect, hangup, etc.)
export async function updateCall(callSid, action) { ... }
```

**Key Point:** If it uses the Twilio SDK/client, it goes in `twilio.ts`

---

## `src/lib/services/callService.ts` - Service Layer

**Rule: ONE file per domain/feature**

**What belongs here:**
- ✅ Business logic for calls
- ✅ Orchestrating multiple operations (Twilio + DB + other services)
- ✅ Data transformation (convert Twilio response to your domain model)
- ✅ Validation beyond basic input checks
- ✅ Complex workflows

**What does NOT belong here:**
- ❌ Direct Twilio SDK calls (use external module)
- ❌ Direct database queries (use db module)
- ❌ HTTP handling (that's API routes)

**Examples of what else goes in `callService.ts`:**

```ts
// ✅ Business logic and orchestration:

// 1. Create call (orchestrates Twilio + DB)
export async function createCall(params) {
  // Call Twilio
  // Save to DB
  // Send notification
  // Return combined result
}

// 2. Retry failed calls
export async function retryCall(callId) {
  // Get original call from DB
  // Check retry count
  // Call Twilio again
  // Update DB
}

// 3. Cancel call
export async function cancelCall(callId) {
  // Get call from DB
  // Update Twilio
  // Update DB status
  // Refund if needed
}

// 4. Get call history for user
export async function getCallHistory(userId) {
  // Get from DB
  // Enrich with Twilio data
  // Format for frontend
}

// 5. Schedule call
export async function scheduleCall(params) {
  // Validate schedule time
  // Save to DB
  // Set up cron job
  // Return scheduled call ID
}
```

**Key Point:** If it involves business logic or orchestrates multiple layers, it goes in `callService.ts`

---

## When to Create New Files

### External APIs (`lib/external/`)
- **One file per external service:**
  - `twilio.ts` - All Twilio operations
  - `stripe.ts` - All Stripe operations  
  - `openai.ts` - All OpenAI operations
  - `sendgrid.ts` - All email operations

### Services (`lib/services/`)
- **One file per domain/feature:**
  - `callService.ts` - Call-related business logic
  - `userService.ts` - User-related business logic
  - `paymentService.ts` - Payment-related business logic
  - `notificationService.ts` - Notification logic

### Database (`lib/db/`)
- **One file per entity/table:**
  - `calls.ts` - Call database operations
  - `users.ts` - User database operations
  - `payments.ts` - Payment database operations

---

## Example: Adding SMS Feature

**Where does SMS code go?**

1. **Twilio SMS function** → `lib/external/twilio.ts`
   ```ts
   export async function sendSMS(params) {
     const client = getTwilioClient()
     return await client.messages.create({ ... })
   }
   ```

2. **SMS service logic** → `lib/services/smsService.ts` (NEW FILE)
   ```ts
   import { sendSMS } from '../external/twilio'
   import { saveSMS } from '../db/messages'
   
   export async function createSMS(params) {
     // Call Twilio
     const result = await sendSMS(params)
     // Save to DB
     await saveSMS(result)
     // Return combined result
   }
   ```

3. **SMS API route** → `app/api/sms/route.ts` (NEW FILE)
   ```ts
   import { createSMS } from '@/lib/services/smsService'
   
   export async function POST(request) {
     const body = await request.json()
     const result = await createSMS(body)
     return NextResponse.json(result)
   }
   ```

**Why separate `smsService.ts`?**
- Different domain (SMS vs Calls)
- Different business rules
- Easier to maintain

---

## Quick Decision Tree

**"Where does this code go?"**

1. **Does it call an external API directly?**
   - Yes → `lib/external/[service].ts`

2. **Does it query your database directly?**
   - Yes → `lib/db/[entity].ts`

3. **Does it combine external APIs + DB + business logic?**
   - Yes → `lib/services/[feature]Service.ts`

4. **Does it handle HTTP requests/responses?**
   - Yes → `app/api/[endpoint]/route.ts`

5. **Is it a React component?**
   - Yes → `app/[page].tsx` or `components/[name].tsx`

---

## File Size Guidelines

**When to split a file:**

- ✅ File > 300-400 lines → Consider splitting
- ✅ File has multiple unrelated concerns → Split by concern
- ✅ File is hard to navigate → Split by feature

**When to keep together:**

- ✅ Related functions that share types/interfaces
- ✅ Small, cohesive set of operations
- ✅ Functions are tightly coupled

---

## Real Example: Your Current Structure

```
src/lib/
├── external/
│   └── twilio.ts          ← All Twilio API calls
│       ├── makeCall()
│       ├── sendSMS()
│       ├── getCallStatus()
│       └── listCalls()
│
├── services/
│   └── callService.ts     ← Call business logic
│       ├── createCall()   ← Orchestrates Twilio + DB
│       ├── retryCall()    ← Business logic
│       └── cancelCall()   ← Business logic
│
└── db/
    └── calls.ts           ← Call database operations
        ├── saveCall()
        ├── getCall()
        └── updateCall()
```

**Each file has a single, clear responsibility!**


