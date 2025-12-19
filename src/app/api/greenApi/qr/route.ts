import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";

// GET - Get QR code for WhatsApp authorization
export async function GET(request: NextRequest) {
  try {
    // Get user from auth (uses cookies)
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user's GREEN-API credentials
    const supabaseService = createServiceClient();
    const { data: userData } = await supabaseService
      .from("users")
      .select("greenapi_instance_id, greenapi_token")
      .eq("id", user.id)
      .single();

    if (!userData?.greenapi_instance_id || !userData?.greenapi_token) {
      return NextResponse.json(
        { error: "No GREEN-API instance found. Create one first." },
        { status: 404 }
      );
    }

    // Get QR code from GREEN-API
    const qrResponse = await fetch(
      `https://api.green-api.com/waInstance${userData.greenapi_instance_id}/qr/${userData.greenapi_token}`
    );

    if (!qrResponse.ok) {
      const errorData = await qrResponse.json();
      
      // If already authorized, return that status
      if (errorData.type === "alreadyLogged") {
        return NextResponse.json({
          status: "authorized",
          message: "WhatsApp is already connected",
        });
      }

      return NextResponse.json(
        { error: "Failed to get QR code", details: errorData },
        { status: qrResponse.status }
      );
    }

    const qrData = await qrResponse.json();

    // qrData.message contains base64 QR code image
    return NextResponse.json({
      status: "pending",
      qrCode: qrData.message, // Base64 encoded QR image
      type: qrData.type,
    });
  } catch (error) {
    console.error("Error getting QR code:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST - Link via phone number (alternative to QR)
export async function POST(request: NextRequest) {
  try {
    const { phoneNumber } = await request.json();

    if (!phoneNumber) {
      return NextResponse.json(
        { error: "Phone number is required" },
        { status: 400 }
      );
    }

    // Get user from auth (uses cookies)
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user's GREEN-API credentials
    const supabaseService = createServiceClient();
    const { data: userData } = await supabaseService
      .from("users")
      .select("greenapi_instance_id, greenapi_token")
      .eq("id", user.id)
      .single();

    if (!userData?.greenapi_instance_id || !userData?.greenapi_token) {
      return NextResponse.json(
        { error: "No GREEN-API instance found. Create one first." },
        { status: 404 }
      );
    }

    // Request pairing code via phone number
    const response = await fetch(
      `https://api.green-api.com/waInstance${userData.greenapi_instance_id}/getAuthorizationCode/${userData.greenapi_token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: phoneNumber.replace(/\D/g, ""), // Remove non-digits
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      return NextResponse.json(
        { error: "Failed to get authorization code", details: errorData },
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json({
      success: true,
      status: data.status,
      message: "Check your WhatsApp for the pairing code",
    });
  } catch (error) {
    console.error("Error getting authorization code:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
