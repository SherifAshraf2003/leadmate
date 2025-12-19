import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";

const GREENAPI_PARTNER_TOKEN = process.env.GREENAPI_PARTNER_TOKEN;
const WEBHOOK_BASE_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL;

interface CreateInstanceResponse {
  idInstance: number;
  apiTokenInstance: string;
}

// POST - Connect user's own GREEN-API instance (or create via partner API if available)
export async function POST(request: NextRequest) {
  try {
    // Get user from auth (uses cookies)
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { instanceId, apiToken } = body;

    const supabaseService = createServiceClient();

    // MODE 1: User provides their own credentials (BYOI - Bring Your Own Instance)
    if (instanceId && apiToken) {
      // Validate the credentials by checking instance state
      const validateResponse = await fetch(
        `https://api.green-api.com/waInstance${instanceId}/getStateInstance/${apiToken}`
      );

      if (!validateResponse.ok) {
        return NextResponse.json(
          { error: "Invalid GREEN-API credentials. Please check your Instance ID and API Token." },
          { status: 400 }
        );
      }

      // Configure webhook URL on their instance
      const webhookUrl = `${WEBHOOK_BASE_URL}/api/webhooks/greenApi`;
      
      const settingsResponse = await fetch(
        `https://api.green-api.com/waInstance${instanceId}/setSettings/${apiToken}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            webhookUrl: webhookUrl,
            outgoingWebhook: "yes",
            stateWebhook: "yes",
            incomingWebhook: "yes",
          }),
        }
      );

      if (!settingsResponse.ok) {
        console.error("Failed to configure webhook:", await settingsResponse.text());
        // Continue anyway - user can configure manually
      }

      // Save credentials to user record
      const { error: updateError } = await supabaseService
        .from("users")
        .update({
          greenapi_instance_id: String(instanceId),
          greenapi_token: apiToken,
        })
        .eq("id", user.id);

      if (updateError) {
        return NextResponse.json(
          { error: "Failed to save credentials" },
          { status: 500 }
        );
      }

      // Get instance state
      const stateData = await validateResponse.json();

      return NextResponse.json({
        success: true,
        instanceId: instanceId,
        status: stateData.stateInstance,
        message: stateData.stateInstance === "authorized" 
          ? "WhatsApp is connected and ready!"
          : "Instance connected. Please authorize WhatsApp by scanning the QR code.",
        webhookConfigured: settingsResponse.ok,
      });
    }

    // MODE 2: Create instance via Partner API (if partner token available)
    if (GREENAPI_PARTNER_TOKEN) {
      // Check if user already has an instance
      const { data: existingUser } = await supabaseService
        .from("users")
        .select("greenapi_instance_id")
        .eq("id", user.id)
        .single();

      if (existingUser?.greenapi_instance_id) {
        return NextResponse.json(
          { error: "You already have a GREEN-API instance connected", instanceId: existingUser.greenapi_instance_id },
          { status: 400 }
        );
      }

      const webhookUrl = `${WEBHOOK_BASE_URL}/api/webhooks/greenApi`;
      
      const response = await fetch(
        `https://api.green-api.com/partner/createInstance/${GREENAPI_PARTNER_TOKEN}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            webhookUrl: webhookUrl,
            delaySendMessagesMilliseconds: 3000,
            outgoingWebhook: "yes",
            stateWebhook: "yes",
            incomingWebhook: "yes",
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        console.error("GREEN-API create instance error:", errorData);
        return NextResponse.json(
          { error: "Failed to create instance", details: errorData },
          { status: response.status }
        );
      }

      const instanceData: CreateInstanceResponse = await response.json();

      // Save credentials
      await supabaseService
        .from("users")
        .update({
          greenapi_instance_id: String(instanceData.idInstance),
          greenapi_token: instanceData.apiTokenInstance,
        })
        .eq("id", user.id);

      return NextResponse.json({
        success: true,
        instanceId: instanceData.idInstance,
        status: "notAuthorized",
        message: "Instance created! Scan the QR code to connect WhatsApp.",
      });
    }

    // No credentials provided and no partner token
    return NextResponse.json(
      { 
        error: "Please provide your GREEN-API credentials",
        instructions: {
          step1: "Create a free account at https://console.green-api.com",
          step2: "Copy your Instance ID and API Token from the dashboard",
          step3: "Enter them here to connect",
        }
      },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error connecting GREEN-API instance:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE - Disconnect user's GREEN-API instance
export async function DELETE(request: NextRequest) {
  try {
    // Get user from auth (uses cookies)
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabaseService = createServiceClient();

    // Get user's instance info
    const { data: userData } = await supabaseService
      .from("users")
      .select("greenapi_instance_id, greenapi_token")
      .eq("id", user.id)
      .single();

    if (!userData?.greenapi_instance_id) {
      return NextResponse.json(
        { error: "No GREEN-API instance connected" },
        { status: 404 }
      );
    }

    // If we have partner token, try to delete the instance
    if (GREENAPI_PARTNER_TOKEN) {
      try {
        await fetch(
          `https://api.green-api.com/partner/deleteInstanceAccount/${GREENAPI_PARTNER_TOKEN}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              idInstance: parseInt(userData.greenapi_instance_id),
            }),
          }
        );
      } catch (e) {
        // Ignore partner deletion errors for BYOI instances
      }
    }

    // Clear the webhook on their instance (so they can use it elsewhere)
    if (userData.greenapi_token) {
      try {
        await fetch(
          `https://api.green-api.com/waInstance${userData.greenapi_instance_id}/setSettings/${userData.greenapi_token}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ webhookUrl: "" }),
          }
        );
      } catch (e) {
        // Ignore errors
      }
    }

    // Clear credentials from user record
    await supabaseService
      .from("users")
      .update({
        greenapi_instance_id: null,
        greenapi_token: null,
      })
      .eq("id", user.id);

    return NextResponse.json({
      success: true,
      message: "GREEN-API instance disconnected",
    });
  } catch (error) {
    console.error("Error disconnecting GREEN-API instance:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// GET - Get user's GREEN-API instance status
export async function GET(request: NextRequest) {
  try {
    // Get user from auth (uses cookies)
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabaseService = createServiceClient();
    const { data: userData } = await supabaseService
      .from("users")
      .select("greenapi_instance_id, greenapi_token")
      .eq("id", user.id)
      .single();

    if (!userData?.greenapi_instance_id || !userData?.greenapi_token) {
      return NextResponse.json({
        connected: false,
        status: "not_connected",
        partnerMode: !!GREENAPI_PARTNER_TOKEN,
      });
    }

    // Get instance state from GREEN-API
    try {
      const stateResponse = await fetch(
        `https://api.green-api.com/waInstance${userData.greenapi_instance_id}/getStateInstance/${userData.greenapi_token}`
      );

      if (!stateResponse.ok) {
        return NextResponse.json({
          connected: true,
          instanceId: userData.greenapi_instance_id,
          status: "error",
          error: "Failed to get instance state - credentials may be invalid",
        });
      }

      const stateData = await stateResponse.json();

      return NextResponse.json({
        connected: true,
        instanceId: userData.greenapi_instance_id,
        status: stateData.stateInstance, // "notAuthorized", "authorized", "blocked", "sleepMode"
        partnerMode: !!GREENAPI_PARTNER_TOKEN,
      });
    } catch (e) {
      return NextResponse.json({
        connected: true,
        instanceId: userData.greenapi_instance_id,
        status: "error",
        error: "Could not reach GREEN-API",
      });
    }
  } catch (error) {
    console.error("Error getting GREEN-API instance status:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
