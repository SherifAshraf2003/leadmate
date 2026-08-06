import OpenAI from "openai";
import { createServiceClient } from "@/lib/supabase/service";
import { shouldExtractByTime, getConversationTimestamps } from "./triggers";
import "dotenv/config";

// Use OpenAI directly for GPT-4o mini with function calling

const extractionClient = new OpenAI({
  apiKey: process.env.OPENAI_KEY as string,
});

export interface ExtractedUserInfo {
  name?: string;
  phone?: string;
  email?: string;
  location?: string;
  company?: string;
  intent?: "inquiry" | "booking" | "order" | "support";
  urgency?: "low" | "medium" | "high";
  budget?: string;
  preferences?: string[];
  followUpNeeded?: boolean;
  confidence?: number;
}

export interface LeadExtractionResult {
  userInfo: ExtractedUserInfo;
  shouldUpdateLead: boolean;
  suggestedQuestions: string[];
  leadScore: number;
  error?: any;
}

/**
 * Function calling schema for GPT-4o mini lead extraction with strict mode
 */
const leadExtractionTool = {
  type: "function" as const,
  function: {
    name: "extract_lead_information",
    description:
      "Extract customer information and lead data from WhatsApp conversation",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        userInfo: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: {
              type: "string",
              description: "Customer's full name, first name, or business name",
            },
            phone: {
              type: "string",
              description: "Phone number in any format",
            },
            email: {
              type: "string",
              description: "Email address",
            },
            location: {
              type: "string",
              description: "Location, city, area, or address",
            },
            company: {
              type: "string",
              description: "Company or business name",
            },
            intent: {
              type: "string",
              enum: ["inquiry", "booking", "order", "support"],
              description: "Customer intent type",
            },
            urgency: {
              type: "string",
              enum: ["low", "medium", "high"],
              description: "Urgency level based on customer language",
            },
            budget: {
              type: "string",
              description: "Budget information or price discussions",
            },
            preferences: {
              type: "array",
              items: { type: "string" },
              description: "Customer preferences or specific requirements",
            },
            followUpNeeded: {
              type: "boolean",
              description:
                "Whether follow-up is needed for missing information",
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 100,
              description: "Confidence score for extracted information quality",
            },
          },
          required: [
            "name",
            "phone",
            "email",
            "location",
            "company",
            "intent",
            "urgency",
            "budget",
            "preferences",
            "followUpNeeded",
            "confidence",
          ],
        },
        shouldUpdateLead: {
          type: "boolean",
          description: "Whether this lead should be updated in the database",
        },
        leadScore: {
          type: "number",
          minimum: 0,
          maximum: 100,
          description:
            "Lead quality score (0-100) based on available information",
        },
      },
      required: ["userInfo", "shouldUpdateLead", "leadScore"],
    },
  },
};

/**
 * Enhanced system prompt for GPT-4o mini function calling
 */
function createExtractionPrompt(): string {
  return `You are an expert information extraction AI. Your task is to analyze WhatsApp conversations between a CUSTOMER and our BUSINESS AI CHATBOT, then extract customer information using the extract_lead_information function.

CONVERSATION CONTEXT:
- "customer": Messages from the potential lead/client
- "bot": Messages from our business AI assistant responding to customer inquiries
- Focus on extracting information about the CUSTOMER only (not the bot responses)

EXTRACTION RULES:
1. Analyze the ENTIRE conversation history, not just the latest message
2. Extract ALL available information about the CUSTOMER from their messages
3. Identify customer intent and urgency level based on their inquiries
5. Score the lead quality (0-100) based on customer engagement and information provided

INFORMATION TO EXTRACT:
- Name (first name, last name, or business name)
- Phone numbers (any format)
- Email addresses  
- Location (city, area, address)
- Company/business name
- Intent type (inquiry/booking/order/support)
- Urgency level (low/medium/high)
- Budget mentions or price discussions
- Specific preferences or requirements
- Timeline mentions

INTENT DETECTION:
- "inquiry": General questions, information seeking
- "booking": Appointments, reservations, scheduling
- "order": Product purchases, service orders
- "support": Problems, complaints, technical help

URGENCY INDICATORS:
- High: "urgent", "ASAP", "today", "emergency", "immediately" 
- Medium: "soon", "this week", "by Friday", timeline mentioned
- Low: "eventually", "when possible", no timeline

LEAD SCORING (0-100):
- +20 for having name
- +20 for having phone/email
- +15 for clear intent
- +15 for urgency indicators
- +10 for location if relevant
- +10 for budget mentions
- +10 for specific requirements

CONFIDENCE SCORING:
- Set confidence based on quality and completeness of extracted data
- Higher confidence for verified contact information
- Lower confidence for uncertain or incomplete data

Use the extract_lead_information function to provide structured results.`;
}

/**
 * Validates phone numbers using multiple patterns
 */
