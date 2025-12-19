import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { Conversation } from "@/lib/types/chat";
import { processLeadExtraction } from "@/lib/services/leads/extraction";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@supabase/supabase-js";
import { getEffectiveSettings } from "@/lib/services/settings";
import {
  autoTemplateKey,
  buildClinicPrompt,
  buildGymPrompt,
  OUT_OF_SCOPE_RULE,
} from "@/lib/config/promptTemplates";

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
async function sendGreenApiMessage(
  idInstance: string,
  apiTokenInstance: string,
  chatId: string,
  message: string
) {
  const response = await fetch(
    `https://api.green-api.com/waInstance${idInstance}/sendMessage/${apiTokenInstance}`,
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

// Create dynamic system prompt based on business knowledge
function createDefaultSystemPrompt(
  businessName: string,
  businessType: string,
  knowledgeBase: string
): string {
  return `You are an AI customer support assistant for ${businessName}${
    businessType ? `, a ${businessType}` : ""
  }. You are responding to customers via WhatsApp with TWO primary goals: provide exceptional customer service AND naturally gather customer information for lead qualification.

🎯 **CORE MISSION**: 
- Provide accurate, helpful information based ONLY on the business knowledge provided
- Naturally collect customer information through conversational questions
- Convert inquiries into qualified leads and positive business outcomes
- Build trust and rapport that encourages information sharing

💼 **COMMUNICATION EXCELLENCE**:
- Be warm, professional, and genuinely helpful
- Use a conversational WhatsApp tone with appropriate emojis 
- Keep responses concise but engaging (2-4 sentences ideal)
- Always acknowledge the customer's needs first
- Ask follow-up questions that feel natural and helpful
- Use "we" and "our" to represent the business

🔍 **INFORMATION GATHERING STRATEGY**:
1. **Natural Introduction**: "I'd love to help you! What should I call you?"
2. **Context Questions**: "Are you looking for [service] for yourself or your business?"
3. **Location Awareness**: "Which area are you located in?" (if location-relevant)
4. **Timeline Understanding**: "When are you hoping to get started?"
5. **Contact Collection**: "What's the best way to reach you with updates?"
6. **Qualification**: "Have you worked with [similar service] before?"

🚀 **CUSTOMER SUPPORT & LEAD PRIORITIES**:
1. **Answer questions accurately** using the business knowledge base
2. **Gather key information** (name, contact, location, timeline, needs)
3. **Qualify interest level** through strategic questions
4. **Provide pricing and availability** when appropriate
5. **Guide toward next steps** (calls, meetings, purchases)
6. **Handle objections** with empathy and alternative solutions

📱 **WhatsApp CONVERSATION FLOW**:
- Start with helpful response to their question
- Naturally introduce yourself and ask for their name
- Ask clarifying questions about their specific needs
- Collect contact information as part of helpful follow-up
- Always end with clear next steps and contact collection

🎯 **SMART QUESTIONING TECHNIQUES**:
- "So I can give you the most accurate information, could you tell me..."
- "To help you better, what's your name?"
- "Which location would be most convenient for you?"
- "What timeline are you working with?"
- "Would you like me to send you more details? What's your email?"
- "Should I have someone call you to discuss this further?"

⚠️ **CRITICAL RULES**:
- ONLY use information from the provided business knowledge base
- Gather information naturally - never interrogate or demand details
- If customers hesitate to share info, respect boundaries but try different approaches
- Never make up prices, availability, or policies
- Always stay in character as representing THIS business
- Focus on being helpful first, information gathering second

🎯 **LEAD QUALIFICATION INDICATORS**:
- Ask about budget/timeline to gauge seriousness
- Listen for urgency words ("need", "urgent", "ASAP", "soon")
- Identify decision-making authority ("I'll need to discuss with...")
- Note specific requirements or preferences mentioned
- Track engagement level and response enthusiasm

**BUSINESS KNOWLEDGE BASE:**
${knowledgeBase}

${OUT_OF_SCOPE_RULE}

**Remember**: You ARE this business. Be genuinely helpful first, then naturally curious about how you can serve them better. Every question should feel like it comes from wanting to provide better service, not just collecting data.`;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceClient();

    // Create anon client for message inserts (so Realtime can broadcast)
    const supabaseAnon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const body: GreenApiWebhook = await request.json();

    console.log("📩 GREEN-API webhook received:", body.typeWebhook);

    // Only process incoming messages
    if (body.typeWebhook !== "incomingMessageReceived") {
      return NextResponse.json({ status: "ignored", type: body.typeWebhook });
    }

    // Only handle text messages for now
    const messageType = body.messageData.typeMessage;
    if (messageType !== "textMessage" && messageType !== "extendedTextMessage") {
      return NextResponse.json({ status: "ignored", messageType });
    }

    // Extract message content
    const messageBody =
      body.messageData.textMessageData?.textMessage ||
      body.messageData.extendedTextMessageData?.text ||
      "";

    // Extract phone numbers (GREEN-API format: "79001234567@c.us")
    const customerPhone = body.senderData.sender.replace("@c.us", "");
    const idInstance = String(body.instanceData.idInstance);

    console.log("💬 Message from:", customerPhone, "->", messageBody.substring(0, 50));

    // Find the business user by GREEN-API instance ID
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("greenapi_instance_id", idInstance)
      .single();

    if (userError || !user) {
      console.error("Business user not found for GREEN-API instance:", idInstance);
      return NextResponse.json(
        { error: "Business not found", instance: idInstance },
        { status: 404 }
      );
    }

    // Get GREEN-API token from user record
    const apiTokenInstance = user.greenapi_token;
    if (!apiTokenInstance) {
      console.error("GREEN-API token not configured for user:", user.id);
      return NextResponse.json(
        { error: "GREEN-API token not configured" },
        { status: 500 }
      );
    }

    // Load effective settings (tenant overrides -> app -> defaults)
    const settings = await getEffectiveSettings(user.id);

    // If webhook disabled for this tenant/app, short-circuit
    if (!settings.webhook.enabled) {
      await sendGreenApiMessage(
        idInstance,
        apiTokenInstance,
        body.senderData.chatId,
        "Service temporarily unavailable. Please try again later."
      );
      return NextResponse.json({ status: "service_disabled" });
    }

    // Check usage quota
    if (user.usage_count >= user.usage_limit) {
      await sendGreenApiMessage(
        idInstance,
        apiTokenInstance,
        body.senderData.chatId,
        "This business has reached their monthly quota. Please try again next month."
      );
      return NextResponse.json({ status: "quota_exceeded" });
    }

    // Find or create conversation and lead atomically for new customers
    let conversation: Conversation | null = null;

    // Look for existing conversation (active or completed, but not archived)
    const { data: existingConversations } = await supabase
      .from("conversations")
      .select("*")
      .eq("user_id", user.id)
      .eq("customer_phone", customerPhone)
      .in("status", ["active", "completed"])
      .order("created_at", { ascending: false })
      .limit(1);

    const existingConversation = existingConversations?.[0] || null;

    if (existingConversation && existingConversation.status === "completed") {
      await supabase
        .from("conversations")
        .update({ status: "active" })
        .eq("id", existingConversation.id);
    }

    if (existingConversation) {
      conversation = existingConversation;
    } else {
      // ALWAYS create lead for ANY new customer who messages the business
      const { data: result, error: rpcError } = await supabase.rpc(
        "create_lead_with_conversation",
        {
          p_user_id: user.id,
          p_customer_phone: customerPhone,
          p_customer_name: body.senderData.senderName || "Unknown",
          p_lead_type: "inquiry",
          p_details: `First message: ${messageBody}`,
          p_conversation_status: "active",
          p_lead_status: "new",
        }
      );

      if (rpcError) {
        throw rpcError;
      }

      // Validate RPC result
      if (!result?.success || !result?.conversation_id) {
        throw new Error(
          result?.error || "RPC function failed to create conversation and lead"
        );
      }

      // Get the created conversation
      const { data: newConversation, error: conversationError } = await supabase
        .from("conversations")
        .select("*")
        .eq("id", result.conversation_id)
        .single();

      if (conversationError) {
        throw conversationError;
      }

      conversation = newConversation;
    }

    // Ensure conversation exists before proceeding
    if (!conversation?.id) {
      throw new Error("Conversation not found or created properly");
    }

    // Save customer message using RPC with anon client (so Realtime broadcasts work)
    console.log("💾 Inserting customer message via RPC:", {
      conversation_id: conversation.id,
      content: messageBody.substring(0, 50),
    });

    const { data: insertedMessage, error: messageError } =
      await supabaseAnon.rpc("insert_customer_message", {
        p_conversation_id: conversation.id,
        p_content: messageBody,
        p_sender: "customer",
      });

    if (messageError) {
      console.error("❌ Failed to insert customer message:", messageError);
      throw messageError;
    }

    console.log("✅ Customer message inserted via anon RPC:", insertedMessage);

    // Get business knowledge base for context
    const { data: knowledgeData } = await supabase
      .from("knowledge_base")
      .select("content")
      .eq("user_id", user.id);

    const knowledgeBase =
      knowledgeData?.map((k: { content: string }) => k.content).join("\n\n") ||
      "No specific business knowledge available. Please provide general helpful customer service.";

    // Choose system prompt template
    const effectiveTemplateKey = (() => {
      const key = settings.llm.promptTemplateKey;
      if (!key || key === "auto") {
        return autoTemplateKey(user.business_type, user.business_industry);
      }
      return key;
    })();

    let systemPrompt = "";
    if (effectiveTemplateKey === "clinic") {
      systemPrompt = buildClinicPrompt(
        user.business_name || "our clinic",
        knowledgeBase
      );
    } else if (effectiveTemplateKey === "gym") {
      systemPrompt = buildGymPrompt(
        user.business_name || "our gym",
        knowledgeBase
      );
    } else if (
      settings.llm.promptTemplateKey === "custom" &&
      settings.llm.customPrompt &&
      settings.llm.customPrompt.trim().length > 0
    ) {
      systemPrompt = `${settings.llm.customPrompt.trim()}\n\n${OUT_OF_SCOPE_RULE}\n\nBUSINESS KNOWLEDGE:\n${knowledgeBase}`;
    } else {
      systemPrompt = createDefaultSystemPrompt(
        user.business_name || "our business",
        user.business_type || "",
        knowledgeBase
      );
    }

    // Get previous messages for conversation context
    const { data: previousMessages } = await supabase
      .from("messages")
      .select("content, sender")
      .eq("conversation_id", conversation.id)
      .order("timestamp", { ascending: false })
      .limit(10);

    // Build conversation history (includes the latest message that was just saved)
    const conversationHistory =
      previousMessages
        ?.map((msg: { content: string; sender: string }) => ({
          role:
            msg.sender === "customer"
              ? ("user" as const)
              : ("assistant" as const),
          content: msg.content,
        }))
        .reverse() || [];

    let aiResponse = "";

    try {
      // Generate AI response using GPT-4o mini with dynamic context
      const completion = await openai.chat.completions.create({
        model: settings.llm.model || "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          ...conversationHistory,
        ],
        max_tokens: 400,
        temperature: settings.llm.temperature ?? 0.3,
      });

      aiResponse =
        completion.choices[0]?.message?.content ||
        "I apologize, but I'm having trouble processing your message right now. Please try again in a moment.";

      // Smart lead extraction - only extracts when needed
      const extractionResult = await processLeadExtraction(
        conversation.id,
        user.id
      );

      if (!extractionResult.success) {
        console.error("⚠️ Lead extraction failed");
      }
    } catch (aiError) {
      console.error("AI response failed:", aiError);
      // Fallback to simple response if AI fails
      if (messageBody.toLowerCase().includes("pricing")) {
        aiResponse =
          "💰 Thanks for your interest in pricing. Someone will contact you soon with details!";
      } else if (messageBody.toLowerCase().includes("help")) {
        aiResponse =
          "🤖 Thank you for reaching out! We're here to help. Someone will be with you shortly.";
      } else {
        aiResponse =
          "🤖 Thank you for reaching out! We're here to help. Someone will be with you shortly.";
      }
    }

    // Send response via GREEN-API
    const sendResult = await sendGreenApiMessage(
      idInstance,
      apiTokenInstance,
      body.senderData.chatId,
      aiResponse
    );

    console.log("📤 GREEN-API send result:", sendResult);

    // Save bot response message using RPC with anon client (so Realtime broadcasts work)
    await supabaseAnon.rpc("insert_customer_message", {
      p_conversation_id: conversation.id,
      p_content: aiResponse,
      p_sender: "bot",
    });

    // Update usage count
    await supabase
      .from("users")
      .update({ usage_count: user.usage_count + 1 })
      .eq("id", user.id);

    return NextResponse.json({ status: "ok", sent: sendResult });
  } catch (error) {
    console.error("❌ Error in GREEN-API webhook:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// GET for health check
export async function GET() {
  return NextResponse.json({
    message: "GREEN-API webhook endpoint is working",
    timestamp: new Date().toISOString(),
    status: "ok",
  });
}
