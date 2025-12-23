"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  AlertCircle,
  CheckCircle,
  Loader2,
  Unplug,
  RefreshCw,
  QrCode,
  Smartphone,
  X,
  LogOut,
} from "lucide-react";
import { toast } from "sonner";

interface GreenApiSettingsProps {
  instanceId?: string | null;
  hasToken?: boolean;
}

type ConnectionStatus =
  | "loading"
  | "connected"
  | "not_authorized"
  | "disconnected"
  | "error";

export default function GreenApiSettings({
  instanceId,
  hasToken,
}: GreenApiSettingsProps) {
  const [status, setStatus] = useState<ConnectionStatus>("loading");
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [qrCode, setQrCode] = useState<string>("");
  const [qrLoading, setQrLoading] = useState(false);
  const [showConfirmDisconnect, setShowConfirmDisconnect] = useState(false);
  const [showConfirmLogout, setShowConfirmLogout] = useState(false);

  // Check connection status on mount
  useEffect(() => {
    checkStatus();
  }, []);

  // Poll for authorization when showing QR code
  useEffect(() => {
    if (status !== "not_authorized" || !qrCode) return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch("/api/greenApi/instance");
        const result = await response.json();

        if (result.status === "authorized") {
          setStatus("connected");
          setQrCode("");
          toast.success("WhatsApp connected successfully!");
        }
      } catch (err) {
        console.error("Failed to poll status:", err);
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [status, qrCode]);

  // Auto-refresh QR code
  useEffect(() => {
    if (status !== "not_authorized" || !qrCode || qrLoading) return;

    const refreshInterval = setInterval(() => {
      fetchQrCode();
    }, 15000);

    return () => clearInterval(refreshInterval);
  }, [status, qrCode, qrLoading]);

  const checkStatus = async () => {
    try {
      const response = await fetch("/api/greenApi/instance");
      const result = await response.json();

      if (!result.connected) {
        setStatus("disconnected");
      } else if (result.status === "authorized") {
        setStatus("connected");
      } else if (result.status === "notAuthorized") {
        setStatus("not_authorized");
      } else {
        setStatus("error");
      }
    } catch (err) {
      setStatus("error");
    }
  };

  const fetchQrCode = async () => {
    setQrLoading(true);
    try {
      const response = await fetch("/api/greenApi/qr");
      const result = await response.json();

      if (result.status === "authorized") {
        setStatus("connected");
        setQrCode("");
        toast.success("WhatsApp connected successfully!");
      } else if (result.qrCode) {
        setQrCode(result.qrCode);
        setStatus("not_authorized");
      }
    } catch (err) {
      toast.error("Failed to get QR code");
    } finally {
      setQrLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      const response = await fetch("/api/greenApi/instance", {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to disconnect");
      }

      setStatus("disconnected");
      setQrCode("");
      setShowConfirmDisconnect(false);
      toast.success("GREEN-API disconnected successfully");

      // Reload the page to update the settings
      window.location.reload();
    } catch (err) {
      toast.error("Failed to disconnect GREEN-API");
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      const response = await fetch("/api/greenApi/logout", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to logout");
      }

      const result = await response.json();

      if (result.success) {
        setStatus("not_authorized");
        setShowConfirmLogout(false);
        toast.success("WhatsApp logged out. Scan QR code to reconnect.");
        // Fetch new QR code for reconnection
        fetchQrCode();
      } else {
        toast.error(result.message || "Logout failed");
      }
    } catch (err) {
      toast.error("Failed to logout WhatsApp session");
    } finally {
      setIsLoggingOut(false);
    }
  };

  const handleReconnect = async () => {
    setIsReconnecting(true);
    await fetchQrCode();
    setIsReconnecting(false);
  };

  const getStatusBadge = () => {
    switch (status) {
      case "loading":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
            <Loader2 className="h-3 w-3 animate-spin" />
            Checking...
          </span>
        );
      case "connected":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
            <CheckCircle className="h-3 w-3" />
            Connected
          </span>
        );
      case "not_authorized":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
            <AlertCircle className="h-3 w-3" />
            Needs Authorization
          </span>
        );
      case "disconnected":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
            <Unplug className="h-3 w-3" />
            Disconnected
          </span>
        );
      case "error":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
            <AlertCircle className="h-3 w-3" />
            Error
          </span>
        );
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="h-5 w-5 text-green-600" />
              WhatsApp Connection
            </CardTitle>
            <CardDescription>
              Manage your GREEN-API WhatsApp integration
            </CardDescription>
          </div>
          {getStatusBadge()}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Instance Info */}
        {instanceId && status !== "disconnected" && (
          <div className="space-y-2">
            <Label>Instance ID</Label>
            <div className="text-sm text-muted-foreground font-mono bg-secondary-background px-3 py-2 rounded-base border">
              {instanceId}
            </div>
          </div>
        )}

        {/* QR Code Section */}
        {status === "not_authorized" && qrCode && (
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 p-6 rounded-base border-2 border-green-200">
            <div className="flex flex-col items-center gap-4">
              <div className="text-center space-y-2">
                <div className="inline-flex items-center justify-center gap-2 bg-green-500 text-white px-4 py-2 rounded-full">
                  <QrCode className="h-4 w-4" />
                  <span className="text-sm font-semibold">Scan to Connect</span>
                </div>
                <p className="text-sm text-green-800/80 max-w-xs">
                  Open WhatsApp → Settings → Linked Devices → Scan this code
                </p>
              </div>

              <div className="relative">
                <div className="absolute -inset-1 bg-gradient-to-r from-green-400 to-emerald-400 rounded-xl blur opacity-30"></div>
                <div className="relative bg-white p-4 rounded-xl border-2 border-green-200 shadow-lg">
                  <img
                    src={qrCode}
                    alt="WhatsApp QR Code"
                    className="w-48 h-48 object-contain"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 text-green-700">
                <div className="relative">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-ping absolute"></div>
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                </div>
                <span className="text-sm font-medium">Waiting for scan...</span>
              </div>

              <Button
                variant="neutral"
                size="sm"
                onClick={fetchQrCode}
                disabled={qrLoading}
              >
                {qrLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Refresh QR
              </Button>
            </div>
          </div>
        )}

        {/* Logout Confirmation */}
        {showConfirmLogout && (
          <div className="bg-amber-50 border-2 border-amber-200 rounded-base p-4">
            <div className="flex items-start gap-3">
              <LogOut className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-amber-800">
                  Logout WhatsApp Session?
                </h4>
                <p className="text-xs text-amber-700 mt-1">
                  This will log out your WhatsApp session. You&apos;ll need to
                  scan the QR code again to reconnect. Your credentials and
                  conversation history will be preserved.
                </p>
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    onClick={handleLogout}
                    disabled={isLoggingOut}
                    className="bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    {isLoggingOut ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <LogOut className="h-4 w-4 mr-2" />
                    )}
                    Yes, Logout
                  </Button>
                  <Button
                    size="sm"
                    variant="neutral"
                    onClick={() => setShowConfirmLogout(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
              <button
                onClick={() => setShowConfirmLogout(false)}
                className="text-amber-400 hover:text-amber-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Disconnect Confirmation */}
        {showConfirmDisconnect && (
          <div className="bg-red-50 border-2 border-red-200 rounded-base p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-red-800">
                  Disconnect WhatsApp Completely?
                </h4>
                <p className="text-xs text-red-700 mt-1">
                  This will remove your GREEN-API credentials entirely.
                  You&apos;ll need to go through onboarding again to reconnect.
                  Your conversation history will be preserved.
                </p>
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    onClick={handleDisconnect}
                    disabled={isDisconnecting}
                    className="bg-red-600 hover:bg-red-700 text-white"
                  >
                    {isDisconnecting ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Unplug className="h-4 w-4 mr-2" />
                    )}
                    Yes, Disconnect
                  </Button>
                  <Button
                    size="sm"
                    variant="neutral"
                    onClick={() => setShowConfirmDisconnect(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
              <button
                onClick={() => setShowConfirmDisconnect(false)}
                className="text-red-400 hover:text-red-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3 pt-2">
          {status === "connected" &&
            !showConfirmDisconnect &&
            !showConfirmLogout && (
              <>
                <Button
                  variant="neutral"
                  className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                  onClick={() => setShowConfirmLogout(true)}
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Logout Session
                </Button>

                <Button
                  variant="neutral"
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  onClick={() => setShowConfirmDisconnect(true)}
                >
                  <Unplug className="h-4 w-4 mr-2" />
                  Disconnect
                </Button>

                <Button variant="neutral" onClick={() => checkStatus()}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh Status
                </Button>
              </>
            )}

          {status === "not_authorized" && !qrCode && (
            <Button
              onClick={handleReconnect}
              disabled={isReconnecting}
              className="bg-green-600 hover:bg-green-700"
            >
              {isReconnecting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <QrCode className="h-4 w-4 mr-2" />
              )}
              Show QR Code
            </Button>
          )}

          {status === "disconnected" && (
            <div className="w-full">
              <p className="text-sm text-muted-foreground mb-3">
                No WhatsApp connection configured. Go to the onboarding flow to
                set up your GREEN-API connection.
              </p>
              <Button
                variant="neutral"
                onClick={() => (window.location.href = "/onboarding")}
              >
                Set Up WhatsApp
              </Button>
            </div>
          )}

          {status === "error" && (
            <Button variant="neutral" onClick={() => checkStatus()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