function validatePhone(phone: string): boolean {
  if (!phone) return false;

  const patterns = [
    /^\+[1-9]\d{1,14}$/, // International format
    /^\d{10,15}$/, // Basic digits
    /^\(\d{3}\)\s?\d{3}-\d{4}$/, // US format with parentheses
    /^\d{3}-\d{3}-\d{4}$/, // US format with dashes
    /^\d{3}\s\d{3}\s\d{4}$/, // US format with spaces
  ];

  return patterns.some((pattern) => pattern.test(phone.replace(/\s+/g, "")));
}

/**
 * Validates email addresses
 */
function validateEmail(email: string): boolean {
  if (!email) return false;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Enhanced lead extraction using conversation analysis
 */
export async function extractLeadInformation(
  conversationId: string
): Promise<LeadExtractionResult> {
  try {
    const supabase = createServiceClient();

    // Get all messages from conversation for full context analysis
    const { data: messages } = await supabase
      .from("messages")
      .select("content, sender, timestamp")
      .eq("conversation_id", conversationId)
      .order("timestamp", { ascending: true });

    if (!messages || messages.length === 0) {
      return {
        userInfo: { confidence: 0 },
        shouldUpdateLead: false,
        suggestedQuestions: [],
        leadScore: 0,
        error: "No messages found",
      };
    }

    // Build conversation context
    const conversationText = messages
      .map(
        (msg: { sender: string; content: string }) =>
          `${msg.sender}: ${msg.content}`
      )
      .join("\n");

    const extractionPrompt = createExtractionPrompt();

    // Call GPT-4o mini with function calling for information extraction
    const completion = await extractionClient.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: extractionPrompt,
        },
        {
          role: "user",
          content: `Analyze this WhatsApp conversation and extract customer information:\n\n${conversationText}`,
        },
      ],
      tools: [leadExtractionTool],
      tool_choice: {
        type: "function",
        function: { name: "extract_lead_information" },
      },
      max_tokens: 1000,
      temperature: 0.1, // Low temperature for consistent extraction
    });

    // Extract the function call result
    const toolCall = completion.choices[0]?.message?.tool_calls?.[0];

    // openai v7 types tool_calls as a union of function and custom calls, so
    // the type check is required to reach `.function`.
    if (
      !toolCall ||
      toolCall.type !== "function" ||
      toolCall.function.name !== "extract_lead_information"
    ) {
      throw new Error("No valid function call response from extraction AI");
    }

    // Parse the structured function call arguments
    let extractionResult: LeadExtractionResult;
    try {
      extractionResult = JSON.parse(toolCall.function.arguments);
    } catch (parseError) {
      console.error("Failed to parse function call arguments:", parseError);
      return {
        userInfo: { confidence: 0 },
        shouldUpdateLead: false,
        suggestedQuestions: [],
        leadScore: 0,
        error: parseError,
      };
    }

    // Validate and clean extracted data
    if (
      extractionResult.userInfo.phone &&
      !validatePhone(extractionResult.userInfo.phone)
    ) {
      console.log(
        `Invalid phone number detected: ${extractionResult.userInfo.phone}`
      );
      extractionResult.userInfo.phone = undefined;
      extractionResult.leadScore = Math.max(0, extractionResult.leadScore - 20);
    }

    if (
      extractionResult.userInfo.email &&
      !validateEmail(extractionResult.userInfo.email)
    ) {
      console.log(`Invalid email detected: ${extractionResult.userInfo.email}`);
      extractionResult.userInfo.email = undefined;
      extractionResult.leadScore = Math.max(0, extractionResult.leadScore - 20);
    }

    // Ensure required fields have valid values
    if (!extractionResult.userInfo.confidence) {
      extractionResult.userInfo.confidence = 0;
    }

    if (!extractionResult.leadScore) {
      extractionResult.leadScore = 0;
    }

    if (!extractionResult.suggestedQuestions) {
      extractionResult.suggestedQuestions = [];
    }

    // Set confidence based on extracted data quality
    const hasName = !!extractionResult.userInfo.name;
    const hasContact = !!(
      extractionResult.userInfo.phone || extractionResult.userInfo.email
    );
    const hasIntent = !!extractionResult.userInfo.intent;

    extractionResult.userInfo.confidence =
      (hasName ? 30 : 0) + (hasContact ? 40 : 0) + (hasIntent ? 30 : 0);

    // Determine if lead should be updated
    extractionResult.shouldUpdateLead =
      extractionResult.userInfo.confidence >= 30 ||
      extractionResult.leadScore >= 40;

    return extractionResult;
  } catch (error) {
    console.error("Error in lead extraction:", error);
    return {
      userInfo: { confidence: 0 },
      shouldUpdateLead: false,
      suggestedQuestions: [],
      leadScore: 0,
      error: error,
    };
  }
}

/**
 * Updates lead in database with extracted information
 */
