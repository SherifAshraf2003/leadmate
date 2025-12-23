import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";

// POST - Logout WhatsApp session (keeps credentials, just logs out the session)
// Documentation: https://green-api.com/en/docs/api/account/Logout/
export async function POST(request: NextRequest) {
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
        { error: "No GREEN-API instance found" },
        { status: 404 }
      );
    }

    // Call GREEN-API logout endpoint
    // GET {{apiUrl}}/waInstance{{idInstance}}/logout/{{apiTokenInstance}}
    const logoutResponse = await fetch(
      `https://api.green-api.com/waInstance${userData.greenapi_instance_id}/logout/${userData.greenapi_token}`
    );

    if (!logoutResponse.ok) {
      const errorText = await logoutResponse.text();
      console.error("GREEN-API logout failed:", errorText);
      return NextResponse.json(
        { error: "Failed to logout from GREEN-API", details: errorText },
        { status: logoutResponse.status }
      );
    }

    const logoutData = await logoutResponse.json();

    // Response: { "isLogout": true }
    if (logoutData.isLogout) {
      return NextResponse.json({
        success: true,
        message: "WhatsApp session logged out successfully. Scan QR code to reconnect.",
      });
    } else {
      return NextResponse.json({
        success: false,
        message: "Logout request sent but status unknown",
        data: logoutData,
      });
    }
  } catch (error) {
    console.error("Error logging out GREEN-API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

