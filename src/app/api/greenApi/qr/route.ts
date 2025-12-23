import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";

// GET - Get QR code for WhatsApp authorization
// Documentation: https://green-api.com/en/docs/api/account/QR/
export async function GET(request: NextRequest) {
  try {
    // Get user from auth (uses cookies)
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
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
    // Response types: qrCode, error, alreadyLogged
    const qrResponse = await fetch(
      `https://api.green-api.com/waInstance${userData.greenapi_instance_id}/qr/${userData.greenapi_token}`
    );

    // Handle non-OK HTTP responses (network errors, server errors)
    if (!qrResponse.ok) {
      return NextResponse.json(
        { error: "Failed to connect to GREEN-API", status: qrResponse.status },
        { status: qrResponse.status }
      );
    }

    const qrData = await qrResponse.json();

    console.log("qrData", qrData);

    // Handle response based on type field
    // Docs: type can be "qrCode", "error", or "alreadyLogged"
    switch (qrData.type) {
      case "qrCode":
        // Successfully got QR code - message contains base64 image
        // Prepend data URI scheme for direct use in <img src="">
        return NextResponse.json({
          status: "pending",
          qrCode: `data:image/png;base64,${qrData.message}`,
          type: qrData.type,
        });

      case "alreadyLogged":
        // Instance is already authorized
        return NextResponse.json({
          status: "authorized",
          message: "WhatsApp is already connected",
          type: qrData.type,
        });

      case "error":
        // Error occurred - message contains error description
        // Common error: "Instance has auth. You need to make log out"
        // This means auth data exists but is invalid, need to logout and rescan
        return NextResponse.json(
          {
            error: qrData.message || "Error getting QR code",
            type: qrData.type,
            needsLogout: qrData.message?.includes("log out") || false,
          },
          { status: 400 }
        );

      default:
        // Unknown response type
        return NextResponse.json(
          { error: "Unknown response from GREEN-API", details: qrData },
          { status: 500 }
        );
    }
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

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
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