export async function updateLeadWithExtractedInfo(
  conversationId: string,
  userInfo: ExtractedUserInfo
): Promise<boolean> {
  try {
    const supabase = createServiceClient();

    // Find existing lead for this conversation
    const { data: existingLead } = await supabase
      .from("leads")
      .select("*")
      .eq("conversation_id", conversationId)
      .single();

    if (!existingLead) {
      console.log("No existing lead found for conversation:", conversationId);
      return false;
    }

    // Prepare update data
    const updateData: {
      customer_name?: string;
      type?: string;
      details?: string;
      status?: string;
    } = {};

    if (userInfo.name && userInfo.name !== "Unknown") {
      updateData.customer_name = userInfo.name;
    }

    if (
      userInfo.intent &&
      ["order", "booking", "inquiry"].includes(userInfo.intent)
    ) {
      updateData.type = userInfo.intent;
    }

    // Build enhanced details
    const detailsParts = [];
    if (userInfo.email) detailsParts.push(`Email: ${userInfo.email}`);
    if (userInfo.location) detailsParts.push(`Location: ${userInfo.location}`);
    if (userInfo.company) detailsParts.push(`Company: ${userInfo.company}`);
    if (userInfo.budget) detailsParts.push(`Budget: ${userInfo.budget}`);
    if (userInfo.preferences?.length)
      detailsParts.push(`Preferences: ${userInfo.preferences.join(", ")}`);
    if (userInfo.urgency) detailsParts.push(`Urgency: ${userInfo.urgency}`);

    if (detailsParts.length > 0) {
      updateData.details = detailsParts.join("\n");
    }

    // Update status if we have good information
    if (userInfo.confidence && userInfo.confidence >= 60) {
      updateData.status = "contacted";
    }

    // Only update if we have something meaningful to update
    if (Object.keys(updateData).length === 0) {
      return false;
    }

    const { error } = await supabase
      .from("leads")
      .update(updateData)
      .eq("conversation_id", conversationId);

    if (error) {
      console.error("Error updating lead:", error);
      return false;
    }

    console.log(
      `✅ Lead updated for conversation ${conversationId}:`,
      updateData
    );
    return true;
  } catch (error) {
    console.error("Error in updateLeadWithExtractedInfo:", error);
    return false;
  }
}

/**
 * Time-based lead extraction - only processes when timing conditions are met
 */
export async function processLeadExtraction(
  conversationId: string,
  userId: string,
  forceExtraction: boolean = false
): Promise<{
  success: boolean;
  extractionResult?: LeadExtractionResult;
  suggestedQuestions?: string[];
  skipped?: boolean;
  skipReason?: string;
  error?: any;
}> {
  try {
    const supabase = createServiceClient();

    // Get conversation and its status
    const { data: conversation } = await supabase
      .from("conversations")
      .select("status, updated_at, created_at")
      .eq("id", conversationId)
      .single();

    if (!conversation) {
      return {
        success: false,
        skipped: true,
        skipReason: "Conversation not found",
      };
    }

    // Check if extraction already completed (status is "completed")
    const extractionCompleted = conversation.status === "completed";

    if (!forceExtraction && extractionCompleted) {
      return {
        success: true,
        skipped: true,
        skipReason: "Extraction already completed for this conversation",
      };
    }

    // Get conversation messages for timestamp analysis
    const { data: messages } = await supabase
      .from("messages")
      .select("content, sender, timestamp")
      .eq("conversation_id", conversationId)
      .order("timestamp", { ascending: true });

    if (!messages || messages.length === 0) {
      return {
        success: false,
        skipped: true,
        skipReason: "No messages found",
      };
    }

    if (!forceExtraction) {
      // Time-based extraction logic
      const timestamps = getConversationTimestamps(messages);
      const timeTrigger = shouldExtractByTime(
        timestamps.lastMessageTime,
        timestamps.firstMessageTime,
        extractionCompleted
      );

      if (!timeTrigger.shouldExtract) {
        return {
          success: true,
          skipped: true,
          skipReason: timeTrigger.reason,
        };
      }

      console.log(`🎯 Time-based extraction triggered: ${timeTrigger.reason}`);
    }

    // Extract information from conversation
    const extractionResult = await extractLeadInformation(conversationId);

    if (extractionResult.error) {
      return {
        success: false,
        error: extractionResult.error,
      };
    }

    // Mark extraction as completed
    await supabase
      .from("conversations")
      .update({
        status: "completed",
      })
      .eq("id", conversationId);

    // Update lead if extraction was successful and confident enough
    if (extractionResult.shouldUpdateLead) {
      const updateSuccess = await updateLeadWithExtractedInfo(
        conversationId,
        extractionResult.userInfo
      );

      if (!updateSuccess) {
        console.log("Lead extraction successful but database update failed");
      }
    }

    return {
      success: true,
      extractionResult,
      suggestedQuestions: extractionResult.suggestedQuestions,
    };
  } catch (error) {
    console.error("Error in processLeadExtraction:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
