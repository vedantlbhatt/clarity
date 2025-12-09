# Clarity

AI-powered phone agent with real-time feedback built with Next.js and Twilio.

## Prerequisites

- Node.js 18+ and npm
- Twilio account with Account SID and Auth Token

## Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd clarity
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Create a `.env.local` file in the root directory:
   ```bash
   TWILIO_ACCOUNT_SID=your_account_sid_here
   TWILIO_AUTH_TOKEN=your_auth_token_here
   ```
   
   You can get these credentials from your [Twilio Console](https://console.twilio.com/).

4. **Run the development server**
   ```bash
   npm run dev
   ```

5. **Open your browser**
   
   Navigate to [http://localhost:3000](http://localhost:3000)

## Usage

Click the "Make Call" button on the landing page to initiate a phone call using Twilio.

## Project Structure

- `app/` - Next.js app directory with pages and API routes
- `app/api/call/` - API endpoint for making Twilio calls
- `make_call.py` - Python script for making calls (alternative implementation)

## Environment Variables

The following environment variables are required:

- `TWILIO_ACCOUNT_SID` - Your Twilio Account SID
- `TWILIO_AUTH_TOKEN` - Your Twilio Auth Token

**Note:** Never commit `.env.local` or `twilio.env` files to the repository. They are already in `.gitignore`.