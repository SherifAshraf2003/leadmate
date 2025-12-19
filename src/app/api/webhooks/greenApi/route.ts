import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_KEY as string,
});

// GREEN-API webhook types
interface GreenApiWebhook {
  typeWebhook: string;
  instanceData: {
    idInstance: number;
    wid: string;
    typeInstance: string;
  };
  timestamp: number;
  idMessage: string;
  senderData: {
    chatId: string;
    chatName?: string;
    sender: string;
    senderName?: string;
  };
  messageData: {
    typeMessage: string;
    textMessageData?: {
      textMessage: string;
    };
    extendedTextMessageData?: {
      text: string;
    };
  };
}

// Helper to send message via GREEN-API
async function sendGreenApiMessage(chatId: string, message: string) {
  const idInstance = process.env.GREENAPI_INSTANCE_ID;
  const apiToken = process.env.GREENAPI_TOKEN;

  const response = await fetch(
    `https://api.green-api.com/waInstance${idInstance}/sendMessage/${apiToken}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId: chatId,
        message: message,
      }),
    }
  );
  return response.json();
}

export async function POST(request: NextRequest) {
  try {
    const body: GreenApiWebhook = await request.json();

    console.log("📩 Received webhook:", body.typeWebhook);

    // Only process incoming messages
    if (body.typeWebhook !== "incomingMessageReceived") {
      return NextResponse.json({ status: "ignored", type: body.typeWebhook });
    }

    // Only handle text messages
    const messageType = body.messageData.typeMessage;
    if (messageType !== "textMessage" && messageType !== "extendedTextMessage") {
      return NextResponse.json({ status: "ignored", messageType });
    }

    // Extract message content
    const messageBody =
      body.messageData.textMessageData?.textMessage ||
      body.messageData.extendedTextMessageData?.text ||
      "";

    console.log("💬 Message from:", body.senderData.chatId, "->", messageBody);

    // Generate AI response
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant responding via WhatsApp. Keep responses concise.",
        },
        {
          role: "user",
          content: messageBody,
        },
      ],
      max_tokens: 300,
    });

    const aiResponse =
      completion.choices[0]?.message?.content ||
      "Sorry, I couldn't process that. Please try again.";

    console.log("🤖 AI Response:", aiResponse);

    // Send response back via GREEN-API
    const sendResult = await sendGreenApiMessage(body.senderData.chatId, aiResponse);
    console.log("📤 Send result:", sendResult);

    return NextResponse.json({ status: "ok", sent: sendResult });
  } catch (error) {
    console.error("❌ Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET for health check
export async function GET() {
  return NextResponse.json({
    message: "GREEN-API webhook is working",
    timestamp: new Date().toISOString(),
  });
}
